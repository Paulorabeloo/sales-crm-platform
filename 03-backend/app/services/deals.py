"""Deal business rules: visibility scope, stage moves, won/lost transitions,
first-contact registration, queue claim.

Critical invariants (architecture §5) enforced here + by DB constraints:
- lost requires ``lost_reason_id`` (422 without it; DB CHECK is the backstop)
- won implies ``won_at`` and the pipeline's won-stage
- won/lost deals are locked (admin reopen is the only way back)
- ``deal_stage_history`` is written by DB triggers — this module only updates
  ``stage_id``
- ``first_whatsapp_contact_at`` is write-once (DB trigger); admin correction
  uses the transaction-scoped override setting
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationFailedError,
)
from app.db.models import (
    Activity,
    ActivityType,
    Contact,
    Deal,
    DealStatus,
    LostReason,
    Objection,
    Pipeline,
    Stage,
    Task,
    User,
    UserRole,
)
from app.services.activities import log_activity
from app.services.cycles import require_active_cycle
from app.services.deal_fields import missing_required_fields


# --- Visibility scope (ADR-008: applied in the query, never in the UI) --------

def visible_deals_filter(user: User) -> ColumnElement[bool]:
    """CONSULTOR sees own deals + unassigned queue; ADMIN sees everything.

    (Gate decision #2: no unit gating — every consultant serves every unit.)
    """
    if user.role == UserRole.ADMIN:
        return Deal.deleted_at.is_(None)
    return Deal.deleted_at.is_(None) & or_(
        Deal.owner_id == user.id, Deal.owner_id.is_(None)
    )


def can_edit(user: User, deal: Deal) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    return deal.owner_id == user.id


async def get_deal_scoped(
    db: AsyncSession, deal_id: uuid.UUID, user: User, *, for_edit: bool = False
) -> Deal:
    deal = await db.scalar(
        select(Deal).where(Deal.id == deal_id, visible_deals_filter(user))
    )
    if deal is None:
        raise NotFoundError("Deal", code="deal_not_found")
    if for_edit and not can_edit(user, deal):
        raise ForbiddenError(
            "Only the deal owner or an admin can modify this deal",
            code="not_deal_owner",
        )
    return deal


def _ensure_open(deal: Deal) -> None:
    if deal.status != DealStatus.OPEN:
        raise ConflictError(
            f"Deal is {deal.status.value} and locked; admin reopen is required",
            code="deal_locked",
        )


# --- Pipeline helpers ---------------------------------------------------------

async def get_default_pipeline(db: AsyncSession) -> Pipeline:
    pipeline = await db.scalar(select(Pipeline).where(Pipeline.is_default.is_(True)))
    if pipeline is None:
        raise ValidationFailedError("No default pipeline configured", "no_default_pipeline")
    return pipeline


async def get_first_stage(db: AsyncSession, pipeline_id: uuid.UUID) -> Stage:
    stage = await db.scalar(
        select(Stage)
        .where(Stage.pipeline_id == pipeline_id)
        .order_by(Stage.sort_order)
        .limit(1)
    )
    if stage is None:
        raise ValidationFailedError("Pipeline has no stages", "pipeline_without_stages")
    return stage


async def get_won_stage(db: AsyncSession, pipeline_id: uuid.UUID) -> Stage:
    stage = await db.scalar(
        select(Stage).where(
            Stage.pipeline_id == pipeline_id, Stage.is_won_stage.is_(True)
        )
    )
    if stage is None:
        raise ValidationFailedError(
            "Pipeline has no won-stage configured", "pipeline_without_won_stage"
        )
    return stage


# --- Stage requirements gate ----------------------------------------

async def ensure_stage_requirements(
    db: AsyncSession, deal: Deal, target: Stage
) -> None:
    """Validate the target stage's ``required_fields`` against the deal.

    The gate fires when ENTERING a stage (stage move or won transition) —
    never on deal creation (webhook leads are born in the first stage with
    nothing filled, by design). Failure -> 422 ``stage_requirements_missing``
    with the ``missing_fields`` list so the frontend can prompt inline.
    """
    required = list(target.required_fields or [])
    if not required:
        return
    contact = await db.get(Contact, deal.contact_id)
    missing = missing_required_fields(deal, contact, required)
    if missing:
        raise ValidationFailedError(
            "Deal is missing required fields for this stage",
            "stage_requirements_missing",
            extras={"missing_fields": missing, "stage_id": str(target.id)},
        )


# --- Transitions --------------------------------------------------------------

async def move_stage(
    db: AsyncSession, deal: Deal, target_stage_id: uuid.UUID, user: User
) -> Deal:
    """Move a deal across the kanban. Moving into the won-stage marks the deal
    won in the same operation (business rule #2). ``deal_stage_history`` is
    recorded by the DB trigger — only ``stage_id`` is updated here."""
    _ensure_open(deal)
    if target_stage_id == deal.stage_id:
        return deal

    target = await db.scalar(
        select(Stage).where(
            Stage.id == target_stage_id, Stage.pipeline_id == deal.pipeline_id
        )
    )
    if target is None:
        raise ValidationFailedError(
            "Target stage does not belong to the deal's pipeline", "stage_not_in_pipeline"
        )

    if target.is_won_stage:
        return await mark_won(db, deal, user)

    await ensure_stage_requirements(db, deal, target)

    from_stage_id = deal.stage_id
    deal.stage_id = target.id
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.STAGE_CHANGED,
        user_id=user.id,
        payload={"from_stage_id": str(from_stage_id), "to_stage_id": str(target.id)},
    )
    return deal


async def mark_won(
    db: AsyncSession, deal: Deal, user: User, value: Decimal | None = None
) -> Deal:
    """won ⇒ won_at (auto) + move to the pipeline's won-stage, one transaction.

    The won-stage's ``required_fields`` gate applies here too (entering the
    stage), regardless of whether the transition came from a kanban drag or
    the explicit "mark won" action."""
    _ensure_open(deal)
    won_stage = await get_won_stage(db, deal.pipeline_id)
    await ensure_stage_requirements(db, deal, won_stage)
    from_stage_id = deal.stage_id
    if value is not None:
        deal.value = value
    deal.status = DealStatus.WON
    deal.won_at = datetime.now(UTC)
    deal.stage_id = won_stage.id
    await db.flush()
    if from_stage_id != won_stage.id:
        await log_activity(
            db,
            deal_id=deal.id,
            type_=ActivityType.STAGE_CHANGED,
            user_id=user.id,
            payload={
                "from_stage_id": str(from_stage_id),
                "to_stage_id": str(won_stage.id),
            },
        )
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.STATUS_CHANGED,
        user_id=user.id,
        payload={"from": "open", "to": "won"},
    )
    return deal


async def mark_lost(
    db: AsyncSession,
    deal: Deal,
    user: User,
    lost_reason_id: uuid.UUID,
    lost_notes: str | None,
) -> Deal:
    """lost ⇒ lost_reason_id mandatory (422 without a valid one) + lost_at."""
    _ensure_open(deal)
    reason = await db.scalar(
        select(LostReason).where(
            LostReason.id == lost_reason_id, LostReason.is_active.is_(True)
        )
    )
    if reason is None:
        raise ValidationFailedError(
            "lost_reason_id must reference an active lost reason", "invalid_lost_reason"
        )
    deal.status = DealStatus.LOST
    deal.lost_reason_id = reason.id
    deal.lost_notes = lost_notes
    deal.lost_at = datetime.now(UTC)
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.STATUS_CHANGED,
        user_id=user.id,
        payload={"from": "open", "to": "lost", "lost_reason_id": str(reason.id)},
    )
    return deal


async def reopen(db: AsyncSession, deal: Deal, user: User) -> Deal:
    """Admin-only: unlock a won/lost deal back to open (audited)."""
    if deal.status == DealStatus.OPEN:
        raise ConflictError("Deal is already open", code="deal_already_open")
    previous = deal.status.value
    deal.status = DealStatus.OPEN
    deal.won_at = None
    deal.lost_at = None
    deal.lost_reason_id = None
    deal.lost_notes = None
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.STATUS_CHANGED,
        user_id=user.id,
        payload={"from": previous, "to": "open", "reopened": True},
    )
    return deal


# --- First WhatsApp contact ---------------------------------------------------

async def register_first_contact(db: AsyncSession, deal: Deal, user: User) -> Deal:
    """Write-once registration of the first WhatsApp contact (response-time
    metric base). The DB trigger rejects any overwrite attempt."""
    if deal.first_whatsapp_contact_at is not None:
        raise ConflictError(
            "First contact is already registered (write-once)",
            code="first_contact_already_set",
        )
    deal.first_whatsapp_contact_at = datetime.now(UTC)
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.FIRST_CONTACT_REGISTERED,
        user_id=user.id,
        payload={"at": deal.first_whatsapp_contact_at.isoformat()},
    )
    return deal


async def correct_first_contact(
    db: AsyncSession, deal: Deal, user: User, corrected_at: datetime
) -> Deal:
    """Admin-only correction: enables the transaction-scoped DB override
    (``app.allow_first_contact_override``) and audits the change."""
    previous = deal.first_whatsapp_contact_at
    await db.execute(
        text("SELECT set_config('app.allow_first_contact_override', 'on', true)")
    )
    deal.first_whatsapp_contact_at = corrected_at
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.FIRST_CONTACT_CORRECTED,
        user_id=user.id,
        payload={
            "from": previous.isoformat() if previous else None,
            "to": corrected_at.isoformat(),
        },
    )
    return deal


# --- Ownership ----------------------------------------------------------------

async def _assign_open_unassigned_tasks(
    db: AsyncSession, deal: Deal, new_owner_id: uuid.UUID
) -> int:
    """Assign the deal's open, unassigned tasks (e.g. the webhook-created
    "Make first contact" task) to the new owner. Returns count."""
    tasks = (
        await db.scalars(
            select(Task).where(
                Task.deal_id == deal.id,
                Task.is_done.is_(False),
                Task.assigned_to.is_(None),
            )
        )
    ).all()
    for task in tasks:
        task.assigned_to = new_owner_id
    if tasks:
        await db.flush()
    return len(tasks)


async def claim(db: AsyncSession, deal: Deal, user: User) -> Deal:
    """Consultant takes an unassigned deal from the queue (owner NULL → self).
    The deal's open unassigned tasks come along."""
    _ensure_open(deal)
    if deal.owner_id is not None:
        raise ConflictError("Deal already has an owner", code="deal_already_owned")
    deal.owner_id = user.id
    await db.flush()
    await _assign_open_unassigned_tasks(db, deal, user.id)
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.OWNER_CHANGED,
        user_id=user.id,
        payload={"from_owner_id": None, "to_owner_id": str(user.id)},
    )
    return deal


