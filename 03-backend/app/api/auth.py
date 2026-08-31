"""Auth endpoints: login, refresh (rotating cookie), logout, me, password.

Two login flows (ADR: 17-wave3-notes.md):
- ``client=web`` (default): 15-min access token + rotating httpOnly refresh
  cookie (SPA flow, unchanged).
- ``client=extension``: single longer-lived access token (12h default, no
  refresh token at all). Chrome-extension contexts cannot use the httpOnly
  cookie channel reliably, and storing a rotating refresh token in extension
  storage would weaken it to a plain bearer secret; a bounded-TTL access
  token kept in ``chrome.storage.session`` is the simpler and safer tradeoff.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query, Request, Response, status

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession, client_ip
from app.core.exceptions import RateLimitedError, UnauthorizedError, ValidationFailedError
from app.core.rate_limit import login_limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/v1/auth",  # cookie only travels to auth endpoints
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/api/v1/auth",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


def _token_response(user: User) -> TokenResponse:
    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(
            user.id, user.role.value, password_changed_at=user.password_changed_at
        ),
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    client: Literal["web", "extension"] = Query(default="web"),
) -> TokenResponse:
    """Email + password login. Rate limited per IP+email (5/min).

    ``?client=extension`` issues a longer-lived access token (12h default)
    WITHOUT a refresh cookie — the Chrome extension flow (see module docstring).
    """
    key = f"{client_ip(request)}:{body.email.lower()}"
    if not login_limiter.allow(key):
        raise RateLimitedError("Too many login attempts, try again in a minute")

    user = await auth_service.authenticate(db, body.email, body.password)
    if client == "extension":
        settings = get_settings()
        ttl_minutes = settings.extension_access_token_expire_hours * 60
        return TokenResponse(
            access_token=create_access_token(
                user.id,
                user.role.value,
                expires_minutes=ttl_minutes,
                password_changed_at=user.password_changed_at,
            ),
            expires_in=ttl_minutes * 60,
        )
    refresh_plain = await auth_service.issue_refresh_token(db, user)
    _set_refresh_cookie(response, refresh_plain)
    return _token_response(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: DbSession) -> TokenResponse:
    """Rotate the refresh token (httpOnly cookie) and mint a new access token."""
    settings = get_settings()
    plain = request.cookies.get(settings.refresh_cookie_name)
    if not plain:
        raise UnauthorizedError("Missing refresh token", code="missing_refresh_token")
    user, new_plain = await auth_service.rotate_refresh_token(db, plain)
    _set_refresh_cookie(response, new_plain)
    return _token_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: DbSession) -> None:
    """Revoke the refresh token and clear the cookie. Always succeeds."""
    settings = get_settings()
    plain = request.cookies.get(settings.refresh_cookie_name)
    if plain:
        await auth_service.revoke_refresh_token(db, plain)
    _clear_refresh_cookie(response)


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse.model_validate(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest, user: CurrentUser, db: DbSession
) -> None:
    """Authenticated user changes their own password.

    Revokes BOTH channels (M8): the refresh tokens in the database and, via
    ``password_changed_at``, every access token already minted — including the
    extension's 12h one, which has no refresh token to revoke. The caller must
    log in again.
    """
    if not verify_password(body.current_password, user.password_hash):
        raise ValidationFailedError("Current password is incorrect", "wrong_password")
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = datetime.now(UTC)
    await auth_service.revoke_all_user_tokens(db, user.id)
    await db.flush()
