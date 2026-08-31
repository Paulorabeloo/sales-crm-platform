"""Tasks: per-deal to-dos + "my tasks" buckets (overdue / today / upcoming)."""

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.db.models import ActivityType, Task, User
from app.schemas.task import MyTasksResponse, TaskCreate, TaskOut, TaskUpdate
from app.services import deals as deal_service
from app.services.activities import log_activity

router = APIRouter(tags=["tasks"])


@router.post(
    "/deals/{deal_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED
)
async def create_task(
    deal_id: uuid.UUID, body: TaskCreate, user: CurrentUser, db: DbSession
) -> TaskOut:
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    assigned_to = body.assigned_to or deal.owner_id or user.id
    if body.assigned_to is not None:
        assignee = await db.scalar(
            select(User).where(User.id == body.assigned_to, User.is_active.is_(True))
        )
        if assignee is None:
            raise ValidationFailedError(
                "assigned_to must reference an active user", "invalid_assignee"
            )
    task = Task(
        deal_id=deal.id,
        title=body.title,
        due_date=body.due_date,
        assigned_to=assigned_to,
        created_by=user.id,
    )
    db.add(task)
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.TASK_CREATED,
        user_id=user.id,
        payload={"task_id": str(task.id), "title": task.title},
    )
    return TaskOut.model_validate(task)


@router.get("/deals/{deal_id}/tasks", response_model=list[TaskOut])
async def list_deal_tasks(
    deal_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[TaskOut]:
    deal = await deal_service.get_deal_scoped(db, deal_id, user)
    tasks = (
        await db.scalars(
            select(Task)
            .where(Task.deal_id == deal.id)
            .order_by(Task.is_done, Task.due_date)
        )
    ).all()
    return [TaskOut.model_validate(t) for t in tasks]


@router.get("/tasks/my", response_model=MyTasksResponse)
async def my_tasks(user: CurrentUser, db: DbSession) -> MyTasksResponse:
    """Pending tasks assigned to me, bucketed: overdue / due today / upcoming."""
    today = date.today()
    tasks = (
        await db.scalars(
            select(Task)
            .where(Task.assigned_to == user.id, Task.is_done.is_(False))
            .order_by(Task.due_date)
        )
    ).all()
    out = [TaskOut.model_validate(t) for t in tasks]
    return MyTasksResponse(
        overdue=[t for t in out if t.due_date < today],
        today=[t for t in out if t.due_date == today],
        upcoming=[t for t in out if t.due_date > today],
    )


async def _get_task_scoped(
    db: DbSession, task_id: uuid.UUID, user: CurrentUser, *, for_edit: bool = False
) -> Task:
    """Resolve a task through its deal's scope.

    ``for_edit=True`` applies the deal EDITABILITY rule (M2): unassigned queue
    deals are read-only + claim, so completing/editing/deleting their tasks
    requires being the deal owner (or admin) — same rule as won/lost/move/note.
    Out-of-scope -> 404; visible but not editable -> 403 ``not_deal_owner``.
    """
    task = await db.get(Task, task_id)
    if task is None:
        raise NotFoundError("Task", code="task_not_found")
    await deal_service.get_deal_scoped(db, task.deal_id, user, for_edit=for_edit)
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, user: CurrentUser, db: DbSession
) -> TaskOut:
    task = await _get_task_scoped(db, task_id, user, for_edit=True)
    if body.title is not None:
        task.title = body.title
    if body.due_date is not None:
        task.due_date = body.due_date
    if body.assigned_to is not None:
        assignee = await db.scalar(
            select(User).where(User.id == body.assigned_to, User.is_active.is_(True))
        )
        if assignee is None:
            raise ValidationFailedError(
                "assigned_to must reference an active user", "invalid_assignee"
            )
        task.assigned_to = body.assigned_to
    if body.is_done is not None and body.is_done != task.is_done:
        task.is_done = body.is_done
        task.done_at = datetime.now(UTC) if body.is_done else None
        if body.is_done:
            await log_activity(
                db,
                deal_id=task.deal_id,
                type_=ActivityType.TASK_COMPLETED,
                user_id=user.id,
                payload={"task_id": str(task.id), "title": task.title},
            )
    await db.flush()
    return TaskOut.model_validate(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    task = await _get_task_scoped(db, task_id, user, for_edit=True)
    await db.delete(task)
    await db.flush()
