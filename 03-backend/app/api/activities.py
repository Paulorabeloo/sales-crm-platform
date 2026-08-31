"""Deal timeline: manual notes (POST) + full event history (GET).

System events (stage_changed, status_changed, first_contact_registered, ...)
are emitted by the services — clients can only create notes."""

import uuid

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession
from app.db.models import Activity, ActivityType, User
from app.schemas.activity import ActivityOut, NoteCreate
from app.schemas.common import Page
from app.services import deals as deal_service
from app.services.activities import log_activity

router = APIRouter(tags=["activities"])


@router.post(
    "/deals/{deal_id}/activities",
    response_model=ActivityOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    deal_id: uuid.UUID, body: NoteCreate, user: CurrentUser, db: DbSession
) -> ActivityOut:
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    activity = await log_activity(
        db, deal_id=deal.id, type_=ActivityType.NOTE, user_id=user.id, body=body.body
    )
    out = ActivityOut.model_validate(activity)
    out.user_name = user.name
    return out


@router.get("/deals/{deal_id}/activities", response_model=Page[ActivityOut])
async def deal_timeline(
    deal_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[ActivityOut]:
    """Timeline newest-first: manual notes + automatic events."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user)
    base = select(Activity).where(Activity.deal_id == deal.id)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(
            select(Activity, User.name)
            .join(User, User.id == Activity.user_id, isouter=True)
            .where(Activity.deal_id == deal.id)
            .order_by(Activity.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = []
    for activity, user_name in rows:
        out = ActivityOut.model_validate(activity)
        out.user_name = user_name
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)
