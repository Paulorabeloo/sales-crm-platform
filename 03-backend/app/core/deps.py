"""FastAPI dependencies: DB session, current user, role guards.

Per the schema contract (02-schema/notes.md §6), every authenticated request
runs ``SET LOCAL app.user_id = '<uuid>'`` (via ``set_config(..., true)``) so DB
triggers can attribute ``deal_stage_history.changed_by``.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.db.models import User, UserRole
from app.db.session import get_db

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]

# ``iat`` has whole-second resolution, so it can only judge tokens minted
# before the tracking existed; one second of slack absorbs the truncation.
_IAT_SKEW = timedelta(seconds=1)


def _password_change_revoked(payload: dict, user: User) -> bool:
    """Stateless revocation (M8): a token that does not carry the user's
    CURRENT ``password_changed_at`` is dead, however long its TTL is. This is
    the only revocation channel the extension's 12h token has, since it is
    issued without a refresh token.

    Tokens minted before this claim existed are judged by ``iat`` instead, so
    an upgrade does not log everyone out mid-session."""
    changed_at = user.password_changed_at
    if changed_at.tzinfo is None:
        changed_at = changed_at.replace(tzinfo=UTC)

    claim = payload.get("pwd")
    if isinstance(claim, int | float) and not isinstance(claim, bool):
        return abs(float(claim) - changed_at.timestamp()) > 1e-6

    raw_iat = payload.get("iat")
    if not isinstance(raw_iat, int):
        return True  # neither claim: cannot prove the token postdates the change
    return datetime.fromtimestamp(raw_iat, UTC) < changed_at - _IAT_SKEW


async def get_current_user(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Resolve and validate the authenticated user from the Bearer token."""
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError()
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise UnauthorizedError("Invalid or expired token", code="invalid_token")
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise UnauthorizedError("Invalid token subject", code="invalid_token") from None

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise UnauthorizedError("User inactive or unknown", code="user_inactive")
    if _password_change_revoked(payload, user):
        raise UnauthorizedError(
            "Token was issued before the last password change", code="token_revoked"
        )

    # Transaction-scoped setting consumed by DB triggers (changed_by attribution).
    await db.execute(
        text("SELECT set_config('app.user_id', :uid, true)").bindparams(uid=str(user.id))
    )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != UserRole.ADMIN:
        raise ForbiddenError("Admin role required", code="admin_only")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def client_ip(request: Request) -> str:
    """Best-effort client IP (honors X-Forwarded-For behind a proxy)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
