"use client";

import * as React from "react";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { dealFieldLabel } from "@/components/deals/missing-fields-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDealFields } from "@/hooks/queries";
import type { Deal, DealFieldDef, Stage } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cn } from "@/lib/utils";

/** Field ids rendered by DealFieldsCard (df-*) for direct focus. */
const DEAL_FIELD_IDS: Record<string, string> = {
  value: "df-value",
  expected_close_date: "df-close",
  source: "df-source",
  campaign: "df-campaign",
  title: "df-title",
};

function fieldType(catalog: DealFieldDef[] | undefined, key: string) {
  return catalog?.find((f) => f.key === key)?.type ?? "string";
}

/** Generic "is this required field satisfied on the deal?" check. */
function isSatisfied(
  deal: Deal,
  key: string,
  catalog: DealFieldDef[] | undefined,
): boolean {
  const type = fieldType(catalog, key);
  let raw: unknown;
  if (key === "first_whatsapp_contact_at") {
    raw = deal.first_whatsapp_contact_at;
  } else if (key.startsWith("enrollment.")) {
    const data = deal.enrollment_data as Record<string, unknown> | null;
    raw = data?.[key.slice("enrollment.".length)];
  } else if (key.startsWith("contact.")) {
    const contact = deal.contact as unknown as Record<string, unknown> | null;
    raw = contact?.[key.slice("contact.".length)];
  } else {
    raw = (deal as unknown as Record<string, unknown>)[key];
  }
  if (type === "boolean") return raw === true;
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim() !== "";
  return true;
}

/** Scroll to (and focus) the input backing a checklist item, when it exists. */
function focusField(key: string) {
  const id = key.startsWith("enrollment.")
    ? `ef-${key.slice("enrollment.".length)}`
    : DEAL_FIELD_IDS[key];
  const el = id ? document.getElementById(id) : null;
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => (el as HTMLElement).focus?.(), 350);
    return;
  }
  // Selects/switches without an input id: land on the owning card instead.
  const cardId = key.startsWith("enrollment.")
    ? "enrollment-form-card"
    : "deal-fields-card";
  document
    .getElementById(cardId)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Closing checklist: on the stage right before the won stage,
 * shows the won stage's required_fields as a live tick list. Fully generic —
 * items come from the stage config, never hardcoded.
 */
export function ClosingChecklist({
  deal,
  stages,
}: {
  deal: Deal;
  stages: Stage[];
}) {
  const { data: catalog } = useDealFields();

  if (deal.status !== "open") return null;
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const wonIndex = sorted.findIndex((s) => s.is_won_stage);
  if (wonIndex <= 0) return null;
  const preWonStage = sorted[wonIndex - 1];
  if (deal.stage_id !== preWonStage.id) return null;

  const wonStage = sorted[wonIndex];
  const required = wonStage.required_fields;
  if (required.length === 0) return null;

  const items = required.map((key) => ({
    key,
    label: dealFieldLabel(key),
    done: isSatisfied(deal, key, catalog),
  }));
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4 text-accent-foreground" />
          {t.checklist.title}
          <span className="tnum ml-auto text-sm font-semibold text-muted-foreground">
            {t.checklist.progress(done, items.length)}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t.checklist.subtitle(wonStage.name)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              done === items.length ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t.checklist.goToField(item.label)}
                onClick={() => focusField(item.key)}
              >
                {item.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground/50" />
                )}
                <span
                  className={cn(
                    item.done
                      ? "text-muted-foreground line-through decoration-muted-foreground/40"
                      : "font-medium",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
