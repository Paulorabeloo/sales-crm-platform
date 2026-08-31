"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlarmClockOff,
  CalendarDays,
  CheckSquare,
  Flame,
  Zap,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { QuickLogActions } from "@/components/deals/quick-log";
import { WhatsAppButton } from "@/components/deals/whatsapp-button";
import { RescueList } from "@/components/rescue/rescue-list";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyDay, useRecoverableDeals, useUsers } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { MyDayDealRow, MyDayTaskRow } from "@/lib/api/types";
import { t } from "@/lib/strings";
import {
  cn,
  formatDate,
  formatDateTime,
  formatRelativeAge,
} from "@/lib/utils";

const ALL = "__all__";

/** Quiet funnel glyph, echoing the brand mark (same as EmptyState). */
function FunnelGlyph() {
  return (
    <svg
      viewBox="0 0 64 44"
      aria-hidden
      className="h-11 w-16 text-muted-foreground/50"
    >
      <rect x="6" y="6" width="52" height="7" rx="3.5" fill="currentColor" opacity="0.5" />
      <rect x="14" y="19" width="36" height="7" rx="3.5" fill="currentColor" opacity="0.32" />
      <rect x="22" y="32" width="20" height="7" rx="3.5" fill="currentColor" opacity="0.18" />
    </svg>
  );
}

function DealRow({
  row,
  highlightAge = false,
  meta,
}: {
  row: MyDayDealRow;
  /** "Responder agora": lead age in evidence. */
  highlightAge?: boolean;
  /** Extra context line (scheduled time / last activity). */
  meta?: string;
}) {
  const vars = {
    first_name: (row.contact_name || row.title).trim().split(/\s+/)[0] ?? "",
    course: row.interest_course ?? "",
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/negociacoes/${row.deal_id}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {row.contact_name || row.title}
          </Link>
          {highlightAge && (
            <span className="tnum rounded-full bg-warning/15 px-2 py-px text-[11px] font-semibold text-warning-foreground dark:bg-warning/20 dark:text-warning">
              {t.myDay.leadAge(formatRelativeAge(row.created_at))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {row.interest_course && <span>{row.interest_course}</span>}
          <Badge variant="secondary" className="text-muted-foreground">
            {row.stage_name}
          </Badge>
          {meta && <span>{meta}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <WhatsAppButton
          dealId={row.deal_id}
          phone={row.contact_phone}
          dealStatus="open"
          firstContactAt={row.first_whatsapp_contact_at}
          vars={vars}
        />
        <QuickLogActions dealId={row.deal_id} asMenu />
      </div>
    </li>
  );
}

function TaskRow({ task }: { task: MyDayTaskRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2.5">
      <CheckSquare className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {t.myDay.taskLabel}: {task.deal_title} ·{" "}
          {t.myDay.taskDue(formatDate(task.due_date))}
        </span>
      </div>
      <Link
        href={`/negociacoes/${task.deal_id}`}
        className="shrink-0 text-xs font-medium text-accent-foreground hover:underline"
      >
        {t.myDay.openDeal}
      </Link>
    </li>
  );
}

function Section({
  title,
  hint,
  icon: Icon,
  count,
  tone = "default",
  children,
}: {
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  tone?: "default" | "urgent" | "overdue";
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <Icon
          className={cn(
            "size-4 translate-y-0.5",
            tone === "urgent" && "text-accent-foreground",
            tone === "overdue" && "text-destructive/80",
            tone === "default" && "text-muted-foreground",
          )}
        />
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <span className="tnum rounded-full bg-muted px-2 py-px text-[11px] font-semibold text-muted-foreground">
          {count}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

export default function MyDayPage() {
  const { isAdmin } = useAuth();
  const [ownerId, setOwnerId] = React.useState(ALL);
  const { data: users } = useUsers(isAdmin);
  const myDay = useMyDay(isAdmin && ownerId !== ALL ? ownerId : undefined);
  const recoverable = useRecoverableDeals();
  const rescueCount = recoverable.data?.total ?? 0;

  const data = myDay.data;
  const counts = data
    ? {
        respond: data.respond_now.length,
        today: data.today.tasks.length + data.today.followups.length,
        overdue: data.overdue.tasks.length + data.overdue.followups.length,
        cooling: data.cooling_no_next_step.length,
      }
    : null;
  const allClear =
    counts !== null &&
    counts.respond + counts.today + counts.overdue + counts.cooling === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {t.myDay.title}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {t.myDay.subtitle}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">
              {t.myDay.consultantFilter}
            </Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t.myDay.wholeTeam}</SelectItem>
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">{t.rescue.tabQueue}</TabsTrigger>
          <TabsTrigger value="rescue" className="gap-1.5">
            {t.rescue.title}
            {rescueCount > 0 && (
              <span className="tnum rounded-full bg-warning/20 px-1.5 py-px text-[11px] font-semibold text-warning-foreground dark:bg-warning/25 dark:text-warning">
                {rescueCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
      {myDay.isLoading ? (
        <LoadingState />
      ) : myDay.isError || !data ? (
        <ErrorState
          message={myDay.error ? errorMessage(myDay.error) : undefined}
          onRetry={() => void myDay.refetch()}
        />
      ) : allClear ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/25 py-16 text-center">
          <FunnelGlyph />
          <p className="text-sm font-semibold">{t.myDay.allClear}</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            {t.myDay.allClearHint}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Section
            title={t.myDay.respondNow}
            hint={t.myDay.respondNowHint}
            icon={Zap}
            count={data.respond_now.length}
            tone="urgent"
          >
            {data.respond_now.map((row) => (
              <DealRow
                key={row.deal_id}
                row={row}
                highlightAge
                meta={t.myDay.waitingSince(formatDateTime(row.created_at))}
              />
            ))}
          </Section>

          <Section
            title={t.myDay.todayTitle}
            hint={t.myDay.todayHint}
            icon={CalendarDays}
            count={data.today.tasks.length + data.today.followups.length}
          >
            {data.today.followups.map((row) => (
              <DealRow
                key={row.deal_id}
                row={row}
                meta={t.myDay.scheduledFor(
                  formatDateTime(row.next_contact_at),
                )}
              />
            ))}
            {data.today.tasks.map((task) => (
              <TaskRow key={task.task_id} task={task} />
            ))}
          </Section>

          <Section
            title={t.myDay.overdueTitle}
            hint={t.myDay.overdueHint}
            icon={AlarmClockOff}
            count={data.overdue.tasks.length + data.overdue.followups.length}
            tone="overdue"
          >
            {data.overdue.followups.map((row) => (
              <DealRow
                key={row.deal_id}
                row={row}
                meta={t.myDay.scheduledFor(
                  formatDateTime(row.next_contact_at),
                )}
              />
            ))}
            {data.overdue.tasks.map((task) => (
              <TaskRow key={task.task_id} task={task} />
            ))}
          </Section>

          <Section
            title={t.myDay.coolingTitle}
            hint={t.myDay.coolingHint(data.cooling_days)}
            icon={Flame}
            count={data.cooling_no_next_step.length}
          >
            {data.cooling_no_next_step.map((row) => (
              <DealRow
                key={row.deal_id}
                row={row}
                meta={`${t.reports.cooling.lastActivity}: ${formatDateTime(row.last_activity_at)}`}
              />
            ))}
          </Section>
        </div>
      )}
        </TabsContent>

        <TabsContent value="rescue" className="mt-4">
          <RescueList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
