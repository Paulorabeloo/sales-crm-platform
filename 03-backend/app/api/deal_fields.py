"""Deal field catalog — feeds the required-fields multi-select in
the stage settings UI. Keys + types only; pt-BR labels live in the frontend."""

from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.schemas.catalog import DealFieldOut
from app.services.deal_fields import field_catalog

router = APIRouter(tags=["deal-fields"])


@router.get("/deal-fields", response_model=list[DealFieldOut])
async def list_deal_fields(user: CurrentUser) -> list[DealFieldOut]:
    """Every field key an admin may mark as required on a stage."""
    return [
        DealFieldOut(key=key, type=type_) for key, type_ in field_catalog().items()
    ]
