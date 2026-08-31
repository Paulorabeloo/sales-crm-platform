"""Global app settings. Read: any authenticated user (the kanban and the deal
detail need ``cooling_days``; the follow-up prompt needs the cadence); write:
admin only."""

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.schemas.settings import AppSettingsOut, AppSettingsUpdate
from app.services.settings import (
    get_auto_first_contact_task,
    get_cooling_days,
    get_followup_cadence,
    set_auto_first_contact_task,
    set_cooling_days,
    set_followup_cadence,
)

router = APIRouter(prefix="/settings", tags=["settings"])


async def _current_settings(db: AsyncSession) -> AppSettingsOut:
    return AppSettingsOut(
        cooling_days=await get_cooling_days(db),
        auto_first_contact_task=await get_auto_first_contact_task(db),
        followup_cadence=await get_followup_cadence(db),
    )


@router.get("", response_model=AppSettingsOut)
async def get_settings_endpoint(user: CurrentUser, db: DbSession) -> AppSettingsOut:
    return await _current_settings(db)


@router.patch("", response_model=AppSettingsOut)
async def update_settings_endpoint(
    body: AppSettingsUpdate, admin: AdminUser, db: DbSession
) -> AppSettingsOut:
    if body.cooling_days is not None:
        await set_cooling_days(db, body.cooling_days)
    if body.auto_first_contact_task is not None:
        await set_auto_first_contact_task(db, body.auto_first_contact_task)
    if body.followup_cadence is not None:
        await set_followup_cadence(db, body.followup_cadence)
    return await _current_settings(db)
