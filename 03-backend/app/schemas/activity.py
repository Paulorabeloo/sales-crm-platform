"""Activity/timeline schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import ActivityType
from app.schemas.common import ORMModel


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)


class ActivityOut(ORMModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    type: ActivityType
    body: str | None
    payload: dict
    user_id: uuid.UUID | None
    user_name: str | None = None  # joined for display
    created_at: datetime
