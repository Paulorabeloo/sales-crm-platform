"use client";

import { CalendarClock } from "lucide-react";
import { useActiveCycle } from "@/hooks/queries";
import { t } from "@/lib/strings";
import { cn, formatDate } from "@/lib/utils";

/** Whole days from today (local midnight) until a YYYY-MM-DD date. */
export function daysUntil(dateISO: string): number {
  const target = new Date(`${dateISO}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Active-cycle deadline countdown chip for the kanban header (spec 10.1).
 * Urgent tone under 7 days; destructive when the deadline has passed.
 */
export function CycleCountdown() {
  const { data: cycle } = useActiveCycle();
  if (!cycle) return null;

  const days = cycle.deadline_on ? daysUntil(cycle.deadline_on) : null;
  const over = days !== null && days < 0;
  const urgent = days !== null && days >= 0 && days < 7;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
        over && "border-destructive/40 bg-destructive/10 text-destructive",
        urgent &&
          "border-warning/50 bg-warning/15 text-warning-foreground dark:bg-warning/20 dark:text-warning",
        !over && !urgent && "bg-muted/60 text-muted-foreground",
      )}
      title={
        cycle.deadline_on
          ? t.cycle.deadlineAt(formatDate(cycle.deadline_on))
          : undefined
      }
    >
      <CalendarClock className="size-3.5 shrink-0" />
      <span className="font-medium">
        {t.cycle.activePrefix}: {cycle.name}
      </span>
      {days !== null && (
        <span className="tnum font-semibold">
          {over
            ? t.cycle.countdownOver
            : days === 0
              ? t.cycle.countdownToday
              : t.cycle.countdownDays(days)}
        </span>
      )}
    </div>
  );
}
