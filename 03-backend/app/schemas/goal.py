"""Goal schemas — per-cycle enrollment targets."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel

GoalScope = Literal["consultant", "unit"]


class GoalCreate(BaseModel):
    cycle_id: uuid.UUID
    scope: GoalScope
    target_user_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    target_count: int = Field(ge=1)

    @model_validator(mode="after")
    def _target_matches_scope(self) -> "GoalCreate":
        if self.scope == "consultant":
            if self.target_user_id is None or self.unit_id is not None:
                raise ValueError("scope 'consultant' requires target_user_id (and no unit_id)")
        else:
            if self.unit_id is None or self.target_user_id is not None:
                raise ValueError("scope 'unit' requires unit_id (and no target_user_id)")
        return self


class GoalUpdate(BaseModel):
    """Only the target is editable — cycle/scope/target form the goal's
    identity (delete + recreate to retarget)."""

    target_count: int = Field(ge=1)


class GoalOut(ORMModel):
    id: uuid.UUID
    cycle_id: uuid.UUID
    scope: str
    target_user_id: uuid.UUID | None
    unit_id: uuid.UUID | None
    target_count: int
    created_at: datetime
    updated_at: datetime


class GoalProgressRow(BaseModel):
    goal_id: uuid.UUID
    cycle_id: uuid.UUID
    scope: str
    target_user_id: uuid.UUID | None
    target_user_name: str | None
    unit_id: uuid.UUID | None
    unit_name: str | None
    target_count: int
    won_count: int
    pct: float  # 0-100 (may exceed 100 when the target is beaten)


class GoalProgressOut(BaseModel):
    cycle_id: uuid.UUID
    rows: list[GoalProgressRow]  # ordered by pct desc (ranking)
