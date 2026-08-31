"""Sales cycles (spec 10.1): read authenticated, CRUD + activation admin.

At most one active cycle (partial unique index). New deals default to the
active cycle; the kanban countdown reads ``GET /cycles/active``.
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError
from app.db.models import Cycle, Deal
from app.schemas.cycle import CycleCreate, CycleOut, CycleUpdate, RolloverOut
from app.services import cycles as cycle_service

router = APIRouter(prefix="/cycles", tags=["cycles"])


@router.get("", response_model=list[CycleOut])
async def list_cycles(user: CurrentUser, db: DbSession) -> list[CycleOut]:
    """All cycles, newest start first (filter dropdowns + admin settings)."""
    cycles = (
        await db.scalars(
            select(Cycle).order_by(Cycle.starts_on.desc(), Cycle.created_at.desc())
        )
    ).all()
    return [CycleOut.model_validate(c) for c in cycles]


@router.get("/active", response_model=CycleOut)
async def get_active_cycle(user: CurrentUser, db: DbSession) -> CycleOut:
    """The single active cycle (404 when none is configured)."""
    cycle = await cycle_service.get_active_cycle(db)
    if cycle is None:
        raise NotFoundError("Active cycle", code="no_active_cycle")
    return CycleOut.model_validate(cycle)


@router.post("", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
async def create_cycle(body: CycleCreate, admin: AdminUser, db: DbSession) -> CycleOut:
    if await db.scalar(select(Cycle).where(Cycle.name == body.name)):
        raise ConflictError("A cycle with this name already exists", "duplicate_cycle")
    cycle = Cycle(
        name=body.name, starts_on=body.starts_on, deadline_on=body.deadline_on
    )
    db.add(cycle)
    await db.flush()
    if body.is_active:
        await cycle_service.activate(db, cycle)
    return CycleOut.model_validate(cycle)


@router.patch("/{cycle_id}", response_model=CycleOut)
async def update_cycle(
    cycle_id: uuid.UUID, body: CycleUpdate, admin: AdminUser, db: DbSession
) -> CycleOut:
    """Name/dates only — activation is the dedicated ``/activate`` action."""
    cycle = await db.get(Cycle, cycle_id)
    if cycle is None:
        raise NotFoundError("Cycle", code="cycle_not_found")
    if body.name is not None and body.name != cycle.name:
        if await db.scalar(
            select(Cycle).where(Cycle.name == body.name, Cycle.id != cycle.id)
        ):
            raise ConflictError(
                "A cycle with this name already exists", "duplicate_cycle"
            )
        cycle.name = body.name
    if body.starts_on is not None:
        cycle.starts_on = body.starts_on
    if "deadline_on" in body.model_fields_set:
        # Explicit null clears the deadline (no countdown).
        cycle.deadline_on = body.deadline_on
    await db.flush()
    return CycleOut.model_validate(cycle)


@router.delete("/{cycle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cycle(cycle_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    """Hard delete, only for cycles never used: active or holding deals -> 409."""
    cycle = await db.get(Cycle, cycle_id)
    if cycle is None:
        raise NotFoundError("Cycle", code="cycle_not_found")
    if cycle.is_active:
        raise ConflictError(
            "The active cycle cannot be deleted", "cannot_delete_active_cycle"
        )
    deal_count = await db.scalar(
        select(func.count()).select_from(Deal).where(Deal.cycle_id == cycle.id)
    )
    if deal_count:
        raise ConflictError("Cycle has deals and cannot be deleted", "cycle_has_deals")
    await db.delete(cycle)
    await db.flush()


@router.post("/{cycle_id}/activate", response_model=CycleOut)
async def activate_cycle(
    cycle_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> CycleOut:
    """Make this cycle the active one (the previous active is deactivated)."""
    cycle = await db.get(Cycle, cycle_id)
    if cycle is None:
        raise NotFoundError("Cycle", code="cycle_not_found")
    cycle = await cycle_service.activate(db, cycle)
    return CycleOut.model_validate(cycle)


@router.post("/{cycle_id}/rollover", response_model=RolloverOut)
async def rollover_cycle(
    cycle_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> RolloverOut:
    """Move the OPEN deals of cycle ``{cycle_id}`` (a previous cycle) into the
    ACTIVE cycle, logging a ``cycle_changed`` activity on each moved deal."""
    source = await db.get(Cycle, cycle_id)
    if source is None:
        raise NotFoundError("Cycle", code="cycle_not_found")
    moved, active = await cycle_service.rollover(db, source, admin)
    return RolloverOut(from_cycle_id=source.id, to_cycle_id=active.id, moved_count=moved)
