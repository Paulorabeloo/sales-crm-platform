"use client";

import * as React from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  CheckSquare,
  FileText,
  MessageSquare,
  PhoneMissed,
  PlusCircle,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldAlert,
  ThumbsUp,
  UserCog,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { useAddNote } from "@/hooks/mutations";
import {
  useActivities,
  useCycles,
  useLostReasons,
  usePipelines,
} from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { Activity, ActivityType } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { formatDateTime } from "@/lib/utils";

const ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> =
  {
    note: MessageSquare,
    deal_created: PlusCircle,
    stage_changed: ArrowRightLeft,
    status_changed: Zap,
    first_contact_registered: Send,
    first_contact_corrected: Send,
    task_created: CheckSquare,
    task_completed: CheckSquare,
    owner_changed: UserCog,
    attempt_no_answer: PhoneMissed,
    talked_advance: ThumbsUp,
    talked_objection: ShieldAlert,
    visit_scheduled: CalendarCheck,
    cycle_changed: RefreshCcw,
    reopened_in_cycle: RotateCcw,
  };

function activityLabel(activity: Activity): string {
  const labels = t.activity as unknown as Record<string, string>;
  return labels[activity.type] ?? t.activity.unknown;
}

/**
 * Backend payloads carry ids, not names:
 * - stage_changed: {from_stage_id, to_stage_id}
 * - status_changed: {from, to, lost_reason_id?}
 * - task events: {task_id, title}
 * Names are resolved locally from the cached catalogs.
 */
function payloadSummary(
  activity: Activity,
  stageName: (id: unknown) => string | null,
  reasonLabel: (id: unknown) => string | null,
  cycleName: (id: unknown) => string | null,
): string | null {
  const p = activity.payload;
  if (!p) return null;
  const from = stageName(p.from_stage_id);
  const to = stageName(p.to_stage_id);
  if (from && to) return `${from} → ${to}`;
  if (to) return to;
  // cycle_changed (rollover) carries cycle ids, not stage ids.
  const fromCycle = cycleName(p.from_cycle_id);
  const toCycle = cycleName(p.to_cycle_id);
  if (fromCycle && toCycle) return `${fromCycle} → ${toCycle}`;
  const status = typeof p.to === "string" ? p.to : null;
  if (status && (status === "open" || status === "won" || status === "lost")) {
    const reason = reasonLabel(p.lost_reason_id);
    return reason ? `${t.status[status]}: ${reason}` : t.status[status];
  }
  // Quick log activities may carry the scheduled next contact.
  if (typeof p.next_contact_at === "string") {
    return t.activity.nextContactAt(formatDateTime(p.next_contact_at));
  }
  const title = typeof p.title === "string" ? p.title : null;
  return title;
}

function TimelineItem({
  activity,
  stageName,
  reasonLabel,
  cycleName,
}: {
  activity: Activity;
  stageName: (id: unknown) => string | null;
  reasonLabel: (id: unknown) => string | null;
  cycleName: (id: unknown) => string | null;
}) {
  const Icon = ICONS[activity.type] ?? FileText;
  const summary = payloadSummary(activity, stageName, reasonLabel, cycleName);
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{activityLabel(activity)}</span>
          <span className="text-xs text-muted-foreground">
            {activity.user_name ?? t.deal.system} ·{" "}
            {formatDateTime(activity.created_at)}
          </span>
        </div>
        {summary && (
          <p className="text-sm text-muted-foreground">{summary}</p>
        )}
        {activity.body && (
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm">
            {activity.body}
          </p>
        )}
      </div>
    </li>
  );
}

export function Timeline({ dealId }: { dealId: string }) {
  const activitiesQuery = useActivities(dealId);
  const addNote = useAddNote(dealId);
  const [note, setNote] = React.useState("");
  const { data: pipelines } = usePipelines();
  const { data: reasons } = useLostReasons();
  const { data: cycles } = useCycles();

  const stageName = React.useCallback(
    (id: unknown): string | null => {
      if (typeof id !== "string") return null;
      for (const pipeline of pipelines ?? []) {
        const stage = pipeline.stages.find((s) => s.id === id);
        if (stage) return stage.name;
      }
      return null;
    },
    [pipelines],
  );

  const reasonLabel = React.useCallback(
    (id: unknown): string | null => {
      if (typeof id !== "string") return null;
      return (reasons ?? []).find((r) => r.id === id)?.label ?? null;
    },
    [reasons],
  );

  const cycleName = React.useCallback(
    (id: unknown): string | null => {
      if (typeof id !== "string") return null;
      return (cycles ?? []).find((c) => c.id === id)?.name ?? null;
    },
    [cycles],
  );

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    const body = note.trim();
    if (!body) return;
    addNote.mutate(body, { onSuccess: () => setNote("") });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.deal.timelineTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={submitNote} className="flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.deal.addNotePlaceholder}
            aria-label={t.deal.addNote}
          />
          {note.trim() && (
            <div>
              <Button type="submit" size="sm" disabled={addNote.isPending}>
                {addNote.isPending ? t.common.saving : t.deal.addNote}
              </Button>
            </div>
          )}
        </form>

        {activitiesQuery.isLoading ? (
          <LoadingState />
        ) : activitiesQuery.isError ? (
          <ErrorState
            message={errorMessage(activitiesQuery.error)}
            onRetry={() => void activitiesQuery.refetch()}
          />
        ) : (activitiesQuery.data ?? []).length === 0 ? (
          <EmptyState message={t.deal.timelineEmpty} />
        ) : (
          <ul className="mt-1">
            {(activitiesQuery.data ?? []).map((activity) => (
              <TimelineItem
                key={activity.id}
                activity={activity}
                stageName={stageName}
                reasonLabel={reasonLabel}
                cycleName={cycleName}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
