"""Contacts: CRUD with name/phone search, phone dedupe, soft-delete (LGPD).

Write scope (M1 — RBAC on personal data):
- READ (list/search/get) stays open to any authenticated user — required for
  the phone-dedupe flow (409 with ``existing_contact_id`` on create).
- PATCH: ADMIN always; CONSULTOR only when **every** non-deleted deal of the
  contact is inside their write scope (owned by them or unassigned queue).
  A contact linked to another consultant's deal -> 403.
- DELETE: ADMIN only (LGPD erasure is an admin operation), still blocked
  while the contact has open deals.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, status
from sqlalchemy import ColumnElement, func, or_, select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.phone import normalize_phone
from app.db.models import Contact, Deal, DealStatus, User, UserRole
from app.schemas.common import Page
from app.schemas.contact import ContactCreate, ContactOut, ContactUpdate
from app.services.contacts import create_contact_strict, find_active_by_phone

router = APIRouter(prefix="/contacts", tags=["contacts"])


async def _get_contact_or_404(db: DbSession, contact_id: uuid.UUID) -> Contact:
    contact = await db.scalar(
        select(Contact).where(Contact.id == contact_id, Contact.deleted_at.is_(None))
    )
    if contact is None:
        raise NotFoundError("Contact", code="contact_not_found")
    return contact


async def _ensure_contact_write_scope(
    db: DbSession, user: User, contact_id: uuid.UUID
) -> None:
    """403 for a CONSULTOR when the contact is linked to another owner's deal.

    Rule: a consultant may write a contact only if ALL of its non-deleted
    deals are in their own write scope (``owner_id == user`` or unassigned).
    Contacts with no deals are writable by any consultant (e.g. fixing a typo
    right after registering a walk-in lead).
    """
    if user.role == UserRole.ADMIN:
        return
    foreign_deals = await db.scalar(
        select(func.count())
        .select_from(Deal)
        .where(
            Deal.contact_id == contact_id,
            Deal.deleted_at.is_(None),
            Deal.owner_id.is_not(None),
            Deal.owner_id != user.id,
        )
    )
    if foreign_deals:
        raise ForbiddenError(
            "Contact is linked to another consultant's deal",
            code="contact_out_of_scope",
        )


@router.get("", response_model=Page[ContactOut])
async def list_contacts(
    user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, max_length=160, description="name or phone"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> Page[ContactOut]:
    stmt = select(Contact).where(Contact.deleted_at.is_(None))
    if q:
        needle = f"%{q.strip()}%"
        phone_needle = normalize_phone(q)
        conditions: list[ColumnElement[bool]] = [Contact.name.ilike(needle)]
        if phone_needle:
            conditions.append(Contact.phone_whatsapp == phone_needle)
        # also match partial digits typed as-is
        digits = "".join(ch for ch in q if ch.isdigit())
        if digits:
            conditions.append(Contact.phone_whatsapp.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conditions))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    contacts = (
        await db.scalars(
            stmt.order_by(Contact.name).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return Page(
        items=[ContactOut.model_validate(c) for c in contacts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(
    body: ContactCreate, user: CurrentUser, db: DbSession
) -> ContactOut:
    """409 with ``existing_contact_id`` when the phone is already registered."""
    contact = await create_contact_strict(
        db,
        name=body.name,
        phone_whatsapp=body.phone_whatsapp,
        email=body.email,
        city=body.city,
        notes=body.notes,
    )
    return ContactOut.model_validate(contact)


@router.get("/{contact_id}", response_model=ContactOut)
async def get_contact(
    contact_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ContactOut:
    return ContactOut.model_validate(await _get_contact_or_404(db, contact_id))


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(
    contact_id: uuid.UUID, body: ContactUpdate, user: CurrentUser, db: DbSession
) -> ContactOut:
    contact = await _get_contact_or_404(db, contact_id)
    await _ensure_contact_write_scope(db, user, contact.id)
    if body.phone_whatsapp is not None and body.phone_whatsapp != contact.phone_whatsapp:
        existing = await find_active_by_phone(db, body.phone_whatsapp)
        if existing is not None and existing.id != contact.id:
            raise ConflictError(
                "A contact with this phone already exists",
                code="duplicate_phone",
                extras={"existing_contact_id": str(existing.id)},
            )
        contact.phone_whatsapp = body.phone_whatsapp
    for field in ("name", "email", "city", "notes"):
        value = getattr(body, field)
        if value is not None:
            setattr(contact, field, value)
    await db.flush()
    return ContactOut.model_validate(contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: uuid.UUID, user: AdminUser, db: DbSession
) -> None:
    """Soft-delete (LGPD) — admin only. Blocked while open deals exist."""
    contact = await _get_contact_or_404(db, contact_id)
    open_deals = await db.scalar(
        select(func.count())
        .select_from(Deal)
        .where(
            Deal.contact_id == contact_id,
            Deal.status == DealStatus.OPEN,
            Deal.deleted_at.is_(None),
        )
    )
    if open_deals:
        raise ConflictError(
            "Contact still has open deals — close or delete them first",
            "contact_has_open_deals",
            extras={"open_deals": int(open_deals)},
        )
    contact.deleted_at = datetime.now(UTC)
    await db.flush()
