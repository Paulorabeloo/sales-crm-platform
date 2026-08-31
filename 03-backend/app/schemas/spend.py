"""Campaign spend schemas — monthly ad-spend input for CAC."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel


class CampaignSpendCreate(BaseModel):
    month: date  # any day accepted; normalized to the 1st of the month
    source: str = Field(min_length=1, max_length=120)
    campaign: str | None = Field(default=None, min_length=1, max_length=120)
    unit_id: uuid.UUID | None = None
    amount: Decimal = Field(ge=0)

    @field_validator("month")
    @classmethod
    def normalize_month(cls, v: date) -> date:
        return v.replace(day=1)


class CampaignSpendUpdate(BaseModel):
    """Only the amount is editable — month/source/campaign/unit form the row's
    identity (delete + recreate to change them)."""

    amount: Decimal = Field(ge=0)


class CampaignSpendOut(ORMModel):
    id: uuid.UUID
    month: date
    source: str
    campaign: str | None
    unit_id: uuid.UUID | None
    amount: Decimal
    created_at: datetime
    updated_at: datetime
