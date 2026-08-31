"""Management reports (admin only) — "why aren't we selling?"."""

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import AdminUser, DbSession
from app.core.exceptions import ValidationFailedError
from app.db.models import Cycle
from app.schemas.report import (
    CacReport,
    ConversationsReport,
    CoolingReport,
    FunnelReport,
    LostReasonsReport,
    ResponseTimeReport,
    SalesReport,
    SummaryReport,
)
from app.services import deals as deal_service
from app.services import reports as report_service

router = APIRouter(prefix="/reports", tags=["reports"])


def _period(
    date_from: datetime | None, date_to: datetime | None
) -> tuple[datetime, datetime]:
    """Default period: last 30 days. ``to`` is exclusive."""
    now = datetime.now(UTC)
    if date_to is None:
        date_to = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=UTC)
    elif date_to.tzinfo is None:
        date_to = date_to.replace(tzinfo=UTC)
    if date_from is None:
        date_from = date_to - timedelta(days=30)
    elif date_from.tzinfo is None:
        date_from = date_from.replace(tzinfo=UTC)
    return date_from, date_to


@router.get("/summary", response_model=SummaryReport)
async def summary(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> SummaryReport:
    """Dashboard KPI cards: leads, conversion, response time, sales, CAC."""
    f, t = _period(date_from, date_to)
    return await report_service.summary_report(
        db, date_from=f, date_to=t, unit_id=unit_id, owner_id=owner_id,
        cycle_id=cycle_id,
    )


@router.get("/funnel", response_model=FunnelReport)
async def funnel(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    pipeline_id: uuid.UUID | None = None,
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> FunnelReport:
    """Deals entering each stage + stage-to-stage conversion (from
    ``deal_stage_history``) — shows where deals die."""
    f, t = _period(date_from, date_to)
    if pipeline_id is None:
        pipeline_id = (await deal_service.get_default_pipeline(db)).id
    return await report_service.funnel_report(
        db, pipeline_id=pipeline_id, date_from=f, date_to=t,
        unit_id=unit_id, owner_id=owner_id, cycle_id=cycle_id,
    )


@router.get("/lost-reasons", response_model=LostReasonsReport)
async def lost_reasons(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> LostReasonsReport:
    """Ranking of lost reasons (count, %, value) + objections both from the
    catalog (``deals.objection_id``) and the free-text legacy
    (``enrollment_data.main_objection``)."""
    f, t = _period(date_from, date_to)
    return await report_service.lost_reasons_report(
        db, date_from=f, date_to=t, unit_id=unit_id, owner_id=owner_id,
        cycle_id=cycle_id,
    )


@router.get("/response-time", response_model=ResponseTimeReport)
async def response_time(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    cycle_id: uuid.UUID | None = None,
) -> ResponseTimeReport:
    """Avg/median/p90 of first-contact delay per consultant + % of leads
    without first contact within 24h."""
    f, t = _period(date_from, date_to)
    return await report_service.response_time_report(
        db, date_from=f, date_to=t, cycle_id=cycle_id
    )


@router.get("/sales", response_model=SalesReport)
async def sales(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    group_by: Literal["unit", "owner", "month"] = Query(default="month"),
    cycle_id: uuid.UUID | None = None,
) -> SalesReport:
    """Won deals: count, total value and average ticket per group."""
    f, t = _period(date_from, date_to)
    return await report_service.sales_report(
        db, date_from=f, date_to=t, group_by=group_by, cycle_id=cycle_id
    )


@router.get("/cooling", response_model=CoolingReport)
async def cooling(
    admin: AdminUser, db: DbSession, cycle_id: uuid.UUID | None = None
) -> CoolingReport:
    """Open deals idle beyond ``cooling_days``, grouped by owner."""
    return await report_service.cooling_report(db, cycle_id=cycle_id)


@router.get("/cac", response_model=CacReport)
async def cac(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    cycle_id: uuid.UUID | None = None,
    group_by: Literal["source", "campaign", "unit", "month"] = Query(default="source"),
) -> CacReport:
    """Cost per enrollment: registered spend x leads x won deals
    per source/campaign/unit/month. Period comes from ``from``/``to`` OR from
    a ``cycle_id`` (the cycle's deals + its months of spend). Cost fields are
    null when there is no matching spend — never fabricated."""
    cycle: Cycle | None = None
    if cycle_id is not None:
        cycle = await db.get(Cycle, cycle_id)
        if cycle is None:
            raise ValidationFailedError(
                "cycle_id must reference an existing cycle", "invalid_cycle"
            )
    f, t = _period(date_from, date_to)
    return await report_service.cac_report(
        db, date_from=f, date_to=t, cycle=cycle, group_by=group_by
    )


@router.get("/conversations", response_model=ConversationsReport)
async def conversations(
    admin: AdminUser,
    db: DbSession,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    cycle_id: uuid.UUID | None = None,
) -> ConversationsReport:
    """Per-consultant conversation quality: attempts, real
    conversations, contact->conversation rate, scheduled visits, registered
    objections and % of objection deals later won."""
    f, t = _period(date_from, date_to)
    return await report_service.conversations_report(
        db, date_from=f, date_to=t, cycle_id=cycle_id
    )
