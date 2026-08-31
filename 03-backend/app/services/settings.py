"""App settings access (key-value JSONB table).

Keys in use:
- ``cooling_days`` (int, default 3) — "cooling lead" threshold.
- ``auto_first_contact_task`` (bool, default true) — webhook leads get an
  automatic "Make first contact" task due today (spec 09.3).
- ``followup_cadence`` (list[int] of day offsets, default [1, 3, 7]) — the
  suggested next-attempt interval after each no-answer attempt: index 0 for
  the 1st attempt, index 1 for the 2nd, last item for every attempt after.
  Purely a suggestion consumed by the frontend prompt — no cron/job involved.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AppSetting

DEFAULT_COOLING_DAYS = 3
DEFAULT_AUTO_FIRST_CONTACT_TASK = True
DEFAULT_FOLLOWUP_CADENCE: list[int] = [1, 3, 7]


async def _set_value(db: AsyncSession, key: str, value: object) -> None:
    row = await db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    await db.flush()


async def get_cooling_days(db: AsyncSession) -> int:
    row = await db.get(AppSetting, "cooling_days")
    if row is None or not isinstance(row.value, int):
        return DEFAULT_COOLING_DAYS
    return row.value


async def set_cooling_days(db: AsyncSession, days: int) -> None:
    await _set_value(db, "cooling_days", days)


async def get_auto_first_contact_task(db: AsyncSession) -> bool:
    row = await db.get(AppSetting, "auto_first_contact_task")
    if row is None or not isinstance(row.value, bool):
        return DEFAULT_AUTO_FIRST_CONTACT_TASK
    return row.value


async def set_auto_first_contact_task(db: AsyncSession, enabled: bool) -> None:
    await _set_value(db, "auto_first_contact_task", enabled)


async def get_followup_cadence(db: AsyncSession) -> list[int]:
    row = await db.get(AppSetting, "followup_cadence")
    if (
        row is None
        or not isinstance(row.value, list)
        or not row.value
        or not all(isinstance(v, int) and not isinstance(v, bool) for v in row.value)
    ):
        return list(DEFAULT_FOLLOWUP_CADENCE)
    return list(row.value)


async def set_followup_cadence(db: AsyncSession, cadence: list[int]) -> None:
    await _set_value(db, "followup_cadence", cadence)
