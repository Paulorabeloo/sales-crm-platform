"""Objection catalog (spec 12.2): read authenticated, CRUD admin.

Each objection carries a suggested rebuttal and an optional linked WhatsApp
template (spec 09.4). Deals reference objections via ``deals.objection_id``
(FK RESTRICT), so referenced objections must be deactivated, not deleted.
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import Deal, MessageTemplate, Objection, UserRole
from app.schemas.catalog import ObjectionCreate, ObjectionOut, ObjectionUpdate

router = APIRouter(prefix="/objections", tags=["objections"])


async def _ensure_template_exists(
    db: AsyncSession, template_id: uuid.UUID
) -> None:
    if await db.get(MessageTemplate, template_id) is None:
        raise ValidationFailedError(
            "template_id must reference an existing message template",
            "invalid_template",
        )


@router.get("", response_model=list[ObjectionOut])
async def list_objections(
    user: CurrentUser, db: DbSession, include_inactive: bool = False
) -> list[ObjectionOut]:
    """Active objections for everyone; ``include_inactive=true`` (admin only,
    silently ignored otherwise) also returns deactivated ones."""
    stmt = select(Objection).order_by(Objection.sort_order, Objection.name)
    if not (include_inactive and user.role == UserRole.ADMIN):
        stmt = stmt.where(Objection.is_active.is_(True))
    objections = (await db.scalars(stmt)).all()
    return [ObjectionOut.model_validate(o) for o in objections]


@router.post("", response_model=ObjectionOut, status_code=status.HTTP_201_CREATED)
async def create_objection(
    body: ObjectionCreate, admin: AdminUser, db: DbSession
) -> ObjectionOut:
    if await db.scalar(select(Objection).where(Objection.name == body.name)):
        raise ConflictError(
            "An objection with this name already exists", "duplicate_objection"
        )
    if body.template_id is not None:
        await _ensure_template_exists(db, body.template_id)
    objection = Objection(
        name=body.name,
        rebuttal=body.rebuttal,
        template_id=body.template_id,
        sort_order=body.sort_order,
    )
    db.add(objection)
    await db.flush()
    return ObjectionOut.model_validate(objection)


@router.patch("/{objection_id}", response_model=ObjectionOut)
async def update_objection(
    objection_id: uuid.UUID, body: ObjectionUpdate, admin: AdminUser, db: DbSession
) -> ObjectionOut:
    objection = await db.get(Objection, objection_id)
    if objection is None:
        raise NotFoundError("Objection", code="objection_not_found")
    if body.name is not None and body.name != objection.name:
        if await db.scalar(
            select(Objection).where(
                Objection.name == body.name, Objection.id != objection.id
            )
        ):
            raise ConflictError(
                "An objection with this name already exists", "duplicate_objection"
            )
        objection.name = body.name
    if body.rebuttal is not None:
        objection.rebuttal = body.rebuttal
    if "template_id" in body.model_fields_set:
        # Explicit null unlinks the template.
        if body.template_id is not None:
            await _ensure_template_exists(db, body.template_id)
        objection.template_id = body.template_id
    if body.sort_order is not None:
        objection.sort_order = body.sort_order
    if body.is_active is not None:
        objection.is_active = body.is_active
    await db.flush()
    return ObjectionOut.model_validate(objection)


@router.delete("/{objection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_objection(
    objection_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> None:
    """Hard delete, only when no deal references it (prefer deactivating)."""
    objection = await db.get(Objection, objection_id)
    if objection is None:
        raise NotFoundError("Objection", code="objection_not_found")
    referenced = await db.scalar(
        select(func.count()).select_from(Deal).where(Deal.objection_id == objection.id)
    )
    if referenced:
        raise ConflictError(
            "Objection is referenced by deals; deactivate it instead",
            "objection_in_use",
        )
    await db.delete(objection)
    await db.flush()