async def change_owner(
    db: AsyncSession, deal: Deal, user: User, new_owner_id: uuid.UUID | None
) -> Deal:
    """Admin reassignment (including back to the unassigned queue)."""
    if new_owner_id is not None:
        owner = await db.scalar(
            select(User).where(User.id == new_owner_id, User.is_active.is_(True))
        )
        if owner is None:
            raise ValidationFailedError(
                "owner_id must reference an active user", "invalid_owner"
            )
    previous = deal.owner_id
    if previous == new_owner_id:
        return deal
    deal.owner_id = new_owner_id
    await db.flush()
    if new_owner_id is not None:
        # Admin distributing a queue lead behaves like a claim for its tasks.
        await _assign_open_unassigned_tasks(db, deal, new_owner_id)
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.OWNER_CHANGED,
        user_id=user.id,
        payload={
            "from_owner_id": str(previous) if previous else None,
            "to_owner_id": str(new_owner_id) if new_owner_id else None,
        },
    )
    return deal


# --- Objection catalog ---------------------------------------------

async def get_active_objection(db: AsyncSession, objection_id: uuid.UUID) -> Objection:
    """Resolve an ACTIVE catalog objection or fail with 422."""
    objection = await db.scalar(
        select(Objection).where(
            Objection.id == objection_id, Objection.is_active.is_(True)
        )
    )
    if objection is None:
        raise ValidationFailedError(
            "objection_id must reference an active objection", "invalid_objection"
        )
    return objection


