"""Deal schemas: CRUD, kanban, stage moves, won/lost transitions, quick log."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import ActivityType, DealStatus
from app.schemas.common import ORMModel
from app.schemas.contact import ContactOut
from app.schemas.enrollment import EnrollmentData


class DealCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    contact_id: uuid.UUID
    pipeline_id: uuid.UUID | None = None  # default pipeline when omitted
    stage_id: uuid.UUID | None = None  # first stage of the pipeline when omitted
    owner_id: uuid.UUID | None = None  # admin may assign; consultor gets self
    unit_id: uuid.UUID | None = None
    cycle_id: uuid.UUID | None = None  # active cycle when omitted (spec 10.1)
    value: Decimal | None = Field(default=None, ge=0)
    qualification: int | None = Field(default=None, ge=1, le=5)
    expected_close_date: date | None = None
    source: str | None = Field(default=None, max_length=120)
    campaign: str | None = Field(default=None, max_length=120)
    enrollment_data: EnrollmentData | None = None


class DealUpdate(BaseModel):
    """General field updates. Stage/status transitions use dedicated endpoints.

    ``next_contact_at`` and ``objection_id`` support explicit clearing: send
    ``null`` to remove them (the router checks ``model_fields_set``)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    unit_id: uuid.UUID | None = None
    owner_id: uuid.UUID | None = None  # admin-only reassignment (router enforces)
    value: Decimal | None = Field(default=None, ge=0)
    qualification: int | None = Field(default=None, ge=1, le=5)
    expected_close_date: date | None = None
    source: str | None = Field(default=None, max_length=120)
    campaign: str | None = Field(default=None, max_length=120)
    enrollment_data: EnrollmentData | None = None
    next_contact_at: datetime | None = None
    objection_id: uuid.UUID | None = None  # catalog objection (spec 12.2)


class DealMoveStage(BaseModel):
    stage_id: uuid.UUID
    # Optional follow-up scheduling in the same request (spec 09.2 — avoids a
    # second call after the kanban drag prompt).
    next_contact_at: datetime | None = None


class DealMarkWon(BaseModel):
    value: Decimal | None = Field(default=None, ge=0)  # optional final value


class DealMarkLost(BaseModel):
    lost_reason_id: uuid.UUID
    lost_notes: str | None = None


class DealFirstContactCorrection(BaseModel):
    """Admin-only correction of the write-once first contact timestamp."""

    first_whatsapp_contact_at: datetime


class DealFirstContactIn(BaseModel):
    """Optional body for first-contact registration: schedule the next
    follow-up in the same request (spec 09.2)."""

    next_contact_at: datetime | None = None


QuickLogKind = Literal[
    "attempt_no_answer", "talked_advance", "talked_objection", "visit_scheduled"
]

QUICK_LOG_KIND_TO_ACTIVITY: dict[str, ActivityType] = {
    "attempt_no_answer": ActivityType.ATTEMPT_NO_ANSWER,
    "talked_advance": ActivityType.TALKED_ADVANCE,
    "talked_objection": ActivityType.TALKED_OBJECTION,
    "visit_scheduled": ActivityType.VISIT_SCHEDULED,
}


class QuickLogIn(BaseModel):
    """One-click contact-outcome registration (spec 12.3).

    ``next_contact_at`` is required when ``kind == visit_scheduled`` (it is
    the visit date — a "Visit" task is created due that day)."""

    kind: QuickLogKind
    note: str | None = Field(default=None, max_length=2000)
    next_contact_at: datetime | None = None
    # Catalog objection (spec 12.2) — only valid with kind=talked_objection;
    # sets the deal's main objection and is stored in the activity payload.
    objection_id: uuid.UUID | None = None


class DealOut(ORMModel):
    id: uuid.UUID
    title: str
    status: DealStatus
    pipeline_id: uuid.UUID
    stage_id: uuid.UUID
    owner_id: uuid.UUID | None
    unit_id: uuid.UUID | None
    contact_id: uuid.UUID
    cycle_id: uuid.UUID
    objection_id: uuid.UUID | None
    value: Decimal | None
    qualification: int | None
    expected_close_date: date | None
    source: str | None
    campaign: str | None
    lost_reason_id: uuid.UUID | None
    lost_notes: str | None
    first_whatsapp_contact_at: datetime | None
    next_contact_at: datetime | None
    last_activity_at: datetime
    won_at: datetime | None
    lost_at: datetime | None
    enrollment_data: dict
    created_at: datetime
    updated_at: datetime


class DealDetailOut(DealOut):
    contact: ContactOut


class QuickLogOut(BaseModel):
    """Quick-log response: the updated deal + how many no-answer attempts the
    deal has (the frontend pre-selects the cadence interval from it)."""

    deal: DealOut
    attempts_count: int


class DealCard(ORMModel):
    """Compact deal representation for kanban cards."""

    id: uuid.UUID
    title: str
    status: DealStatus
    stage_id: uuid.UUID
    owner_id: uuid.UUID | None
    unit_id: uuid.UUID | None
    value: Decimal | None
    qualification: int | None
    source: str | None
    last_activity_at: datetime
    created_at: datetime
    contact_name: str
    contact_phone: str
    is_cooling: bool
    next_contact_at: datetime | None = None  # "no next step" badge source
    # Denormalized for the card (avoids fetching enrollment_data per deal):
    interest_course: str | None = None
    first_whatsapp_contact_at: datetime | None = None


class KanbanStage(BaseModel):
    stage_id: uuid.UUID
    name: str
    sort_order: int
    is_won_stage: bool
    count: int
    sum_value: Decimal
    deals: list[DealCard]


class KanbanResponse(BaseModel):
    pipeline_id: uuid.UUID
    cooling_days: int
    stages: list[KanbanStage]


class RecoverableDealRow(BaseModel):
    """Win-back candidate (spec 10.4): lost deal with a recoverable reason
    from a cycle other than the active one."""

    deal_id: uuid.UUID
    title: str
    contact_name: str
    contact_phone: str
    owner_id: uuid.UUID | None
    owner_name: str | None
    cycle_id: uuid.UUID
    cycle_name: str
    lost_reason_id: uuid.UUID
    lost_reason_label: str
    lost_at: datetime
    interest_course: str | None


class RecoverableDealsOut(BaseModel):
    active_cycle_id: uuid.UUID
    total: int
    items: list[RecoverableDealRow]
