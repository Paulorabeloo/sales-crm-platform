/**
 * Single source of truth for money input parsing/formatting (fix for review
 * finding B1).
 *
 * The API serializes Decimal as a dot-decimal string ("500.00"); users type
 * pt-BR ("1.234,56"). The old parsers stripped every dot assuming pt-BR,
 * turning the API prefill "500.00" into 50000. Rule here (per review):
 * if the string contains a comma, dots are thousand separators; otherwise
 * the dot is the decimal separator.
 */

/**
 * Parse a currency input accepting "500.00" (API), "1.234,56" (pt-BR) and
 * "1234.56". Returns null for empty/invalid input.
 */
export function parseCurrencyInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format an API value (number or Decimal string) as a pt-BR input prefill
 * ("500.00" -> "500,00"). Returns "" for empty/invalid values.
 */
export function formatCurrencyInput(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
