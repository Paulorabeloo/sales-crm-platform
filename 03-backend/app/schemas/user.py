"""User management schemas (admin-only endpoints)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.db.models import UserRole
from app.schemas.common import ORMModel


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)  # initial password set by admin
    role: UserRole = UserRole.CONSULTOR
    unit_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: UserRole | None = None
    is_active: bool | None = None
    unit_id: uuid.UUID | None = None
    clear_unit: bool = False  # explicit, since unit_id=None is ambiguous in PATCH


class UserResetPassword(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    name: str
    role: UserRole
    is_active: bool
    unit_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
