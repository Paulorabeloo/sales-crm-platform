"""Public lead-capture webhook processing.

Design rules (architecture §2.7 / §5.8):
- every hit on a valid token is logged in ``webhook_deliveries`` — accepted or
  not — so silent LP breakage is debuggable;
- invalid payloads answer 422 with an explicit error (never a silent 500);
- an invalid token and an invalid payload are the ONLY rejection reasons: no
  configuration gap of ours may cost a captured lead (see the cycle fallback);
- contact dedupe by normalized phone; the deal lands in the pipeline's first
  stage ("Lead Recebido") with no owner (unassigned queue).
"""

import logging
import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ActivityType,
    Deal,
    DealStatus,
    LeadSource,
    Task,
    Unit,
    WebhookDelivery,
    WebhookDeliveryResult,
)
from app.schemas.webhook import LeadWebhookPayload
from app.services.activities import log_activity
from app.services.contacts import get_or_create_by_phone
from app.services.cycles import resolve_capture_cycle
from app.services.deals import get_default_pipeline, get_first_stage
from app.services.settings import get_auto_first_contact_task

FIRST_CONTACT_TASK_TITLE = "Make first contact"

logger = logging.getLogger("app.webhook")


async def get_active_source_by_token(db: AsyncSession, token: str) -> LeadSource | None:
    source: LeadSource | None = await db.scalar(
        select(LeadSource).where(
            LeadSource.token == token,
            LeadSource.is_active.is_(True),
            LeadSource.revoked_at.is_(None),
        )
    )
    return source


async def _log_delivery(
    db: AsyncSession,
    *,
    source_id: uuid.UUID,
    raw_payload: dict,
    result: WebhookDeliveryResult,
    error_detail: str | None = None,
    deal_id: uuid.UUID | None = None,
    ip: str | None = None,
) -> None:
    db.add(
        WebhookDelivery(
            lead_source_id=source_id,
            raw_payload=raw_payload,
            result=result,
            error_detail=error_detail,
            deal_id=deal_id,
            ip=ip,
        )
    )
    await db.flush()


async def _resolve_unit_id(
    db: AsyncSession, source: LeadSource, unit_name: str | None
) -> uuid.UUID | None:
    if unit_name:
        unit = await db.scalar(
            select(Unit).where(
                func.lower(Unit.name) == unit_name.strip().lower(),
                Unit.is_active.is_(True),
            )
        )
        if unit is not None:
            return unit.id
    return source.default_unit_id


async def process_lead(
    db: AsyncSession, source: LeadSource, raw_payload: dict, ip: str | None
) -> tuple[WebhookDeliveryResult, Deal] | tuple[None, str]:
    """Process one delivery. Returns ``(result, deal)`` on success, or
    ``(None, error_detail)`` when the payload failed validation (the delivery
    is logged either way, and the session is committed by this function)."""
    try:
        payload = LeadWebhookPayload.model_validate(raw_payload)
    except ValidationError as exc:
        detail = "; ".join(
            f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        await _log_delivery(
            db,
            source_id=source.id,
            raw_payload=raw_payload,
            result=WebhookDeliveryResult.REJECTED,
            error_detail=detail,
            ip=ip,
        )
        await db.commit()
        return None, detail

    # Webhook leads land in the ACTIVE cycle (spec 10.1). A missing active
    # cycle is a configuration gap on our side, never a reason to refuse a
    # lead: ``resolve_capture_cycle`` falls back to the most recent cycle (or
    # creates the "Sem ciclo" one) and the gap is flagged in the log and on the
    # deal timeline. Token and payload are the only rejection reasons left.
    cycle, cycle_fallback = await resolve_capture_cycle(db)
    if cycle_fallback:
        logger.warning(
            "Lead accepted with no active cycle configured; using fallback cycle "
            "%r (%s). Activate a cycle in Settings.",
            cycle.name,
            cycle.id,
        )

    contact, created = await get_or_create_by_phone(
        db, name=payload.name, phone_e164=payload.phone, email=payload.email
    )

    if source.default_pipeline_id is not None:
        pipeline_id = source.default_pipeline_id
    else:
        pipeline_id = (await get_default_pipeline(db)).id
    first_stage = await get_first_stage(db, pipeline_id)
    unit_id = await _resolve_unit_id(db, source, payload.unit)

    enrollment_data: dict = {}
    if payload.course_of_interest:
        enrollment_data["interest_course"] = payload.course_of_interest

    deal = Deal(
        title=payload.name,
        status=DealStatus.OPEN,
        pipeline_id=pipeline_id,
        stage_id=first_stage.id,
        owner_id=None,  # unassigned queue — admin assigns or a consultant claims
        unit_id=unit_id,
        contact_id=contact.id,
        cycle_id=cycle.id,
        source=source.name,
        campaign=payload.campaign,
        enrollment_data=enrollment_data,
    )
    db.add(deal)
    await db.flush()

    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.DEAL_CREATED,
        user_id=None,  # system event
        payload={
            "via": "webhook",
            "lead_source": source.name,
            "contact_created": created,
            "cycle_id": str(cycle.id),
            "cycle_fallback": cycle_fallback,
        },
    )

    # Auto cadence (spec 09.3): a "Make first contact" task due today, born
    # unassigned (NULL) — claiming the deal assigns it to the new owner.
    if await get_auto_first_contact_task(db):
        task = Task(
            deal_id=deal.id,
            title=FIRST_CONTACT_TASK_TITLE,
            due_date=datetime.now(UTC).date(),
            assigned_to=None,
            created_by=None,  # system
        )
        db.add(task)
        await db.flush()
        await log_activity(
            db,
            deal_id=deal.id,
            type_=ActivityType.TASK_CREATED,
            user_id=None,
            payload={"task_id": str(task.id), "title": task.title, "via": "webhook"},
        )

    result = (
        WebhookDeliveryResult.ACCEPTED if created else WebhookDeliveryResult.DUPLICATE_CONTACT
    )
    await _log_delivery(
        db,
        source_id=source.id,
        raw_payload=raw_payload,
        result=result,
        deal_id=deal.id,
        ip=ip,
    )
    await db.commit()
    return result, deal
