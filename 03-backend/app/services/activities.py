"""Activity emission — the single door for timeline events.

System events (everything except ``note``) are created here by the backend
only; the DB trigger on ``activities`` bumps ``deals.last_activity_at``
("warms" the lead) for every insert.
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, ActivityType


async def log_activity(
    db: AsyncSession,
    *,
    deal_id: uuid.UUID,
    type_: ActivityType,
    user_id: uuid.UUID | None,
    body: str | None = None,
    payload: dict[str, Any] | None = None,
) -> Activity:
    activity = Activity(
        deal_id=deal_id,
        type=type_,
        body=body,
        payload=payload or {},
        user_id=user_id,
    )
    db.add(activity)
    await db.flush()
    return activity
