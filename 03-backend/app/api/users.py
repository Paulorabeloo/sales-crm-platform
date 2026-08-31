"""User management (admin only): create consultants, activate/deactivate,
reset passwords. Users are never deleted (deal history must survive)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.core.deps import AdminUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.core.security import hash_password
from app.db.models import Unit, User
from app.schemas.user import UserCreate, UserOut, UserResetPassword, UserUpdate
from app.services.auth import revoke_all_user_tokens

router = APIRouter(prefix="/users", tags=["users"])


async def _get_user_or_404(db: DbSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User", code="user_not_found")
    return user


async def _validate_unit(db: DbSession, unit_id: uuid.UUID | None) -> None:
    if unit_id is not None and await db.get(Unit, unit_id) is None:
        raise ValidationFailedError("unit_id must reference an existing unit", "invalid_unit")


@router.get("", response_model=list[UserOut])
async def list_users(admin: AdminUser, db: DbSession) -> list[UserOut]:
    users = (await db.scalars(select(User).order_by(User.name))).all()
    return [UserOut.model_validate(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, admin: AdminUser, db: DbSession) -> UserOut:
    existing = await db.scalar(
        select(User).where(func.lower(User.email) == body.email.lower())
    )
    if existing is not None:
        raise ConflictError("A user with this email already exists", "duplicate_email")
    await _validate_unit(db, body.unit_id)
    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        role=body.role,
        unit_id=body.unit_id,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return UserOut.model_validate(user)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: uuid.UUID, admin: AdminUser, db: DbSession) -> UserOut:
    return UserOut.model_validate(await _get_user_or_404(db, user_id))


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID, body: UserUpdate, admin: AdminUser, db: DbSession
) -> UserOut:
    user = await _get_user_or_404(db, user_id)
    # Self-lockout guard (Minor 8): an admin cannot deactivate or demote
    # themselves — with a single admin that would brick the system.
    if user.id == admin.id and (
        body.is_active is False or (body.role is not None and body.role != admin.role)
    ):
        raise ConflictError(
            "Admins cannot deactivate or demote themselves", "cannot_lock_self_out"
        )
    if body.name is not None:
        user.name = body.name
    if body.role is not None:
        user.role = body.role
    if body.clear_unit:
        user.unit_id = None
    elif body.unit_id is not None:
        await _validate_unit(db, body.unit_id)
        user.unit_id = body.unit_id
    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            # Deactivation kills open sessions as soon as the access token expires.
            await revoke_all_user_tokens(db, user.id)
    await db.flush()
    return UserOut.model_validate(user)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: uuid.UUID, body: UserResetPassword, admin: AdminUser, db: DbSession
) -> None:
    """Admin resets a user's password (no email flow in phase 1).

    ``password_changed_at`` moves forward too, so the target's live access
    tokens die immediately — the extension's 12h token included (M8)."""
    user = await _get_user_or_404(db, user_id)
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = datetime.now(UTC)
    await revoke_all_user_tokens(db, user.id)
    await db.flush()
