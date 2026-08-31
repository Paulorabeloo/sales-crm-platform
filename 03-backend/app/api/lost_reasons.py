"""Lost reasons catalog: read authenticated, write admin-only.
Deactivate instead of delete — historical reports keep their labels."""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError
from app.db.models import LostReason
from app.schemas.catalog import LostReasonCreate, LostReasonOut, LostReasonUpdate

router = APIRouter(prefix="/lost-reasons", tags=["lost-reasons"])


@router.get("", response_model=list[LostReasonOut])
async def list_lost_reasons(user: CurrentUser, db: DbSession) -> list[LostReasonOut]:
    reasons = (
        await db.scalars(select(LostReason).order_by(LostReason.sort_order))
    ).all()
    return [LostReasonOut.model_validate(r) for r in reasons]


@router.post("", response_model=LostReasonOut, status_code=status.HTTP_201_CREATED)
async def create_lost_reason(
    body: LostReasonCreate, admin: AdminUser, db: DbSession
) -> LostReasonOut:
    if await db.scalar(select(LostReason).where(LostReason.label == body.label)):
        raise ConflictError("This lost reason already exists", "duplicate_lost_reason")
    reason = LostReason(
        label=body.label,
        sort_order=body.sort_order,
        is_recoverable=body.is_recoverable,
    )
    db.add(reason)
    await db.flush()
    return LostReasonOut.model_validate(reason)


@router.patch("/{reason_id}", response_model=LostReasonOut)
async def update_lost_reason(
    reason_id: uuid.UUID, body: LostReasonUpdate, admin: AdminUser, db: DbSession
) -> LostReasonOut:
    reason = await db.get(LostReason, reason_id)
    if reason is None:
        raise NotFoundError("Lost reason", code="lost_reason_not_found")
    if body.label is not None:
        reason.label = body.label
    if body.sort_order is not None:
        reason.sort_order = body.sort_order
    if body.is_active is not None:
        reason.is_active = body.is_active
    if body.is_recoverable is not None:
        # Win-back flag: losses with this reason enter the
        # rescue list of previous cycles.
        reason.is_recoverable = body.is_recoverable
    await db.flush()
    return LostReasonOut.model_validate(reason)