# --- Win-back -------------------------------------------------------

# Qualification fields worth carrying into the rescued deal. Closing/payment
# fields are intentionally NOT copied (they would spuriously satisfy stage
# gates on the fresh deal).
_REOPEN_ENROLLMENT_KEYS: tuple[str, ...] = (
    "interest_area",
    "interest_course",
    "entry_method",
    "modality",
    "how_found_us",
)


async def reopen_in_cycle(db: AsyncSession, old_deal: Deal, user: User) -> Deal:
    """Rescue a LOST deal into the active cycle: creates a NEW
    deal for the same contact (stage 1, owner = caller) cross-linked with the
    old one via activities. The old deal stays lost, untouched."""
    if old_deal.status != DealStatus.LOST:
        raise ConflictError(
            "Only lost deals can be reopened in the active cycle",
            code="deal_not_lost",
        )
    # Idempotency (M7): the cross-link activity is the rescue receipt. A second
    # call (double click, network retry, direct API use) must NOT mint a second
    # deal for the same contact — it answers 409 pointing at the existing one.
    previous = await db.scalar(
        select(Activity)
        .where(
            Activity.deal_id == old_deal.id,
            Activity.type == ActivityType.REOPENED_IN_CYCLE,
        )
        .order_by(Activity.created_at)
        .limit(1)
    )
    if previous is not None:
        new_deal_id = (previous.payload or {}).get("new_deal_id")
        raise ConflictError(
            "This deal was already reopened in a cycle",
            code="already_reopened",
            extras={"new_deal_id": new_deal_id} if new_deal_id else None,
        )
    active = await require_active_cycle(db)
    first_stage = await get_first_stage(db, old_deal.pipeline_id)
    enrollment = {
        k: v
        for k, v in (old_deal.enrollment_data or {}).items()
        if k in _REOPEN_ENROLLMENT_KEYS and v is not None
    }
    new_deal = Deal(
        title=old_deal.title,
        status=DealStatus.OPEN,
        pipeline_id=old_deal.pipeline_id,
        stage_id=first_stage.id,
        owner_id=user.id,
        unit_id=old_deal.unit_id,
        contact_id=old_deal.contact_id,
        cycle_id=active.id,
        source=old_deal.source,
        campaign=old_deal.campaign,
        enrollment_data=enrollment,
    )
    db.add(new_deal)
    await db.flush()
    await log_activity(
        db,
        deal_id=new_deal.id,
        type_=ActivityType.DEAL_CREATED,
        user_id=user.id,
        payload={
            "via": "reopen_in_cycle",
            "from_deal_id": str(old_deal.id),
            "cycle_id": str(active.id),
        },
    )
    # Cross-link on the old deal's timeline (its status/metrics stay intact).
    await log_activity(
        db,
        deal_id=old_deal.id,
        type_=ActivityType.REOPENED_IN_CYCLE,
        user_id=user.id,
        payload={"new_deal_id": str(new_deal.id), "cycle_id": str(active.id)},
    )
    return new_deal


