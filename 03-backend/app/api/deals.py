"""Deals: CRUD, kanban view, stage moves, won/lost, first contact, claim.

Visibility scope is applied in every query (ADR-008): CONSULTOR sees own deals
plus the unassigned queue; ADMIN sees everything.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Query, status
from sqlalchemy import ColumnElement, Select, func, select, text
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationFailedError,
)
from app.db.models import ActivityType, Contact, Deal, DealStatus, Stage, UserRole
from app.schemas.common import Page
from app.schemas.deal import (
    QUICK_LOG_KIND_TO_ACTIVITY,
    DealCard,
    DealCreate,
    DealDetailOut,
    DealFirstContactCorrection,
    DealFirstContactIn,
    DealMarkLost,
    DealMarkWon,
    DealMoveStage,
    DealOut,
    DealUpdate,
    KanbanResponse,
    KanbanStage,
    QuickLogIn,
    QuickLogOut,
    RecoverableDealRow,
    RecoverableDealsOut,
)
from app.services import deals as deal_service
from app.services.activities import log_activity
from app.services.cycles import require_active_cycle, resolve_cycle_for_new_deal
from app.services.settings import get_cooling_days

router = APIRouter(prefix="/deals", tags=["deals"])

_SORTS: dict[str, ColumnElement[Any]] = {
    "created_at": Deal.created_at.asc(),
    "-created_at": Deal.created_at.desc(),
    "last_activity_at": Deal.last_activity_at.asc(),
    "-last_activity_at": Deal.last_activity_at.desc(),
    "value": Deal.value.asc().nulls_last(),
    "-value": Deal.value.desc().nulls_last(),
    "qualification": Deal.qualification.asc().nulls_last(),
    "-qualification": Deal.qualification.desc().nulls_last(),
}


def _apply_common_filters(
    stmt: Select[Any],
    *,
    pipeline_id: uuid.UUID | None,
    stage_id: uuid.UUID | None,
    owner_id: uuid.UUID | None,
    unassigned: bool,
    status_: DealStatus | None,
    unit_id: uuid.UUID | None,
    cycle_id: uuid.UUID | None = None,
    no_next_step: bool = False,
    contact_id: uuid.UUID | None = None,
) -> Select[Any]:
    if contact_id is not None:
        stmt = stmt.where(Deal.contact_id == contact_id)
    if pipeline_id is not None:
        stmt = stmt.where(Deal.pipeline_id == pipeline_id)
    if stage_id is not None:
        stmt = stmt.where(Deal.stage_id == stage_id)
    if unassigned:
        stmt = stmt.where(Deal.owner_id.is_(None))
    elif owner_id is not None:
        stmt = stmt.where(Deal.owner_id == owner_id)
    if status_ is not None:
        stmt = stmt.where(Deal.status == status_)
    if unit_id is not None:
        stmt = stmt.where(Deal.unit_id == unit_id)
    if cycle_id is not None:
        stmt = stmt.where(Deal.cycle_id == cycle_id)
    if no_next_step:
        # Open deals without a FUTURE next step (spec 09.2 kanban filter).
        stmt = stmt.where(
            Deal.status == DealStatus.OPEN,
            (Deal.next_contact_at.is_(None))
            | (Deal.next_contact_at <= datetime.now(UTC)),
        )
    return stmt


# --- List view ----------------------------------------------------------------

@router.get("", response_model=Page[DealOut])
async def list_deals(
    user: CurrentUser,
    db: DbSession,
    pipeline_id: uuid.UUID | None = None,
    stage_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    unassigned: bool = False,
    status_filter: DealStatus | None = Query(default=None, alias="status"),
    unit_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
    contact_id: uuid.UUID | None = None,
    cooling: bool = False,
    no_next_step: bool = False,
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> Page[DealOut]:
    if sort not in _SORTS:
        raise ValidationFailedError(f"sort must be one of {sorted(_SORTS)}", "invalid_sort")
    stmt = select(Deal).where(deal_service.visible_deals_filter(user))
    stmt = _apply_common_filters(
        stmt,
        pipeline_id=pipeline_id,
        stage_id=stage_id,
        owner_id=owner_id,
        unassigned=unassigned,
        status_=status_filter,
        unit_id=unit_id,
        cycle_id=cycle_id,
        no_next_step=no_next_step,
        contact_id=contact_id,
    )
    if cooling:
        cutoff = datetime.now(UTC) - timedelta(days=await get_cooling_days(db))
        stmt = stmt.where(Deal.status == DealStatus.OPEN, Deal.last_activity_at < cutoff)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    deals = (
        await db.scalars(
            stmt.order_by(_SORTS[sort]).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return Page(
        items=[DealOut.model_validate(d) for d in deals],
        total=total,
        page=page,
        page_size=page_size,
    )


# --- Kanban view --------------------------------------------------------------

@router.get("/kanban", response_model=KanbanResponse)
async def kanban(
    user: CurrentUser,
    db: DbSession,
    pipeline_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    unassigned: bool = False,
    status_filter: DealStatus | None = Query(default=None, alias="status"),
    unit_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
    cooling: bool = False,
    no_next_step: bool = False,
) -> KanbanResponse:
    """Kanban columns with per-stage aggregates (count + sum of value).

    Without a ``status`` filter, open and won deals are shown (lost deals
    leave the board but stay in the list view and reports)."""
    if pipeline_id is None:
        pipeline_id = (await deal_service.get_default_pipeline(db)).id
    stages = (
        await db.scalars(
            select(Stage).where(Stage.pipeline_id == pipeline_id).order_by(Stage.sort_order)
        )
    ).all()
    if not stages:
        raise NotFoundError("Pipeline", code="pipeline_not_found")

    cooling_days = await get_cooling_days(db)
    cutoff = datetime.now(UTC) - timedelta(days=cooling_days)

    stmt = (
        select(Deal)
        .options(selectinload(Deal.contact))
        .where(deal_service.visible_deals_filter(user))
    )
    stmt = _apply_common_filters(
        stmt,
        pipeline_id=pipeline_id,
        stage_id=None,
        owner_id=owner_id,
        unassigned=unassigned,
        status_=status_filter,
        unit_id=unit_id,
        cycle_id=cycle_id,
        no_next_step=no_next_step,
    )
    if status_filter is None:
        stmt = stmt.where(Deal.status != DealStatus.LOST)
    if cooling:
        stmt = stmt.where(Deal.status == DealStatus.OPEN, Deal.last_activity_at < cutoff)
    stmt = stmt.order_by(Deal.last_activity_at.desc())
    deals = (await db.scalars(stmt)).all()

    by_stage: dict[uuid.UUID, list[Deal]] = {s.id: [] for s in stages}
    for deal in deals:
        by_stage.setdefault(deal.stage_id, []).append(deal)

    def make_card(d: Deal) -> DealCard:
        # naive/aware safety: DB returns aware datetimes (timestamptz)
        is_cooling = d.status == DealStatus.OPEN and d.last_activity_at < cutoff
        return DealCard(
            id=d.id,
            title=d.title,
            status=d.status,
            stage_id=d.stage_id,
            owner_id=d.owner_id,
            unit_id=d.unit_id,
            value=d.value,
            qualification=d.qualification,
            source=d.source,
            last_activity_at=d.last_activity_at,
            created_at=d.created_at,
            contact_name=d.contact.name,
            contact_phone=d.contact.phone_whatsapp,
            is_cooling=is_cooling,
            next_contact_at=d.next_contact_at,
            interest_course=(d.enrollment_data or {}).get("interest_course"),
            first_whatsapp_contact_at=d.first_whatsapp_contact_at,
        )

    return KanbanResponse(
        pipeline_id=pipeline_id,
        cooling_days=cooling_days,
        stages=[
            KanbanStage(
                stage_id=s.id,
                name=s.name,
                sort_order=s.sort_order,
                is_won_stage=s.is_won_stage,
                count=len(by_stage[s.id]),
                sum_value=sum(
                    (d.value for d in by_stage[s.id] if d.value is not None),
                    Decimal("0"),
                ),
                deals=[make_card(d) for d in by_stage[s.id]],
            )
            for s in stages
        ],
    )


# --- Win-back list (spec 10.4) ------------------------------------------------
# NOTE: declared before /{deal_id} so "recoverable" is not parsed as a UUID.

@router.get("/recoverable", response_model=RecoverableDealsOut)
async def recoverable_deals(
    user: CurrentUser,
    db: DbSession,
    cycle_id_before: uuid.UUID | None = None,
) -> RecoverableDealsOut:
    """Lost deals with a RECOVERABLE reason from cycles other than the active
    one (win-back candidates). Deals already reopened (they carry a
    ``reopened_in_cycle`` activity) are excluded — a rescued lead must leave
    the list. Scope: admin sees everything; a consultant sees only their own
    losses. ``cycle_id_before`` narrows to one source cycle."""
    active = await require_active_cycle(db)
    clauses = ["d.cycle_id <> :active_id"]
    params: dict[str, Any] = {"active_id": str(active.id)}
    if cycle_id_before is not None:
        clauses.append("d.cycle_id = :cycle_id_before")
        params["cycle_id_before"] = str(cycle_id_before)
    if user.role != UserRole.ADMIN:
        clauses.append("d.owner_id = :owner_id")
        params["owner_id"] = str(user.id)
    rows = (
        await db.execute(
            text(
                f"""
                SELECT d.id AS deal_id,
                       d.title,
                       ct.name AS contact_name,
                       ct.phone_whatsapp AS contact_phone,
                       d.owner_id,
                       u.name AS owner_name,
                       d.cycle_id,
                       c.name AS cycle_name,
                       lr.id AS lost_reason_id,
                       lr.label AS lost_reason_label,
                       d.lost_at,
                       d.enrollment_data->>'interest_course' AS interest_course
                FROM deals d
                JOIN lost_reasons lr
                  ON lr.id = d.lost_reason_id AND lr.is_recoverable
                JOIN contacts ct ON ct.id = d.contact_id
                JOIN cycles c ON c.id = d.cycle_id
                LEFT JOIN users u ON u.id = d.owner_id
                WHERE d.status = 'lost'
                  AND d.deleted_at IS NULL
                  AND NOT EXISTS (
                        SELECT 1 FROM activities a
                        WHERE a.deal_id = d.id
                          AND a.type = 'reopened_in_cycle'
                  )
                  AND {' AND '.join(clauses)}
                ORDER BY d.lost_at DESC
                """
            ),
            params,
        )
    ).mappings().all()
    items = [RecoverableDealRow.model_validate(dict(r)) for r in rows]
    return RecoverableDealsOut(active_cycle_id=active.id, total=len(items), items=items)


# --- CRUD ---------------------------------------------------------------------

@router.post("", response_model=DealOut, status_code=status.HTTP_201_CREATED)
async def create_deal(body: DealCreate, user: CurrentUser, db: DbSession) -> DealOut:
    contact = await db.scalar(
        select(Contact).where(Contact.id == body.contact_id, Contact.deleted_at.is_(None))
    )
    if contact is None:
        raise ValidationFailedError("contact_id must reference an active contact", "invalid_contact")

    pipeline_id = body.pipeline_id or (await deal_service.get_default_pipeline(db)).id
    if body.stage_id is not None:
        stage = await db.scalar(
            select(Stage).where(Stage.id == body.stage_id, Stage.pipeline_id == pipeline_id)
        )
        if stage is None:
            raise ValidationFailedError(
                "stage_id must belong to the chosen pipeline", "stage_not_in_pipeline"
            )
        if stage.is_won_stage:
            raise ValidationFailedError(
                "Deals cannot be created directly in the won-stage", "cannot_create_in_won_stage"
            )
    else:
        stage = await deal_service.get_first_stage(db, pipeline_id)

    if user.role == UserRole.ADMIN:
        owner_id = body.owner_id  # may be None (queue) or any user
    else:
        if body.owner_id is not None and body.owner_id != user.id:
            raise ForbiddenError(
                "Consultants can only create deals for themselves", code="cannot_assign_others"
            )
        owner_id = user.id

    cycle = await resolve_cycle_for_new_deal(db, body.cycle_id)

    deal = Deal(
        title=body.title,
        contact_id=contact.id,
        pipeline_id=pipeline_id,
        stage_id=stage.id,
        owner_id=owner_id,
        unit_id=body.unit_id,
        cycle_id=cycle.id,
        value=body.value,
        qualification=body.qualification,
        expected_close_date=body.expected_close_date,
        source=body.source,
        campaign=body.campaign,
        enrollment_data=body.enrollment_data.dump_json_dict() if body.enrollment_data else {},
    )
    if body.stage_id is not None:
        # Minor 1: creating straight into a middle stage must clear that
        # stage's gate, exactly like moving into it would. Deals born in the
        # first stage (webhook and the regular UI path) are exempt by design.
        await deal_service.ensure_stage_requirements(db, deal, stage)
    db.add(deal)
    await db.flush()
    await log_activity(
        db,
        deal_id=deal.id,
        type_=ActivityType.DEAL_CREATED,
        user_id=user.id,
        payload={"via": "manual"},
    )
    return DealOut.model_validate(deal)


@router.get("/{deal_id}", response_model=DealDetailOut)
async def get_deal(deal_id: uuid.UUID, user: CurrentUser, db: DbSession) -> DealDetailOut:
    deal = await db.scalar(
        select(Deal)
        .options(selectinload(Deal.contact))
        .where(Deal.id == deal_id, deal_service.visible_deals_filter(user))
    )
    if deal is None:
        raise NotFoundError("Deal", code="deal_not_found")
    return DealDetailOut.model_validate(deal)


@router.patch("/{deal_id}", response_model=DealOut)
async def update_deal(
    deal_id: uuid.UUID, body: DealUpdate, user: CurrentUser, db: DbSession
) -> DealOut:
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    if deal.status != DealStatus.OPEN and user.role != UserRole.ADMIN:
        raise ConflictError(
            "Deal is closed; only an admin can edit it", code="deal_locked"
        )
    if body.owner_id is not None:
        if user.role != UserRole.ADMIN:
            raise ForbiddenError("Only admins reassign deals", code="admin_only")
        await deal_service.change_owner(db, deal, user, body.owner_id)
    for field in (
        "title", "unit_id", "value", "qualification",
        "expected_close_date", "source", "campaign",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(deal, field, value)
    if "next_contact_at" in body.model_fields_set:
        # Explicit null clears the next step ("no next step" badge returns).
        deal.next_contact_at = body.next_contact_at
    if "objection_id" in body.model_fields_set:
        # Catalog objection (spec 12.2); explicit null clears it.
        if body.objection_id is not None:
            await deal_service.get_active_objection(db, body.objection_id)
        deal.objection_id = body.objection_id
    if body.enrollment_data is not None:
        # Full replace: the client always submits the whole enrollment form.
        deal.enrollment_data = body.enrollment_data.dump_json_dict()
    await db.flush()
    return DealOut.model_validate(deal)


@router.delete("/{deal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deal(deal_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    """Soft-delete (admin only) — the deal leaves every query but history stays."""
    deal = await deal_service.get_deal_scoped(db, deal_id, admin)
    deal.deleted_at = datetime.now(UTC)
    await db.flush()


# --- Transitions --------------------------------------------------------------

@router.patch("/{deal_id}/stage", response_model=DealOut)
async def move_stage(
    deal_id: uuid.UUID, body: DealMoveStage, user: CurrentUser, db: DbSession
) -> DealOut:
    """Kanban drag: only ``stage_id`` changes — ``deal_stage_history`` is
    written by the DB trigger. Moving into the won-stage marks the deal won.

    Entering a stage with ``required_fields`` configured validates them ->
    422 ``stage_requirements_missing`` with the ``missing_fields`` list.
    An optional ``next_contact_at`` schedules the follow-up in the same
    request (spec 09.2)."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    deal = await deal_service.move_stage(db, deal, body.stage_id, user)
    if body.next_contact_at is not None and deal.status == DealStatus.OPEN:
        deal.next_contact_at = body.next_contact_at
        await db.flush()
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/won", response_model=DealOut)
async def mark_won(
    deal_id: uuid.UUID, body: DealMarkWon, user: CurrentUser, db: DbSession
) -> DealOut:
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    deal = await deal_service.mark_won(db, deal, user, body.value)
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/lost", response_model=DealOut)
async def mark_lost(
    deal_id: uuid.UUID, body: DealMarkLost, user: CurrentUser, db: DbSession
) -> DealOut:
    """422 when ``lost_reason_id`` is missing (schema) or invalid (service)."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    deal = await deal_service.mark_lost(db, deal, user, body.lost_reason_id, body.lost_notes)
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/reopen", response_model=DealOut)
async def reopen_deal(deal_id: uuid.UUID, admin: AdminUser, db: DbSession) -> DealOut:
    deal = await deal_service.get_deal_scoped(db, deal_id, admin)
    deal = await deal_service.reopen(db, deal, admin)
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/first-contact", response_model=DealOut)
async def register_first_contact(
    deal_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    body: DealFirstContactIn | None = None,
) -> DealOut:
    """Write-once first WhatsApp contact (base of the response-time metric).
    Optional body schedules the next follow-up in the same request."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    deal = await deal_service.register_first_contact(db, deal, user)
    if body is not None and body.next_contact_at is not None:
        deal.next_contact_at = body.next_contact_at
        await db.flush()
    return DealOut.model_validate(deal)


