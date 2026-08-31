"use client";

import * as React from "react";
import { Coins, MessagesSquare, Target } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useGoalProgress,
  useReportCac,
  useReportConversations,
} from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { GoalProgressRow, ReportFilters } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cn, formatCurrency } from "@/lib/utils";

type CacGroupBy = "source" | "campaign" | "unit" | "month";

/** Currency cell that NEVER fakes a zero: null renders as em-blank. */
function money(value: string | null): string {
  return value === null ? t.common.none : formatCurrency(value);
}

function pctFraction(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return t.common.none;
  return `${(fraction * 100).toFixed(1).replace(".", ",")}%`;
}

// ---------------------------------------------------------------- CAC

export function CacSection({ filters }: { filters: ReportFilters }) {
  const [groupBy, setGroupBy] = React.useState<CacGroupBy>("source");
  const query = useReportCac(
    { from: filters.from, to: filters.to, cycle_id: filters.cycle_id },
    groupBy,
  );
  const data = query.data;
  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="size-4 text-muted-foreground" />
            {t.reports.cac.title}
          </CardTitle>
          <CardDescription>{t.reports.cac.subtitle}</CardDescription>
        </div>
        <Select
          value={groupBy}
          onValueChange={(v) => setGroupBy(v as CacGroupBy)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(t.reports.cac.groupBy) as [CacGroupBy, string][]
            ).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState message={t.reports.cac.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.cac.groupBy[groupBy]}</TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.spend}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.leads}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.enrollments}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.costPerLead}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.costPerEnrollment}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.cac.leadToEnrollment}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={`${row.group_key ?? "__null__"}-${i}`}>
                  <TableCell className="font-medium">
                    {row.group_key ?? t.reports.cac.unattributed}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.spend === null ? (
                      <span className="text-xs italic text-muted-foreground">
                        {t.reports.cac.noSpend}
                      </span>
                    ) : (
                      formatCurrency(row.spend)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.leads_count}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.enrollments}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(row.cost_per_lead)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {money(row.cost_per_enrollment)}
                  </TableCell>
                  <TableCell className="text-right">
                    {pctFraction(row.lead_to_enrollment_rate)}
                  </TableCell>
                </TableRow>
              ))}
              {data && (
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell>{t.common.all}</TableCell>
                  <TableCell className="text-right">
                    {money(data.total_spend)}
                  </TableCell>
                  <TableCell className="text-right">
                    {data.total_leads}
                  </TableCell>
                  <TableCell className="text-right">
                    {data.total_enrollments}
                  </TableCell>
                  <TableCell className="text-right">{t.common.none}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {money(data.cac_average)}
                  </TableCell>
                  <TableCell className="text-right">
                    {data.total_leads > 0
                      ? pctFraction(data.total_enrollments / data.total_leads)
                      : t.common.none}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Goals

function GoalRows({ rows }: { rows: GoalProgressRow[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, row.pct));
        const reached = row.won_count >= row.target_count;
        const name =
          row.scope === "consultant"
            ? (row.target_user_name ?? t.common.none)
            : (row.unit_name ?? t.common.none);
        return (
          <li key={row.goal_id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">{name}</span>
              <span className="tnum text-muted-foreground">
                {row.won_count}/{row.target_count} ·{" "}
                {String(row.pct).replace(".", ",")}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  reached ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function GoalsSection({ cycleId }: { cycleId?: string }) {
  const query = useGoalProgress(cycleId);
  const rows = query.data?.rows ?? [];
  const consultants = rows.filter((r) => r.scope === "consultant");
  const units = rows.filter((r) => r.scope === "unit");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4 text-muted-foreground" />
          {t.reports.goals.title}
        </CardTitle>
        <CardDescription>{t.reports.goals.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState message={t.reports.goals.empty} />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {consultants.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t.reports.goals.consultants}
                </h4>
                <GoalRows rows={consultants} />
              </div>
            )}
            {units.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t.reports.goals.units}
                </h4>
                <GoalRows rows={units} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Conversations

export function ConversationsSection({
  filters,
}: {
  filters: ReportFilters;
}) {
  const query = useReportConversations({
    from: filters.from,
    to: filters.to,
    cycle_id: filters.cycle_id,
  });
  const rows = query.data?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="size-4 text-muted-foreground" />
          {t.reports.conversations.title}
        </CardTitle>
        <CardDescription>{t.reports.conversations.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState message={t.reports.conversations.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.conversations.consultant}</TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.attempts}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.conversations}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.rate}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.visits}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.objections}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.conversations.overcome}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.user_id ?? "__queue__"}>
                  <TableCell className="font-medium">
                    {row.user_name ?? t.kanban.queueTitle}
                  </TableCell>
                  <TableCell className="text-right">{row.attempts}</TableCell>
                  <TableCell className="text-right">
                    {row.conversations}
                  </TableCell>
                  <TableCell className="text-right">
                    {pctFraction(row.contact_to_conversation_rate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.visits_scheduled}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.objections_registered}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.objections_overcome_pct === null ? (
                      t.common.none
                    ) : (
                      <span className="tnum">
                        {String(row.objections_overcome_pct).replace(".", ",")}
                        %{" "}
                        <span className="text-xs text-muted-foreground">
                          ({row.objection_deals_won}/{row.objection_deals})
                        </span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
