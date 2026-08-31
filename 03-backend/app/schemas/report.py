"""Report response schemas — built from aggregate SQL, never from ORM rows."""

import uuid
from decimal import Decimal

from pydantic import BaseModel


# --- Summary (dashboard KPI cards) --------------------------------------------

class NoNextStepRow(BaseModel):
    """Per-consultant follow-up discipline: open deals without a
    FUTURE ``next_contact_at``. Current-state metric (not period-bound)."""

    owner_id: uuid.UUID | None
    owner_name: str | None  # None = unassigned queue
    open_deals: int
    without_next_step: int
    pct: float  # 0-100


class SummaryReport(BaseModel):
    leads_count: int  # deals created in the period
    conversion_rate: float  # 0-1: created-in-period deals that became won
    median_response_minutes: float | None  # first contact delay (contacted only)
    sales_count: int  # deals won in the period
    sales_value: Decimal
    no_next_step: list[NoNextStepRow]  # open deals w/o future next step, by owner
    # Average acquisition cost: registered spend in the period's
    # months / enrollments won in the period. None when there is no matching
    # spend, no won deals, or when an owner filter is applied (spend has no
    # owner dimension) — never fabricated.
    cac_average: Decimal | None = None


# --- Funnel -------------------------------------------------------------------

class FunnelStageRow(BaseModel):
    stage_id: uuid.UUID
    stage_name: str
    sort_order: int
    deals_entered: int
    conversion_from_previous: float | None  # None for the first stage


class FunnelReport(BaseModel):
    stages: list[FunnelStageRow]
    total_entered: int  # deals that entered the first stage in the period
    total_won: int
    total_lost: int


# --- Lost reasons -------------------------------------------------------------

class LostReasonRow(BaseModel):
    lost_reason_id: uuid.UUID
    label: str
    count: int
    pct: float
    total_value: Decimal


class ObjectionRow(BaseModel):
    objection: str
    count: int


class CatalogObjectionRow(BaseModel):
    """Lost deals grouped by the objection CATALOG (deals.objection_id) —
    the spec. ``top_objections`` keeps the free-text legacy grouping."""

    objection_id: uuid.UUID
    name: str
    count: int


class LostReasonsReport(BaseModel):
    total_lost: int
    reasons: list[LostReasonRow]
    top_objections: list[ObjectionRow]  # enrollment_data.main_objection grouped
    objection_breakdown: list[CatalogObjectionRow] = []  # catalog grouping


# --- Response time ------------------------------------------------------------

class ResponseTimeRow(BaseModel):
    owner_id: uuid.UUID | None
    owner_name: str | None  # None = unassigned queue
    deals: int
    contacted: int
    never_contacted: int
    avg_minutes: float | None
    median_minutes: float | None
    p90_minutes: float | None
    pct_no_contact_in_24h: float  # % of deals without first contact within 24h


class ResponseTimeReport(BaseModel):
    rows: list[ResponseTimeRow]


# --- Sales --------------------------------------------------------------------

class SalesRow(BaseModel):
    group_key: str  # unit name / owner name / YYYY-MM depending on group_by
    group_id: uuid.UUID | None
    enrollments: int
    total_value: Decimal
    avg_ticket: Decimal


class SalesReport(BaseModel):
    group_by: str
    rows: list[SalesRow]
    total_enrollments: int
    total_value: Decimal


# --- CAC ----------------------------------------------------------

class CacRow(BaseModel):
    """Spend x results for one group. Cost fields are None whenever there is
    no registered spend for the group (never fabricated)."""

    group_key: str | None  # source / campaign / unit name / YYYY-MM (None = deals without the attribute)
    group_id: uuid.UUID | None  # unit grouping only
    spend: Decimal | None  # None = no spend registered for this group
    leads_count: int
    enrollments: int
    cost_per_lead: Decimal | None
    cost_per_enrollment: Decimal | None  # the CAC
    lead_to_enrollment_rate: float | None  # 0-1; None when leads_count == 0


class CacReport(BaseModel):
    group_by: str  # source | campaign | unit | month
    rows: list[CacRow]
    total_spend: Decimal | None  # None = no spend registered in the period
    total_leads: int
    total_enrollments: int
    cac_average: Decimal | None  # total_spend / total_enrollments


# --- Conversation metrics -----------------------------------------

class ConversationRow(BaseModel):
    """Per-consultant quick-log outcomes. ``contact_to_conversation_rate`` =
    conversations / (attempts + conversations). ``objections_overcome_pct`` =
    % of this consultant's objection-flagged deals that ended up won."""

    user_id: uuid.UUID | None
    user_name: str | None  # None = system-logged (should not happen in practice)
    attempts: int  # attempt_no_answer count
    conversations: int  # talked_advance + talked_objection
    contact_to_conversation_rate: float | None  # 0-1; None without contacts
    visits_scheduled: int
    objections_registered: int  # talked_objection count
    objection_deals: int  # distinct deals with a talked_objection log
    objection_deals_won: int
    objections_overcome_pct: float | None  # 0-100; None without objection deals


class ConversationsReport(BaseModel):
    rows: list[ConversationRow]


# --- Cooling ------------------------------------------------------------------

class CoolingDealRow(BaseModel):
    deal_id: uuid.UUID
    title: str
    stage_name: str
    last_activity_at: str
    days_idle: int


class CoolingOwnerGroup(BaseModel):
    owner_id: uuid.UUID | None
    owner_name: str | None  # None = unassigned queue
    count: int
    deals: list[CoolingDealRow]


class CoolingReport(BaseModel):
    cooling_days: int
    total: int
    groups: list[CoolingOwnerGroup]
