"""Auth service: credential check, refresh-token issuance/rotation/revocation."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedError
from app.core.security import (
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)
from app.db.models import RefreshToken, User

# Verified against when the email is unknown so the response takes the same
# time as a real argon2 check — no account enumeration by timing (Minor 1).
_DUMMY_PASSWORD_HASH = hash_password("timing-equalizer-dummy-password")


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    """Validate credentials. Same error AND same timing for unknown email /
    wrong password / inactive user — no account enumeration."""
    user = await db.scalar(select(User).where(func.lower(User.email) == email.lower()))
    stored_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    if not verify_password(password, stored_hash) or user is None:
        raise UnauthorizedError("Invalid email or password", code="invalid_credentials")
    if not user.is_active:
        raise UnauthorizedError("Invalid email or password", code="invalid_credentials")
    return user


async def issue_refresh_token(db: AsyncSession, user: User) -> str:
    """Create and persist a new opaque refresh token; return the plain value."""
    plain = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(plain),
            expires_at=refresh_token_expiry(),
        )
    )
    await db.flush()
    return plain


async def rotate_refresh_token(db: AsyncSession, plain_token: str) -> tuple[User, str]:
    """Validate a refresh token, revoke it, and issue a replacement.

    Rejects expired, revoked, or unknown tokens.
    """
    token_hash = hash_refresh_token(plain_token)
    row = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    now = datetime.now(UTC)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise UnauthorizedError("Invalid refresh token", code="invalid_refresh_token")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError("Invalid refresh token", code="invalid_refresh_token")

    row.revoked_at = now  # rotation: old token is single-use
    new_plain = await issue_refresh_token(db, user)
    return user, new_plain


async def revoke_refresh_token(db: AsyncSession, plain_token: str) -> None:
    """Revoke one refresh token (logout). Silently ignores unknown tokens."""
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(plain_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )


async def revoke_all_user_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Revoke every active refresh token of a user (password reset/deactivate)."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
