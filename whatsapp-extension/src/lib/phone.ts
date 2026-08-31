/**
 * Phone normalization to E.164, mirroring the backend rules
 * (03-backend/app/core/phone.py) so the extension's lookup key always matches
 * what the API stored. Brazil-first heuristics.
 */

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/** Best-effort normalization of a raw phone string to E.164 (+55...). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s\-.()]/g, "");
  const hasPlus = cleaned.startsWith("+");
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return null;

  let candidate: string;
  if (hasPlus) {
    candidate = `+${digits}`;
  } else if (digits.length === 10 || digits.length === 11) {
    // BR: DDD + 8/9 digit number
    candidate = `+55${digits}`;
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    candidate = `+${digits}`;
  } else {
    candidate = `+${digits}`;
  }
  return E164_RE.test(candidate) ? candidate : null;
}

/**
 * Whether a piece of text is a phone number rather than a saved-contact name.
 * WhatsApp Web shows the raw number in the header when the contact is not in
 * the agenda (e.g. "+55 63 99999-0001").
 */
export function looksLikePhone(text: string | null | undefined): boolean {
  if (!text) return false;
  const stripped = text.trim();
  if (!/^[+\d]/.test(stripped)) return false;
  const digits = stripped.replace(/\D/g, "");
  if (digits.length < 8) return false;
  // Everything except digits must be formatting characters.
  return /^[+\d\s\-.()]+$/.test(stripped);
}

/**
 * Extract a phone from a WhatsApp DOM message id such as
 * "false_556392000001@c.us_3EB0..." (individual chats only; group ids use
 * "@g.us" and carry no personal phone).
 */
export function phoneFromWhatsAppId(dataId: string | null | undefined): string | null {
  if (!dataId) return null;
  const match = dataId.match(/(?:^|_)(\d{8,15})@c\.us/);
  if (!match) return null;
  return normalizePhone(`+${match[1]}`);
}

/** Display formatting for BR numbers: +55 (63) 99999-0001. */
export function formatPhoneBR(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return e164;
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

/** First name of a full name, for template variables. */
export function firstName(full: string | null | undefined): string {
  if (!full) return "";
  const trimmed = full.trim();
  if (!trimmed || looksLikePhone(trimmed)) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}
