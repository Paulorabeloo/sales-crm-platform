"""Sales-cycle business rules: active-cycle resolution,
activation (single active, partial unique index) and open-deal rollover.
"""

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ValidationFailedError
from app.db.models import ActivityType, Cycle, Deal, DealStatus, User
from app.services.activities import log_activity

logger = logging.getLogger("app.cycles")

# Name of the cycle created on the fly when lead capture runs on a base with
# no cycle at all (see ``resolve_capture_cycle``).
FALLBACK_CYCLE_NAME = "Sem ciclo"


async def get_active_cycle(db: AsyncSession) -> Cycle | None:
    cycle: Cycle | None = await db.scalar(
        select(Cycle).where(Cycle.is_active.is_(True))
    )
    return cycle


async def require_active_cycle(db: AsyncSession) -> Cycle:
    cycle = await get_active_cycle(db)
    if cycle is None:
        raise ValidationFailedError(
            "No active sales cycle configured", "no_active_cycle"
        )
    return cycle


async def resolve_capture_cycle(db: AsyncSession) -> tuple[Cycle, bool]:
    """Cycle for an INBOUND lead (public webhook). Never raises.

    A missing active cycle is a configuration gap on our side, never a reason
    to drop a lead that the landing page already reported as sent. Resolution
    order: the active cycle, else the most recent one by ``starts_on``, else a
    freshly created ``FALLBACK_CYCLE_NAME`` cycle.

    The fallback cycle is created INACTIVE on purpose: ``deals.cycle_id`` stays
    NOT NULL (reports, goals and the win-back list keep working untouched), and
    the admin's own activation decision is never overridden by a webhook hit.

    Returns ``(cycle, used_fallback)`` so the caller can flag the gap.
    """
    cycle = await get_active_cycle(db)
    if cycle is not None:
        return cycle, False

    latest: Cycle | None = await db.scalar(
        select(Cycle).order_by(Cycle.starts_on.desc(), Cycle.created_at.desc()).limit(1)
    )
    if latest is not None:
        return latest, True

    created = Cycle(
        name=FALLBACK_CYCLE_NAME,
        starts_on=datetime.now(UTC).date(),
        is_active=False,
    )
    db.add(created)
    await db.flush()
    return created, True


async def resolve_cycle_for_new_deal(
    db: AsyncSession, cycle_id: uuid.UUID | None
) -> Cycle:
    """Cycle for a new deal: the requested one (must exist) or the active."""
    if cycle_id is None:
        return await require_active_cycle(db)
    cycle = await db.get(Cycle, cycle_id)
    if cycle is None:
        raise ValidationFailedError(
            "cycle_id must reference an existing cycle", "invalid_cycle"
        )
    return cycle


async def activate(db: AsyncSession, cycle: Cycle) -> Cycle:
    """Make ``cycle`` the single active one. Deactivate-then-activate order
    matters: the partial unique index allows at most one active row."""
    if cycle.is_active:
        return cycle
    await db.execute(
        update(Cycle).where(Cycle.is_active.is_(True)).values(is_active=False)
    )
    await db.flush()
    cycle.is_active = True
    await db.flush()
    return cycle


async def rollover(
    db: AsyncSession, source: Cycle, user: User
) -> tuple[int, Cycle]:
    """Move the OPEN deals of ``source`` into the active cycle, logging a
    ``cycle_changed`` activity per deal (the spec rollover). The source's
    won/lost deals stay put — history and metrics are preserved."""
    active = await require_active_cycle(db)
    if source.id == active.id:
        raise ConflictError(
            "Cannot roll the active cycle over onto itself",
            code="cannot_rollover_active_cycle",
        )
    deals = (
        await db.scalars(
            select(Deal).where(
                Deal.cycle_id == source.id,
                Deal.status == DealStatus.OPEN,
                Deal.deleted_at.is_(None),
            )
        )
    ).all()
    for deal in deals:
        deal.cycle_id = active.id
        await db.flush()
        await log_activity(
            db,
            deal_id=deal.id,
            type_=ActivityType.CYCLE_CHANGED,
            user_id=user.id,
            payload={
                "from_cycle_id": str(source.id),
                "to_cycle_id": str(active.id),
                "via": "rollover",
            },
        )
    return len(deals), active
