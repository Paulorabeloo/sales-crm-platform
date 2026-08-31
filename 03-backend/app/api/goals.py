"""Goals (spec 10.3): per-cycle enrollment targets.

CRUD is admin-only. Progress:
- ``GET /goals/progress`` (admin) — every goal of the cycle, ranked by pct.
- ``GET /goals/my-progress`` (authenticated) — the caller's own
  consultant-scope goals (a consultant can always read their own progress).
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import Cycle, Goal, Unit, User
from app.schemas.goal import (
    GoalCreate,
    GoalOut,
    GoalProgressOut,
    GoalProgressRow,
    GoalUpdate,
)
from app.services.cycles import require_active_cycle

router = APIRouter(prefix="/goals", tags=["goals"])

_PROGRESS_SQL = """
SELECT g.id AS goal_id,
       g.cycle_id,
       g.scope,
       g.target_user_id,
       u.name AS target_user_name,
       g.unit_id,
       un.name AS unit_name,
       g.target_count,
       CASE WHEN g.scope = 'consultant' THEN (
           SELECT COUNT(*) FROM deals d
           WHERE d.status = 'won' AND d.deleted_at IS NULL
             AND d.cycle_id = g.cycle_id AND d.owner_id = g.target_user_id
       ) ELSE (
           SELECT COUNT(*) FROM deals d
           WHERE d.status = 'won' AND d.deleted_at IS NULL
             AND d.cycle_id = g.cycle_id AND d.unit_id = g.unit_id
       ) END AS won_count
FROM goals g
LEFT JOIN users u ON u.id = g.target_user_id
LEFT JOIN units un ON un.id = g.unit_id
WHERE g.cycle_id = :cycle_id {extra}
"""


async def _progress_rows(
    db: AsyncSession, cycle_id: uuid.UUID, *, target_user_id: uuid.UUID | None = None
) -> list[GoalProgressRow]:
    extra = "AND g.target_user_id = :target_user_id" if target_user_id else ""
    params: dict[str, str] = {"cycle_id": str(cycle_id)}
    if target_user_id is not None:
        params["target_user_id"] = str(target_user_id)
    rows = (
        await db.execute(text(_PROGRESS_SQL.format(extra=extra)), params)
    ).mappings().all()
    out = [
        GoalProgressRow(
            goal_id=r["goal_id"],
            cycle_id=r["cycle_id"],
            scope=r["scope"],
            target_user_id=r["target_user_id"],
            target_user_name=r["target_user_name"],
            unit_id=r["unit_id"],
            unit_name=r["unit_name"],
            target_count=int(r["target_count"]),
            won_count=int(r["won_count"]),
            pct=round(100.0 * int(r["won_count"]) / int(r["target_count"]), 1),
        )
        for r in rows
    ]
    # Ranking: most complete first, name as the stable tiebreaker.
    out.sort(key=lambda r: (-r.pct, r.target_user_name or r.unit_name or ""))
    return out


async def _resolve_cycle_id(db: AsyncSession, cycle_id: uuid.UUID | None) -> uuid.UUID:
    if cycle_id is None:
        return (await require_active_cycle(db)).id
    if await db.get(Cycle, cycle_id) is None:
        raise ValidationFailedError(
            "cycle_id must reference an existing cycle", "invalid_cycle"
        )
    return cycle_id


@router.get("", response_model=list[GoalOut])
async def list_goals(
    admin: AdminUser, db: DbSession, cycle_id: uuid.UUID | None = None
) -> list[GoalOut]:
    stmt = select(Goal).order_by(Goal.scope, Goal.created_at)
    if cycle_id is not None:
        stmt = stmt.where(Goal.cycle_id == cycle_id)
    goals = (await db.scalars(stmt)).all()
    return [GoalOut.model_validate(g) for g in goals]


@router.get("/progress", response_model=GoalProgressOut)
async def goals_progress(
    admin: AdminUser, db: DbSession, cycle_id: uuid.UUID | None = None
) -> GoalProgressOut:
    """Every goal of the cycle (default: active) with won_count/target/pct,
    ranked by pct — the consultant ranking of spec 10.3."""
    resolved = await _resolve_cycle_id(db, cycle_id)
    return GoalProgressOut(cycle_id=resolved, rows=await _progress_rows(db, resolved))


@router.get("/my-progress", response_model=GoalProgressOut)
async def my_goals_progress(
    user: CurrentUser, db: DbSession, cycle_id: uuid.UUID | None = None
) -> GoalProgressOut:
    """The caller's own consultant-scope goal progress (kanban header bar)."""
    resolved = await _resolve_cycle_id(db, cycle_id)
    rows = await _progress_rows(db, resolved, target_user_id=user.id)
    return GoalProgressOut(cycle_id=resolved, rows=rows)


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
async def create_goal(body: GoalCreate, admin: AdminUser, db: DbSession) -> GoalOut:
    if await db.get(Cycle, body.cycle_id) is None:
        raise ValidationFailedError(
            "cycle_id must reference an existing cycle", "invalid_cycle"
        )
    if body.target_user_id is not None:
        target = await db.scalar(
            select(User).where(
                User.id == body.target_user_id, User.is_active.is_(True)
            )
        )
        if target is None:
            raise ValidationFailedError(
                "target_user_id must reference an active user", "invalid_user"
            )
    if body.unit_id is not None and await db.get(Unit, body.unit_id) is None:
        raise ValidationFailedError(
            "unit_id must reference an existing unit", "invalid_unit"
        )
    duplicate = await db.scalar(
        select(Goal).where(
            Goal.cycle_id == body.cycle_id,
            Goal.target_user_id.is_not_distinct_from(body.target_user_id),
            Goal.unit_id.is_not_distinct_from(body.unit_id),
        )
    )
    if duplicate is not None:
        raise ConflictError(
            "A goal for this target already exists in the cycle"
            " (edit it via PATCH)",
            "duplicate_goal",
        )
    goal = Goal(
        cycle_id=body.cycle_id,
        scope=body.scope,
        target_user_id=body.target_user_id,
        unit_id=body.unit_id,
        target_count=body.target_count,
    )
    db.add(goal)
    await db.flush()
    return GoalOut.model_validate(goal)


@router.patch("/{goal_id}", response_model=GoalOut)
async def update_goal(
    goal_id: uuid.UUID, body: GoalUpdate, admin: AdminUser, db: DbSession
) -> GoalOut:
    goal = await db.get(Goal, goal_id)
    if goal is None:
        raise NotFoundError("Goal", code="goal_not_found")
    goal.target_count = body.target_count
    await db.flush()
    return GoalOut.model_validate(goal)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(goal_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    goal = await db.get(Goal, goal_id)
    if goal is None:
        raise NotFoundError("Goal", code="goal_not_found")
    await db.delete(goal)
    await db.flush()
