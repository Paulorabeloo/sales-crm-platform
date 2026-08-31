"""Public lead-capture webhook — the only unauthenticated endpoint besides
``/health``. Authenticates by the lead-source token in the URL."""

import json

from fastapi import APIRouter, Request, status

from app.core.config import get_settings
from app.core.deps import DbSession, client_ip
from app.core.exceptions import (
    NotFoundError,
    RateLimitedError,
    ValidationFailedError,
)
from app.core.rate_limit import webhook_ip_limiter, webhook_token_limiter
from app.db.models import Deal
from app.schemas.webhook import LeadWebhookResponse
from app.services import webhook as webhook_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post(
    "/leads/{token}",
    response_model=LeadWebhookResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_lead(token: str, request: Request, db: DbSession) -> LeadWebhookResponse:
    """Receive a lead from a capture source (Apps Script LP, Meta relay, ...).

    Behavior (architecture §2.7 / §5.8):
    - unknown/revoked token -> 404 (no delivery log possible without a source)
    - every hit on a valid token is logged in ``webhook_deliveries``
    - invalid payload -> 422 with explicit errors (never a silent failure)
    - valid payload -> contact dedupe by phone + deal in the first stage,
      unassigned (queue), 202
    """
    ip = client_ip(request)
    if not webhook_ip_limiter.allow(ip):
        raise RateLimitedError("Too many requests from this IP")
    if not webhook_token_limiter.allow(token):
        raise RateLimitedError("Too many requests for this source")

    source = await webhook_service.get_active_source_by_token(db, token)
    if source is None:
        raise NotFoundError("Lead source token", code="invalid_token")

    body = await request.body()
    settings = get_settings()
    if len(body) > settings.webhook_max_body_bytes:
        raise ValidationFailedError(
            f"Payload exceeds {settings.webhook_max_body_bytes} bytes", "payload_too_large"
        )
    try:
        raw_payload = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raw_payload = None
    if not isinstance(raw_payload, dict):
        raise ValidationFailedError("Body must be a JSON object", "invalid_json")

    result, outcome = await webhook_service.process_lead(db, source, raw_payload, ip)
    # ``Deal`` outcome <=> success; a str outcome is the validation error detail
    # (the delivery is already logged either way).
    if result is None or not isinstance(outcome, Deal):
        raise ValidationFailedError(
            "Lead payload validation failed", "invalid_lead_payload",
            extras={"errors": outcome},
        )
    deal = outcome
    return LeadWebhookResponse(
        status="accepted",
        result=result.value,
        deal_id=deal.id,
        contact_id=deal.contact_id,
    )
