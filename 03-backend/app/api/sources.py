"""Source catalog (feedback item 5): read authenticated, CRUD admin.

The catalog is the shared vocabulary behind ``deals.source`` and
``campaign_spend.source``. Both columns remain free TEXT for compatibility, but
every write normalizes the value to a catalog ``key`` (see
``app/services/sources.py``), which is what keeps the CAC report from splitting
one channel into "meta", "Meta" and "meta_ads".
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import or_, select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import CampaignSpend, Deal, Source, UserRole
from app.schemas.catalog import SourceCreate, SourceOut, SourceUpdate
from app.services.sources import slugify_source

router = APIRouter(prefix="/sources", tags=["sources"])


def _normalize_key(raw: str) -> str:
    key = slugify_source(raw)
    if not key:
        raise ValidationFailedError(
            "key must contain at least one letter or digit", "invalid_source_key"
        )
    return key


@router.get("", response_model=list[SourceOut])
async def list_sources(
    user: CurrentUser, db: DbSession, include_inactive: bool = False
) -> list[SourceOut]:
    """Active sources for everyone (this feeds the frontend selects);
    ``include_inactive=true`` (admin only, silently ignored otherwise) also
    returns the entries auto-registered from unknown webhook sources."""
    stmt = select(Source).order_by(Source.sort_order, Source.label)
    if not (include_inactive and user.role == UserRole.ADMIN):
        stmt = stmt.where(Source.is_active.is_(True))
    sources = (await db.scalars(stmt)).all()
    return [SourceOut.model_validate(s) for s in sources]


@router.post("", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: SourceCreate, admin: AdminUser, db: DbSession
) -> SourceOut:
    key = _normalize_key(body.key or body.label)
    if await db.scalar(select(Source.id).where(Source.key == key)):
        raise ConflictError(
            f"A source with key {key!r} already exists", "duplicate_source"
        )
    source = Source(
        key=key,
        label=body.label,
        sort_order=body.sort_order,
        is_active=body.is_active,
    )
    db.add(source)
    await db.flush()
    return SourceOut.model_validate(source)


@router.patch("/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: uuid.UUID, body: SourceUpdate, admin: AdminUser, db: DbSession
) -> SourceOut:
    """Renaming ``key`` only changes the catalog entry: rows already written
    with the old key keep it (deals/spend hold plain text). Rename before the
    key is in use, or fix the rows by hand."""
    source = await db.get(Source, source_id)
    if source is None:
        raise NotFoundError("Source", code="source_not_found")
    if body.key is not None:
        key = _normalize_key(body.key)
        if key != source.key:
            if await db.scalar(
                select(Source.id).where(Source.key == key, Source.id != source.id)
            ):
                raise ConflictError(
                    f"A source with key {key!r} already exists", "duplicate_source"
                )
            source.key = key
    if body.label is not None:
        source.label = body.label
    if body.sort_order is not None:
        source.sort_order = body.sort_order
    if body.is_active is not None:
        source.is_active = body.is_active
    await db.flush()
    return SourceOut.model_validate(source)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(source_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    """Hard delete, only while nothing references the key (prefer deactivating:
    deleting a key still referenced would orphan the label in the reports)."""
    source = await db.get(Source, source_id)
    if source is None:
        raise NotFoundError("Source", code="source_not_found")
    referenced = await db.scalar(
        select(
            or_(
                select(Deal.id).where(Deal.source == source.key).exists(),
                select(CampaignSpend.id)
                .where(CampaignSpend.source == source.key)
                .exists(),
            )
        )
    )
    if referenced:
        raise ConflictError(
            "Source is referenced by deals or campaign spend; deactivate it instead",
            "source_in_use",
        )
    await db.delete(source)
    await db.flush()
