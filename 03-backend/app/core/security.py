"""Password hashing (argon2id) and JWT/refresh-token primitives."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()  # argon2id with library defaults (secure as of 2026)


# --- Passwords ----------------------------------------------------------------

def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:  # malformed hash etc. — treat as mismatch, never raise
        return False


# --- Access token (JWT) -------------------------------------------------------

def create_access_token(
    user_id: uuid.UUID,
    role: str,
    *,
    expires_minutes: int | None = None,
    password_changed_at: datetime | None = None,
) -> str:
    """Signed access JWT. ``expires_minutes`` overrides the default TTL
    (used by the extension login flow, which has no refresh channel).

    ``password_changed_at`` is stamped as the ``pwd`` claim: ``get_current_user``
    compares it with the stored value and refuses the token when they differ
    (M8). That is the only revocation channel the extension's 12h token has,
    and ``iat`` alone is too coarse for it (whole seconds)."""
    settings = get_settings()
    ttl = expires_minutes if expires_minutes is not None else settings.access_token_expire_minutes
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=ttl),
        "type": "access",
    }
    if password_changed_at is not None:
        stamp = password_changed_at
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC)
        payload["pwd"] = stamp.timestamp()
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Return the payload of a valid access token, else None."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


# --- Refresh token (opaque, stored hashed, rotated) ---------------------------

def generate_refresh_token() -> str:
    """Opaque URL-safe secret sent to the client in an httpOnly cookie."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """SHA-256 of the opaque token — only the hash is persisted."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def refresh_token_expiry() -> datetime:
    settings = get_settings()
    return datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)


def generate_lead_source_token() -> str:
    """Webhook token for a lead source (>= 32 url-safe chars, DB CHECK)."""
    return secrets.token_urlsafe(32)