@router.patch("/{deal_id}/first-contact", response_model=DealOut)
async def correct_first_contact(
    deal_id: uuid.UUID,
    body: DealFirstContactCorrection,
    admin: AdminUser,
    db: DbSession,
) -> DealOut:
    """Admin-only correction of the write-once timestamp (audited)."""
    deal = await deal_service.get_deal_scoped(db, deal_id, admin)
    deal = await deal_service.correct_first_contact(
        db, deal, admin, body.first_whatsapp_contact_at
    )
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/claim", response_model=DealOut)
async def claim_deal(deal_id: uuid.UUID, user: CurrentUser, db: DbSession) -> DealOut:
    """Take an unassigned deal from the queue (owner NULL -> current user).
    The deal's open unassigned tasks (e.g. the auto "Make first contact")
    are assigned to the claimer."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user)
    deal = await deal_service.claim(db, deal, user)
    return DealOut.model_validate(deal)


@router.post("/{deal_id}/log", response_model=QuickLogOut)
async def quick_log_deal(
    deal_id: uuid.UUID, body: QuickLogIn, user: CurrentUser, db: DbSession
) -> QuickLogOut:
    """One-click contact-outcome registration (spec 12.3 infra):

    - creates the typed activity (bumps ``last_activity_at`` via DB trigger)
    - stores ``next_contact_at`` when sent
    - ``visit_scheduled`` requires ``next_contact_at`` and also creates a
      "Visit" task due on that date

    Returns the updated deal + the deal's total ``attempt_no_answer`` count
    so the frontend can pre-select the cadence interval (spec 09.3)."""
    deal = await deal_service.get_deal_scoped(db, deal_id, user, for_edit=True)
    deal, attempts = await deal_service.quick_log(
        db,
        deal,
        user,
        kind=QUICK_LOG_KIND_TO_ACTIVITY[body.kind],
        note=body.note,
        next_contact_at=body.next_contact_at,
        objection_id=body.objection_id,
    )
    return QuickLogOut(deal=DealOut.model_validate(deal), attempts_count=attempts)


@router.post(
    "/{deal_id}/reopen-in-cycle",
    response_model=DealOut,
    status_code=status.HTTP_201_CREATED,
)
async def reopen_deal_in_cycle(
    deal_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> DealOut:
    """Win-back (spec 10.4): create a NEW deal in the ACTIVE cycle for the
    same contact (stage 1, owner = caller), cross-linked with the old lost
    deal via activities. The old deal stays lost, untouched. Scope: admin any
    lost deal; consultant only their own."""
    old_deal = await deal_service.get_deal_scoped(db, deal_id, user)
    if user.role != UserRole.ADMIN and old_deal.owner_id != user.id:
        raise ForbiddenError(
            "Only the deal owner or an admin can reopen this deal in the cycle",
            code="not_deal_owner",
        )
    new_deal = await deal_service.reopen_in_cycle(db, old_deal, user)
    return DealOut.model_validate(new_deal)