# --- Quick log (the spec data infra + the spec) --------------------------------

QUICK_LOG_TYPES: frozenset[ActivityType] = frozenset(
    {
        ActivityType.ATTEMPT_NO_ANSWER,
        ActivityType.TALKED_ADVANCE,
        ActivityType.TALKED_OBJECTION,
        ActivityType.VISIT_SCHEDULED,
    }
)


async def count_no_answer_attempts(db: AsyncSession, deal_id: uuid.UUID) -> int:
    """Number of ``attempt_no_answer`` activities on the deal — the frontend
    uses it to pre-select the follow-up cadence interval."""
    count = await db.scalar(
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.deal_id == deal_id,
            Activity.type == ActivityType.ATTEMPT_NO_ANSWER,
        )
    )
    return int(count or 0)


async def quick_log(
    db: AsyncSession,
    deal: Deal,
    user: User,
    kind: ActivityType,
    note: str | None,
    next_contact_at: datetime | None,
    objection_id: uuid.UUID | None = None,
) -> tuple[Deal, int]:
    """One-click contact-outcome registration.

    Creates the typed activity (which bumps ``last_activity_at`` via the DB
    trigger), stores ``next_contact_at`` when sent, and for
    ``visit_scheduled`` also creates a "Visit" task due on the visit date.
    ``objection_id`` (only with ``talked_objection``) sets the deal's main
    catalog objection.

    A quick log IS a contact touch: when the deal has no
    ``first_whatsapp_contact_at`` yet, the first quick log registers it
    (write-once, same semantics as POST /first-contact). This is what takes
    the lead out of My Day's "respond now" section (the spec: "registra
    contato + agenda D+1 -> some de Responder agora").
    Returns the refreshed deal + the total ``attempt_no_answer`` count.
    """
    _ensure_open(deal)
    if kind not in QUICK_LOG_TYPES:  # defensive; the schema already restricts
        raise ValidationFailedError("Invalid quick-log kind", "invalid_quick_log_kind")
    if kind == ActivityType.VISIT_SCHEDULED and next_contact_at is None:
        raise ValidationFailedError(
            "visit_scheduled requires next_contact_at (the visit date)",
            "visit_requires_next_contact_at",
        )
    if objection_id is not None:
        if kind != ActivityType.TALKED_OBJECTION:
            raise ValidationFailedError(
                "objection_id is only accepted with kind=talked_objection",
                "objection_requires_talked_objection",
            )
        objection = await get_active_objection(db, objection_id)
        deal.objection_id = objection.id

    # First quick log on an untouched lead counts as the first contact
    # (write-once metric; the DB trigger allows the NULL -> value transition).
    if deal.first_whatsapp_contact_at is None:
        deal.first_whatsapp_contact_at = datetime.now(UTC)
        await db.flush()
        await log_activity(
            db,
            deal_id=deal.id,
            type_=ActivityType.FIRST_CONTACT_REGISTERED,
            user_id=user.id,
            payload={
                "at": deal.first_whatsapp_contact_at.isoformat(),
                "via": "quick_log",
            },
        )

    payload: dict[str, str | None] = {
        "next_contact_at": next_contact_at.isoformat() if next_contact_at else None
    }
    if objection_id is not None:
        payload["objection_id"] = str(objection_id)
    await log_activity(
        db,
        deal_id=deal.id,
        type_=kind,
        user_id=user.id,
        body=note,
        payload=payload,
    )
    if next_contact_at is not None:
        deal.next_contact_at = next_contact_at

    if kind == ActivityType.VISIT_SCHEDULED and next_contact_at is not None:
        task = Task(
            deal_id=deal.id,
            title="Visit",
            due_date=next_contact_at.date(),
            assigned_to=deal.owner_id or user.id,
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

    await db.flush()
    # The activity trigger bumped last_activity_at in the DB — refresh the ORM
    # instance so the response reflects it.
    await db.refresh(deal)
    attempts = await count_no_answer_attempts(db, deal.id)
    return deal, attempts
