"""Deal field catalog + required-fields gate.

The catalog is the single source of truth for the keys an admin may mark as
required on a stage (``stages.required_fields``). It covers:

- first-class ``deals`` columns that make sense as stage requirements;
- ``contact.*`` fields (resolved through the deal's contact);
- ``enrollment.*`` keys, derived from the Pydantic ``EnrollmentData`` schema
  so the catalog can never drift from the JSONB contract.

Labels are pt-BR and live in the frontend (``strings.ts``) — the backend only
exposes ``key`` + ``type``.

"Filled" semantics (gate check): a value counts as filled when it is not NULL,
not an empty/whitespace-only string, and — for booleans — ``true`` (e.g. a
stage requiring ``enrollment.contract_signed`` demands a signed contract, not
merely an answered checkbox).
"""

import types
import typing
from datetime import date, datetime
from decimal import Decimal

from app.db.models import Contact, Deal
from app.schemas.enrollment import EnrollmentData

ENROLLMENT_PREFIX = "enrollment."
CONTACT_PREFIX = "contact."

# First-class deal columns eligible as stage requirements: key -> type.
FIRST_CLASS_FIELDS: dict[str, str] = {
    "value": "number",
    "qualification": "number",
    "unit_id": "uuid",
    "source": "string",
    "campaign": "string",
    "expected_close_date": "date",
    "first_whatsapp_contact_at": "datetime",
}

CONTACT_FIELDS: dict[str, str] = {
    "contact.phone_whatsapp": "string",
    "contact.email": "string",
    "contact.city": "string",
}

_PY_TYPE_MAP: dict[type, str] = {
    str: "string",
    bool: "boolean",
    int: "number",
    Decimal: "number",
    date: "date",
    datetime: "datetime",
}


def _annotation_to_type(annotation: object) -> str:
    """Map an ``EnrollmentData`` field annotation to a catalog type string."""
    origin = typing.get_origin(annotation)
    if origin is typing.Union or origin is types.UnionType:
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        if args:
            return _annotation_to_type(args[0])
        return "string"
    if origin is typing.Literal:
        return "string"
    if isinstance(annotation, type) and annotation in _PY_TYPE_MAP:
        return _PY_TYPE_MAP[annotation]
    return "string"


def _enrollment_fields() -> dict[str, str]:
    return {
        f"{ENROLLMENT_PREFIX}{name}": _annotation_to_type(field.annotation)
        for name, field in EnrollmentData.model_fields.items()
    }


def field_catalog() -> dict[str, str]:
    """Full catalog: key -> type. Order: deal, contact, enrollment fields."""
    return {**FIRST_CLASS_FIELDS, **CONTACT_FIELDS, **_enrollment_fields()}


def invalid_field_keys(keys: list[str]) -> list[str]:
    """Keys not present in the catalog (used to validate PATCH /stages)."""
    catalog = field_catalog()
    return [k for k in keys if k not in catalog]


def _is_filled(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value  # required booleans must be true (e.g. contract_signed)
    if isinstance(value, str):
        return value.strip() != ""
    return True


def missing_required_fields(
    deal: Deal, contact: Contact | None, required: list[str]
) -> list[str]:
    """Return the required keys that are NOT filled on the deal (gate check)."""
    missing: list[str] = []
    enrollment: dict[str, object] = deal.enrollment_data or {}
    for key in required:
        if key.startswith(ENROLLMENT_PREFIX):
            value: object = enrollment.get(key[len(ENROLLMENT_PREFIX):])
        elif key.startswith(CONTACT_PREFIX):
            attr = key[len(CONTACT_PREFIX):]
            value = getattr(contact, attr, None) if contact is not None else None
        else:
            value = getattr(deal, key, None)
        if not _is_filled(value):
            missing.append(key)
    return missing
