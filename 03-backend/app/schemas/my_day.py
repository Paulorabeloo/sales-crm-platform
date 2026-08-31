"""My Day aggregate schemas (spec 09.1) — the consultant's prioritized work
queue. One request, four sections, priority order:

1. ``respond_now`` — deals without first WhatsApp contact (own + unassigned
   queue), oldest first.
2. ``today`` — pending tasks due today + follow-ups scheduled for today
   (``next_contact_at``).
3. ``overdue`` — overdue pending tasks + follow-ups whose ``next_contact_at``
   is in the past.
4. ``cooling_no_next_step`` — open cooling deals without a future next step.

A deal appears in at most one deal section (first match wins, by priority).
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class MyDayDeal(BaseModel):
    deal_id: uuid.UUID
    title: str
    contact_name: str
    contact_phone: str
    stage_id: uuid.UUID
    stage_name: str
    owner_id: uuid.UUID | None
    created_at: datetime  # the frontend renders the lead age from this
    first_whatsapp_contact_at: datetime | None
    next_contact_at: datetime | None
    last_activity_at: datetime
    is_cooling: bool
    interest_course: str | None = None


class MyDayTask(BaseModel):
    task_id: uuid.UUID
    deal_id: uuid.UUID
    deal_title: str
    title: str
    due_date: date
    assigned_to: uuid.UUID | None


class MyDaySection(BaseModel):
    tasks: list[MyDayTask] = Field(default_factory=list)
    followups: list[MyDayDeal] = Field(default_factory=list)


class MyDayResponse(BaseModel):
    respond_now: list[MyDayDeal]
    today: MyDaySection
    overdue: MyDaySection
    cooling_no_next_step: list[MyDayDeal]
    cooling_days: int
