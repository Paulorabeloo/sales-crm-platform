"""Contact rules: phone dedupe (race-safe via the partial unique index)."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.db.models import Contact


async def find_active_by_phone(db: AsyncSession, phone_e164: str) -> Contact | None:
    contact: Contact | None = await db.scalar(
        select(Contact).where(
            Contact.phone_whatsapp == phone_e164, Contact.deleted_at.is_(None)
        )
    )
    return contact


async def create_contact_strict(db: AsyncSession, **fields: Any) -> Contact:
    """Create a contact; on phone conflict raise 409 carrying the existing id
    ("return the existing one on conflict" — the client decides what to do)."""
    existing = await find_active_by_phone(db, fields["phone_whatsapp"])
    if existing is not None:
        raise ConflictError(
            "A contact with this phone already exists",
            code="duplicate_phone",
            extras={"existing_contact_id": str(existing.id)},
        )
    contact = Contact(**fields)
    db.add(contact)
    try:
        await db.flush()
    except IntegrityError as exc:  # lost the race — surface the winner
        await db.rollback()
        existing = await find_active_by_phone(db, fields["phone_whatsapp"])
        if existing is not None:
            raise ConflictError(
                "A contact with this phone already exists",
                code="duplicate_phone",
                extras={"existing_contact_id": str(existing.id)},
            ) from exc
        raise
    return contact


async def get_or_create_by_phone(
    db: AsyncSession, *, name: str, phone_e164: str, email: str | None = None
) -> tuple[Contact, bool]:
    """Webhook-style dedupe: reuse the active contact for this phone, else
    create one. Returns ``(contact, created)``."""
    existing = await find_active_by_phone(db, phone_e164)
    if existing is not None:
        return existing, False
    contact = Contact(name=name, phone_whatsapp=phone_e164, email=email)
    db.add(contact)
    try:
        await db.flush()
        return contact, True
    except IntegrityError:
        await db.rollback()
        existing = await find_active_by_phone(db, phone_e164)
        if existing is not None:
            return existing, False
        raise
