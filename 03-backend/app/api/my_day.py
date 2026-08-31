"""My Day — the consultant's prioritized work queue (spec 09.1).

Single aggregate endpoint, role-scoped:
- CONSULTOR: own deals/tasks (+ the unassigned queue in "respond now").
- ADMIN: everything, or one consultant's view via ``?owner_id=``.

Day boundaries use UTC dates (consistent with the rest of the reports; the
operation runs in a single timezone and the follow-up granularity is a day).
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbSession
from app.db.models import Deal, DealStatus, Stage, Task, UserRole
from app.schemas.my_day import MyDayDeal, MyDayResponse, MyDaySection, MyDayTask
from app.services.settings import get_cooling_days

router = APIRouter(tags=["my-day"])


def _make_deal_row(deal: Deal, stage_name: str, cutoff: datetime) -> MyDayDeal:
    return MyDayDeal(
        deal_id=deal.id,
        title=deal.title,
        contact_name=deal.contact.name,
        contact_phone=deal.contact.phone_whatsapp,
        stage_id=deal.stage_id,
        stage_name=stage_name,
        owner_id=deal.owner_id,
        created_at=deal.created_at,
        first_whatsapp_contact_at=deal.first_whatsapp_contact_at,
        next_contact_at=deal.next_contact_at,
        last_activity_at=deal.last_activity_at,
        is_cooling=deal.last_activity_at < cutoff,
        interest_course=(deal.enrollment_data or {}).get("interest_course"),
    )


@router.get("/my-day", response_model=MyDayResponse)
async def my_day(
    user: CurrentUser,
    db: DbSession,
    owner_id: uuid.UUID | None = None,
) -> MyDayResponse:
    """Aggregate work queue. ``owner_id`` is admin-only (ignored otherwise:
    consultants always get their own view)."""
    if user.role == UserRole.ADMIN:
        target_owner = owner_id  # None = whole team
    else:
        target_owner = user.id

    now = datetime.now(UTC)
    today_start = datetime.combine(now.date(), time.min, tzinfo=UTC)
    tomorrow_start = today_start + timedelta(days=1)
    cooling_days = await get_cooling_days(db)
    cutoff = now - timedelta(days=cooling_days)

    # --- Open deals in scope (with contact + stage name), one query ----------
    stmt: Select[Any] = (
        select(Deal, Stage.name)
        .join(Stage, Stage.id == Deal.stage_id)
        .options(selectinload(Deal.contact))
        .where(Deal.status == DealStatus.OPEN, Deal.deleted_at.is_(None))
    )
    if target_owner is not None:
        # Own deals + the unassigned queue (the queue only feeds "respond now").
        stmt = stmt.where(
            or_(Deal.owner_id == target_owner, Deal.owner_id.is_(None))
        )
    stmt = stmt.order_by(Deal.created_at)
    deal_rows = (await db.execute(stmt)).all()

    respond_now: list[MyDayDeal] = []
    today_followups: list[MyDayDeal] = []
    overdue_followups: list[MyDayDeal] = []
    cooling_no_next_step: list[MyDayDeal] = []

    for deal, stage_name in deal_rows:
        owned = target_owner is None or deal.owner_id == target_owner
        row = _make_deal_row(deal, stage_name, cutoff)
        if deal.first_whatsapp_contact_at is None:
            # Section 1 takes own deals AND the unassigned queue.
            respond_now.append(row)
            continue
        if not owned:
            continue  # queue deals only ever show up in "respond now"
        if deal.next_contact_at is not None:
            if today_start <= deal.next_contact_at < tomorrow_start:
                today_followups.append(row)
                continue
            if deal.next_contact_at < today_start:
                overdue_followups.append(row)
                continue
        if row.is_cooling and (
            deal.next_contact_at is None or deal.next_contact_at <= now
        ):
            cooling_no_next_step.append(row)

    # Oldest lead first in "respond now" (query is already created_at asc).
    overdue_followups.sort(key=lambda r: r.next_contact_at or now)

    # --- Pending tasks in scope (with deal title) -----------------------------
    task_stmt: Select[Any] = (
        select(Task, Deal.title)
        .join(Deal, Deal.id == Task.deal_id)
        .where(
            Task.is_done.is_(False),
            Task.due_date <= now.date(),
            Deal.deleted_at.is_(None),
        )
    )
    if target_owner is not None:
        task_stmt = task_stmt.where(Task.assigned_to == target_owner)
    task_stmt = task_stmt.order_by(Task.due_date)
    task_rows = (await db.execute(task_stmt)).all()

    today_tasks: list[MyDayTask] = []
    overdue_tasks: list[MyDayTask] = []
    for task, deal_title in task_rows:
        item = MyDayTask(
            task_id=task.id,
            deal_id=task.deal_id,
            deal_title=deal_title,
            title=task.title,
            due_date=task.due_date,
            assigned_to=task.assigned_to,
        )
        if task.due_date == now.date():
            today_tasks.append(item)
        else:
            overdue_tasks.append(item)

    return MyDayResponse(
        respond_now=respond_now,
        today=MyDaySection(tasks=today_tasks, followups=today_followups),
        overdue=MyDaySection(tasks=overdue_tasks, followups=overdue_followups),
        cooling_no_next_step=cooling_no_next_step,
        cooling_days=cooling_days,
    )
