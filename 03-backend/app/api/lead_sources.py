"""Lead sources (admin only): one capture source = one webhook token.
Revoking keeps the delivery log and stops the token from authenticating."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import AdminUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.core.security import generate_lead_source_token
from app.db.models import LeadSource, Pipeline, Unit
from app.schemas.catalog import LeadSourceCreate, LeadSourceOut, LeadSourceUpdate

router = APIRouter(prefix="/lead-sources", tags=["lead-sources"])


async def _get_source_or_404(db: DbSession, source_id: uuid.UUID) -> LeadSource:
    source = await db.get(LeadSource, source_id)
    if source is None:
        raise NotFoundError("Lead source", code="lead_source_not_found")
    return source


async def _validate_defaults(
    db: DbSession, unit_id: uuid.UUID | None, pipeline_id: uuid.UUID | None
) -> None:
    if unit_id is not None and await db.get(Unit, unit_id) is None:
        raise ValidationFailedError("default_unit_id must exist", "invalid_unit")
    if pipeline_id is not None and await db.get(Pipeline, pipeline_id) is None:
        raise ValidationFailedError("default_pipeline_id must exist", "invalid_pipeline")


@router.get("", response_model=list[LeadSourceOut])
async def list_lead_sources(admin: AdminUser, db: DbSession) -> list[LeadSourceOut]:
    sources = (await db.scalars(select(LeadSource).order_by(LeadSource.name))).all()
    return [LeadSourceOut.model_validate(s) for s in sources]


@router.post("", response_model=LeadSourceOut, status_code=status.HTTP_201_CREATED)
async def create_lead_source(
    body: LeadSourceCreate, admin: AdminUser, db: DbSession
) -> LeadSourceOut:
    """Creates the source and generates its webhook token. The webhook URL is
    ``POST /api/v1/webhooks/leads/{token}``."""
    if await db.scalar(select(LeadSource).where(LeadSource.name == body.name)):
        raise ConflictError("A lead source with this name already exists", "duplicate_source")
    await _validate_defaults(db, body.default_unit_id, body.default_pipeline_id)
    source = LeadSource(
        name=body.name,
        token=generate_lead_source_token(),
        default_unit_id=body.default_unit_id,
        default_pipeline_id=body.default_pipeline_id,
    )
    db.add(source)
    await db.flush()
    return LeadSourceOut.model_validate(source)


@router.patch("/{source_id}", response_model=LeadSourceOut)
async def update_lead_source(
    source_id: uuid.UUID, body: LeadSourceUpdate, admin: AdminUser, db: DbSession
) -> LeadSourceOut:
    source = await _get_source_or_404(db, source_id)
    await _validate_defaults(db, body.default_unit_id, body.default_pipeline_id)
    if body.name is not None:
        source.name = body.name
    if body.default_unit_id is not None:
        source.default_unit_id = body.default_unit_id
    if body.default_pipeline_id is not None:
        source.default_pipeline_id = body.default_pipeline_id
    await db.flush()
    return LeadSourceOut.model_validate(source)


@router.post("/{source_id}/revoke", response_model=LeadSourceOut)
async def revoke_lead_source(
    source_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> LeadSourceOut:
    """Revoke the token: the source stops accepting webhook hits immediately."""
    source = await _get_source_or_404(db, source_id)
    if source.revoked_at is not None:
        raise ConflictError("Lead source is already revoked", "already_revoked")
    source.is_active = False
    source.revoked_at = datetime.now(UTC)
    await db.flush()
    return LeadSourceOut.model_validate(source)


@router.post("/{source_id}/rotate-token", response_model=LeadSourceOut)
async def rotate_lead_source_token(
    source_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> LeadSourceOut:
    """Issue a fresh token for an active source (old token stops working)."""
    source = await _get_source_or_404(db, source_id)
    if source.revoked_at is not None:
        raise ConflictError("Cannot rotate a revoked source", "already_revoked")
    source.token = generate_lead_source_token()
    await db.flush()
    return LeadSourceOut.model_validate(source)
