"""Phone normalization to E.164 (Brazil-first heuristics).

The DB enforces ``^\\+[1-9][0-9]{7,14}$`` on ``contacts.phone_whatsapp``;
this module is the single place where raw user/webhook input becomes that.
"""

import re

E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def normalize_phone(raw: str) -> str | None:
    """Best-effort normalization of a phone number to E.164.

    Rules (Brazilian numbers first, since all leads are BR):
    - strips spaces, dashes, dots, parentheses;
    - keeps a leading ``+`` if present;
    - 10-11 digits (DDD + number) -> prefixed with +55;
    - 12-13 digits starting with 55 -> prefixed with +;
    - anything else must already be valid E.164 after adding ``+``.

    Returns the normalized number, or ``None`` when it cannot be a valid
    E.164 number.
    """
    if not raw:
        return None
    cleaned = re.sub(r"[\s\-\.\(\)]", "", raw.strip())
    has_plus = cleaned.startswith("+")
    digits = re.sub(r"\D", "", cleaned)
    if not digits:
        return None

    if has_plus:
        candidate = f"+{digits}"
    elif len(digits) in (10, 11):  # BR: DDD + 8/9 digit number
        candidate = f"+55{digits}"
    elif len(digits) in (12, 13) and digits.startswith("55"):
        candidate = f"+{digits}"
    else:
        candidate = f"+{digits}"

    return candidate if E164_RE.match(candidate) else None
