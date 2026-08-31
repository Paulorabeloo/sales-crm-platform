"""Task schemas."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: date
    assigned_to: uuid.UUID | None = None  # default: deal owner (or creator)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    due_date: date | None = None
    is_done: bool | None = None
    assigned_to: uuid.UUID | None = None


class TaskOut(ORMModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    title: str
    due_date: date
    is_done: bool
    done_at: datetime | None
    assigned_to: uuid.UUID | None  # None = unassigned (queue deal; claim assigns)
    created_by: uuid.UUID | None  # None = system-created (webhook cadence)
    created_at: datetime
    updated_at: datetime


class MyTasksResponse(BaseModel):
    """'My tasks' buckets: overdue / due today / upcoming (all pending)."""

    overdue: list[TaskOut]
    today: list[TaskOut]
    upcoming: list[TaskOut]
