"use client";

import { Target } from "lucide-react";
import { useMyGoalProgress } from "@/hooks/queries";
import { t } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * Discreet enrollment-goal progress for the logged-in consultant, shown in the
 * kanban header (spec 10.3). Hidden when the user has no goal in the cycle.
 */
export function GoalProgressBar({ cycleId }: { cycleId?: string }) {
  const { data } = useMyGoalProgress(cycleId);
  const row = data?.rows[0];
  if (!row) return null;

  const pct = Math.max(0, Math.min(100, row.pct));
  const reached = row.won_count >= row.target_count;

  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title={`${t.goalsBar.label}: ${row.won_count}/${row.target_count}`}
    >
      <Target className="size-3.5 shrink-0" />
      <span className="hidden sm:inline">{t.goalsBar.label}:</span>
      <span className="tnum font-semibold text-foreground">
        {t.goalsBar.progress(row.won_count, row.target_count)}
      </span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            reached ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
