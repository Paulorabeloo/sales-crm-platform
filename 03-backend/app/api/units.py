"""Units catalog: read for any authenticated user, write admin-only."""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError
from app.db.models import Unit
from app.schemas.catalog import UnitCreate, UnitOut, UnitUpdate

router = APIRouter(prefix="/units", tags=["units"])


@router.get("", response_model=list[UnitOut])
async def list_units(user: CurrentUser, db: DbSession) -> list[UnitOut]:
    units = (await db.scalars(select(Unit).order_by(Unit.name))).all()
    return [UnitOut.model_validate(p) for p in units]


@router.post("", response_model=UnitOut, status_code=status.HTTP_201_CREATED)
async def create_unit(body: UnitCreate, admin: AdminUser, db: DbSession) -> UnitOut:
    if await db.scalar(select(Unit).where(Unit.name == body.name)):
        raise ConflictError("A unit with this name already exists", "duplicate_unit_name")
    unit = Unit(name=body.name)
    db.add(unit)
    await db.flush()
    return UnitOut.model_validate(unit)


@router.patch("/{unit_id}", response_model=UnitOut)
async def update_unit(
    unit_id: uuid.UUID, body: UnitUpdate, admin: AdminUser, db: DbSession
) -> UnitOut:
    unit = await db.get(Unit, unit_id)
    if unit is None:
        raise NotFoundError("Unit", code="unit_not_found")
    if body.name is not None:
        unit.name = body.name
    if body.is_active is not None:
        unit.is_active = body.is_active
    await db.flush()
    return UnitOut.model_validate(unit)
