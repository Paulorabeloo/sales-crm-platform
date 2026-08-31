"""Campaign spend input — admin-only monthly ad-spend records.

One row per (month, source, campaign, unit) combination; the CAC report joins
these against won deals. Amounts are edited via PATCH; identity changes are
delete + recreate.
"""

import uuid
from datetime import date

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import AdminUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import CampaignSpend, Unit
from app.schemas.spend import (
    CampaignSpendCreate,
    CampaignSpendOut,
    CampaignSpendUpdate,
)

router = APIRouter(prefix="/campaign-spend", tags=["campaign-spend"])


@router.get("", response_model=list[CampaignSpendOut])
async def list_campaign_spend(
    admin: AdminUser,
    db: DbSession,
    month_from: date | None = None,
    month_to: date | None = None,
) -> list[CampaignSpendOut]:
    stmt = select(CampaignSpend).order_by(
        CampaignSpend.month.desc(), CampaignSpend.source, CampaignSpend.campaign
    )
    if month_from is not None:
        stmt = stmt.where(CampaignSpend.month >= month_from.replace(day=1))
    if month_to is not None:
        stmt = stmt.where(CampaignSpend.month <= month_to.replace(day=1))
    rows = (await db.scalars(stmt)).all()
    return [CampaignSpendOut.model_validate(r) for r in rows]


@router.post("", response_model=CampaignSpendOut, status_code=status.HTTP_201_CREATED)
async def create_campaign_spend(
    body: CampaignSpendCreate, admin: AdminUser, db: DbSession
) -> CampaignSpendOut:
    if body.unit_id is not None and await db.get(Unit, body.unit_id) is None:
        raise ValidationFailedError(
            "unit_id must reference an existing unit", "invalid_unit"
        )
    duplicate = await db.scalar(
        select(CampaignSpend).where(
            CampaignSpend.month == body.month,
            CampaignSpend.source == body.source,
            CampaignSpend.campaign.is_not_distinct_from(body.campaign),
            CampaignSpend.unit_id.is_not_distinct_from(body.unit_id),
        )
    )
    if duplicate is not None:
        raise ConflictError(
            "Spend for this month/source/campaign/unit already exists"
            " (edit the amount via PATCH)",
            "duplicate_spend",
        )
    spend = CampaignSpend(
        month=body.month,
        source=body.source,
        campaign=body.campaign,
        unit_id=body.unit_id,
        amount=body.amount,
    )
    db.add(spend)
    await db.flush()
    return CampaignSpendOut.model_validate(spend)


@router.patch("/{spend_id}", response_model=CampaignSpendOut)
async def update_campaign_spend(
    spend_id: uuid.UUID, body: CampaignSpendUpdate, admin: AdminUser, db: DbSession
) -> CampaignSpendOut:
    spend = await db.get(CampaignSpend, spend_id)
    if spend is None:
        raise NotFoundError("Campaign spend", code="spend_not_found")
    spend.amount = body.amount
    await db.flush()
    return CampaignSpendOut.model_validate(spend)


@router.delete("/{spend_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign_spend(
    spend_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> None:
    spend = await db.get(CampaignSpend, spend_id)
    if spend is None:
        raise NotFoundError("Campaign spend", code="spend_not_found")
    await db.delete(spend)
    await db.flush()
