"""Contact schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.phone import normalize_phone
from app.schemas.common import ORMModel


class ContactBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone_whatsapp: str
    email: EmailStr | None = None
    city: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    @field_validator("phone_whatsapp")
    @classmethod
    def normalize(cls, v: str) -> str:
        normalized = normalize_phone(v)
        if normalized is None:
            raise ValueError("phone must be a valid phone number (E.164 normalizable)")
        return normalized


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    phone_whatsapp: str | None = None
    email: EmailStr | None = None
    city: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    @field_validator("phone_whatsapp")
    @classmethod
    def normalize(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalized = normalize_phone(v)
        if normalized is None:
            raise ValueError("phone must be a valid phone number (E.164 normalizable)")
        return normalized


class ContactOut(ORMModel):
    id: uuid.UUID
    name: str
    phone_whatsapp: str
    email: str | None
    city: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
