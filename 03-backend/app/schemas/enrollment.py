"""Shape of ``deals.enrollment_data`` (JSONB) — Pydantic owns the contract.

All fields optional (progressive fill during the enrollment funnel).
``extra="forbid"``: no key outside this contract ever reaches the JSONB.
"""

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

CPF_RE = re.compile(r"^\d{11}$")


def _cpf_check_digits_ok(digits: str) -> bool:
    """Validate CPF verification digits (mod-11)."""
    if len(set(digits)) == 1:
        return False
    for pos in (9, 10):
        total = sum(int(digits[i]) * ((pos + 1) - i) for i in range(pos))
        expected = (total * 10) % 11
        if expected == 10:
            expected = 0
        if expected != int(digits[pos]):
            return False
    return True


class EnrollmentData(BaseModel):
    """Progressive enrollment form data stored in deals.enrollment_data (JSONB)."""

    model_config = ConfigDict(extra="forbid")

    # Interest
    interest_area: str | None = None
    interest_course: str | None = None  # free text + autocomplete (gate #4)
    entry_method: Literal[
        "vestibular", "enem", "transferencia", "segunda_graduacao", "outro"
    ] | None = None
    modality: Literal["presencial", "semipresencial", "ead"] | None = None
    enrollment_semester: str | None = None  # e.g. "2027.1"
    how_found_us: str | None = None

    # Financial
    budget_range: str | None = None
    needs_scholarship_or_financing: bool | None = None
    monthly_fee_value: Decimal | None = None
    scholarship_offered: str | None = None
    negotiated_final_condition: str | None = None
    payment_method: str | None = None
    payment_status: str | None = None
    payment_date: date | None = None

    # Qualification / negotiation
    decision_deadline: date | None = None
    main_objection: str | None = None
    scheduling_status: str | None = None
    finished_high_school: bool | None = None

    # Documents / closing (LGPD: personal data — covered by deal soft-delete
    # + role-based access; field-level encryption deferred to phase 2)
    cpf: str | None = None
    rg: str | None = None
    birth_date: date | None = None
    address: str | None = None
    contract_signed: bool | None = None
    contract_accepted_at: datetime | None = None
    contract_link: str | None = None
    ra_number: str | None = None

    @field_validator("cpf")
    @classmethod
    def validate_cpf(cls, v: str | None) -> str | None:
        if v is None:
            return v
        digits = re.sub(r"\D", "", v)
        if not CPF_RE.match(digits) or not _cpf_check_digits_ok(digits):
            raise ValueError("invalid CPF (check digits)")
        return digits

    def dump_json_dict(self) -> dict:
        """JSON-serializable dict (Decimal/date/datetime as strings), no Nones."""
        return self.model_dump(mode="json", exclude_none=True)

    def merge_into(self, current: dict | None) -> dict:
        """Shallow-merge this patch onto the stored JSONB (feedback item 4).

        Only the keys PRESENT in the request payload are touched, which is what
        makes a partial ``PATCH /deals/{id}`` safe for any client (extension,
        integration, script) instead of wiping every field it did not send:

        - key sent with a value  -> written;
        - key sent as ``null``   -> removed (explicit clear);
        - key not sent           -> kept untouched.

        ``model_fields_set`` is what distinguishes "sent as null" from "not
        sent", so callers must build the model from the raw request body.
        """
        merged = dict(current or {})
        dumped = self.model_dump(mode="json")
        for key in self.model_fields_set:
            value = dumped[key]
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        return merged
