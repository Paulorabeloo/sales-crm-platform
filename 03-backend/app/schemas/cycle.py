"""Sales cycle schemas (spec 10.1)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel


class CycleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    starts_on: date
    deadline_on: date | None = None
    # Creating an already-active cycle deactivates the current one.
    is_active: bool = False

    @model_validator(mode="after")
    def _deadline_after_start(self) -> "CycleCreate":
        if self.deadline_on is not None and self.deadline_on < self.starts_on:
            raise ValueError("deadline_on must be on or after starts_on")
        return self


class CycleUpdate(BaseModel):
    """``deadline_on`` supports explicit clearing (send null); the router
    checks ``model_fields_set``. Activation is a dedicated action
    (``POST /cycles/{id}/activate``), never a PATCH field."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    starts_on: date | None = None
    deadline_on: date | None = None


class CycleOut(ORMModel):
    id: uuid.UUID
    name: str
    starts_on: date
    deadline_on: date | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RolloverOut(BaseModel):
    """Result of ``POST /cycles/{id}/rollover``: open deals moved from the
    source cycle into the active one."""

    from_cycle_id: uuid.UUID
    to_cycle_id: uuid.UUID
    moved_count: int
