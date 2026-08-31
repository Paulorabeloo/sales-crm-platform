"""Auth request/response schemas."""

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.db.models import UserRole
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class MeResponse(ORMModel):
    id: uuid.UUID
    email: str
    name: str
    role: UserRole
    is_active: bool
    unit_id: uuid.UUID | None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)
