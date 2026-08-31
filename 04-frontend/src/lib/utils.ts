import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Coerce API numeric values (Decimal may serialize as string) to number. */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(
  value: string | number | null | undefined,
): string {
  return brl.format(num(value));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Whole days elapsed since the given timestamp. */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/** Build a wa.me link for a Brazilian phone number (optional prefilled text). */
export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  const base = `https://wa.me/${withCountry}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Compact relative age in pt-BR: "5min", "2h", "3d". */
export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** True when an OPEN deal has no future next contact scheduled. */
export function hasNoNextStep(deal: {
  status: string;
  next_contact_at: string | null;
}): boolean {
  if (deal.status !== "open") return false;
  if (!deal.next_contact_at) return true;
  const d = new Date(deal.next_contact_at);
  return Number.isNaN(d.getTime()) || d.getTime() <= Date.now();
}

/** ISO timestamp N days from now at 09:00 local time (follow-up slots). */
export function nextContactISO(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/** ISO timestamp for a picked YYYY-MM-DD date at 09:00 local time. */
export function dateToContactISO(date: string): string {
  const d = new Date(`${date}T09:00:00`);
  return d.toISOString();
}

/**
 * Suggested follow-up interval (days) from the configured cadence and the
 * number of no-answer attempts already logged (1st attempt -> cadence[0],
 * 2nd -> cadence[1], further -> last item).
 */
export function cadencePreset(
  cadence: number[] | undefined,
  attempts: number,
): number {
  const c = cadence && cadence.length > 0 ? cadence : [1, 3, 7];
  if (attempts <= 0) return c[0];
  return c[Math.min(attempts - 1, c.length - 1)];
}

export interface TemplateVars {
  first_name?: string;
  course?: string;
  unit?: string;
  consultant?: string;
}

/** Render a message template body, replacing missing variables with "". */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(
    /\{\{\s*(first_name|course|unit|consultant)\s*\}\}/g,
    (_match, key: string) => vars[key as keyof TemplateVars] ?? "",
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Format minutes as a human duration in pt-BR (e.g. "1h 32min"). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
    return "—";
  }
  const m = Math.round(minutes);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Today's date as YYYY-MM-DD (local time). */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** ISO date N days ago (local time). */
export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
