"""Public lead-capture webhook schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phone import normalize_phone


class LeadWebhookPayload(BaseModel):
    """Payload accepted from capture sources (Apps Script LPs, Meta Lead Ads
    relay, ...). ``name`` and ``phone`` are mandatory; everything else is
    optional. Unknown top-level keys are rejected — put extras in ``extra``."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    phone: str
    email: str | None = Field(default=None, max_length=254)
    course_of_interest: str | None = Field(default=None, max_length=200)
    unit: str | None = Field(default=None, max_length=120)
    campaign: str | None = Field(default=None, max_length=120)
    extra: dict[str, Any] | None = None

    @field_validator("phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        normalized = normalize_phone(v)
        if normalized is None:
            raise ValueError("phone must be a valid phone number")
        return normalized


class LeadWebhookResponse(BaseModel):
    status: str  # "accepted"
    result: str  # accepted | duplicate_contact
    deal_id: uuid.UUID
    contact_id: uuid.UUID
