"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarX2,
  Coins,
  Flame,
  Timer,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  CacSection,
  ConversationsSection,
  GoalsSection,
} from "@/components/reports/phase -sections";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  useActiveCycle,
  useCycles,
  useUnits,
  useReportCooling,
  useReportFunnel,
  useReportLostReasons,
  useReportResponseTime,
  useReportSales,
  useReportSummary,
  useUsers,
} from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { NoNextStepRow, ReportFilters } from "@/lib/api/types";
import { t } from "@/lib/strings";
import {
  daysAgoISO,
  formatCurrency,
  formatDateTime,
  formatMinutes,
} from "@/lib/utils";

const ALL = "__all__";

type PeriodKey = "7" | "30" | "90" | "year";

function periodToRange(period: PeriodKey): { from: string; to: string } {
  // Backend treats `to` as EXCLUSIVE (midnight) — send tomorrow so that
  // today's data is included.
  const to = daysAgoISO(-1);
  if (period === "year") return { from: `${new Date().getFullYear()}-01-01`, to };
  return { from: daysAgoISO(Number(period)), to };
}

function KpiCard({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
            {label}
          </p>
          <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
        </div>
        <p className="tnum truncate text-2xl font-semibold leading-none tracking-tight">
          {loading ? "…" : value}
        </p>
      </CardContent>
    </Card>
  );
}

function pct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return t.common.none;
  return `${(fraction * 100).toFixed(1).replace(".", ",")}%`;
}

function FunnelSection({ filters }: { filters: ReportFilters }) {
  const query = useReportFunnel(filters);
  const stages = query.data?.stages ?? [];
  // Diagnostic legends assume the default 6-stage funnel: each
  // transition drop points to a distinct operational problem.
  const showDiagnostics = stages.length === 6;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.reports.funnel.title}</CardTitle>
        <CardDescription>{t.reports.funnel.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : stages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stages.map((s) => ({
                    name: s.stage_name,
                    entered: s.deals_entered,
                  }))}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeOpacity={0.6}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickMargin={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.45 }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(16,24,32,0.08)",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                      padding: "6px 10px",
                    }}
                    formatter={(value) => [
                      String(value ?? 0),
                      t.reports.funnel.entered,
                    ]}
                  />
                  <Bar dataKey="entered" radius={[3, 3, 0, 0]} maxBarSize={40}>
                    {stages.map((s) => (
                      <Cell key={s.stage_id} fill="var(--chart-1)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.deal.stage}</TableHead>
                  <TableHead className="text-right">
                    {t.reports.funnel.entered}
                  </TableHead>
                  <TableHead className="text-right">
                    {t.reports.funnel.conversion}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((s, idx) => {
                  const diagnostic = showDiagnostics
                    ? t.reports.funnel.diagnostics[idx + 1]
                    : undefined;
                  return (
                    <TableRow key={s.stage_id}>
                      <TableCell className="font-medium">
                        {s.stage_name}
                        {diagnostic && (
                          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                            {diagnostic}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {s.deals_entered}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {pct(s.conversion_from_previous)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LostReasonsSection({ filters }: { filters: ReportFilters }) {
  const query = useReportLostReasons(filters);
  const reasons = query.data?.reasons ?? [];
  const objections = query.data?.top_objections ?? [];
  const max = Math.max(1, ...reasons.map((r) => r.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.reports.lostReasons.title}</CardTitle>
        <CardDescription>{t.reports.lostReasons.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : reasons.length === 0 ? (
          <EmptyState message={t.reports.lostReasons.empty} />
        ) : (
          <div className="flex flex-col gap-5">
            <ul className="flex flex-col gap-2">
              {reasons.map((r) => (
                <li key={r.lost_reason_id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">{r.label}</span>
                    <span className="tnum text-muted-foreground">
                      {r.count} · {String(r.pct).replace(".", ",")}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-destructive/70 transition-[width] duration-300"
                      style={{ width: `${(r.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {(query.data?.objection_breakdown ?? []).length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t.reports.lostReasons.objectionCatalog}
                </h4>
                <ul className="flex flex-wrap gap-2">
                  {(query.data?.objection_breakdown ?? []).map((o) => (
                    <li
                      key={o.objection_id}
                      className="rounded-full bg-accent/60 px-3 py-1 text-xs text-accent-foreground dark:bg-accent/40"
                    >
                      {o.name} <span className="font-semibold">{o.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {objections.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t.reports.lostReasons.objections}
                </h4>
                <ul className="flex flex-wrap gap-2">
                  {objections.map((o) => (
                    <li
                      key={o.objection}
                      className="rounded-full bg-muted px-3 py-1 text-xs"
                    >
                      {o.objection}{" "}
                      <span className="font-semibold">{o.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResponseTimeSection({ filters }: { filters: ReportFilters }) {
  // Backend supports only period + cycle here (no unit/owner filter).
  const query = useReportResponseTime({
    from: filters.from,
    to: filters.to,
    cycle_id: filters.cycle_id,
  });
  const rows = query.data?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t.reports.responseTime.title}
        </CardTitle>
        <CardDescription>{t.reports.responseTime.subtitle}</CardDescription>
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
          <EmptyState message={t.reports.responseTime.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.responseTime.consultant}</TableHead>
                <TableHead className="text-right">
                  {t.reports.responseTime.median}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.responseTime.average}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.responseTime.within24h}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.responseTime.neverContacted}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // Backend reports % WITHOUT contact in 24h — invert for display.
                const within24h =
                  Math.round((100 - row.pct_no_contact_in_24h) * 10) / 10;
                return (
                  <TableRow key={row.owner_id ?? "__queue__"}>
                    <TableCell className="font-medium">
                      {row.owner_name ?? t.kanban.queueTitle}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMinutes(row.median_minutes)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMinutes(row.avg_minutes)}
                    </TableCell>
                    <TableCell className="text-right">
                      {`${String(within24h).replace(".", ",")}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.never_contacted > 0 ? (
                        <span className="font-semibold text-warning-foreground dark:text-warning">
                          {row.never_contacted}
                        </span>
                      ) : (
                        0
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Share of open deals with no future contact scheduled, per consultant. */
function NoNextStepSection({
  rows,
  loading,
}: {
  rows: NoNextStepRow[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarX2 className="size-4 text-muted-foreground" />
          {t.reports.noNextStep.title}
        </CardTitle>
        <CardDescription>{t.reports.noNextStep.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState message={t.reports.noNextStep.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.noNextStep.consultant}</TableHead>
                <TableHead className="text-right">
                  {t.reports.noNextStep.openDeals}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.noNextStep.withoutNext}
                </TableHead>
                <TableHead className="text-right">
                  {t.reports.noNextStep.pct}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.owner_id ?? "__queue__"}>
                  <TableCell className="font-medium">
                    {row.owner_name ?? t.reports.noNextStep.queue}
                  </TableCell>
                  <TableCell className="text-right">{row.open_deals}</TableCell>
                  <TableCell className="text-right">
                    {row.without_next_step}
                  </TableCell>
                  <TableCell
                    className={
                      row.pct >= 50
                        ? "text-right font-semibold text-warning-foreground dark:text-warning"
                        : "text-right"
                    }
                  >
                    {`${String(row.pct).replace(".", ",")}%`}
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

function SalesSection({ filters }: { filters: ReportFilters }) {
  // Backend groups by ONE dimension (month | unit | owner); the UI lets the
  // admin switch the grouping. Only the period filter applies here.
  const [groupBy, setGroupBy] = React.useState<"month" | "unit" | "owner">(
    "month",
  );
  const query = useReportSales({
    from: filters.from,
    to: filters.to,
    cycle_id: filters.cycle_id,
    group_by: groupBy,
  });
  const rows = React.useMemo(() => query.data?.rows ?? [], [query.data]);

  const chartData = React.useMemo(
    () => rows.map((r) => ({ name: r.group_key, count: r.enrollments })),
    [rows],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{t.reports.sales.title}</CardTitle>
          <CardDescription>{t.reports.sales.subtitle}</CardDescription>
        </div>
        <Select
          value={groupBy}
          onValueChange={(v) => setGroupBy(v as typeof groupBy)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">{t.reports.sales.month}</SelectItem>
            <SelectItem value="unit">{t.reports.sales.unit}</SelectItem>
            <SelectItem value="owner">{t.reports.sales.consultant}</SelectItem>
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
          <EmptyState message={t.reports.sales.empty} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeOpacity={0.6}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickMargin={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.45 }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(16,24,32,0.08)",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                      padding: "6px 10px",
                    }}
                    formatter={(value) => [
                      String(value ?? 0),
                      t.reports.sales.count,
                    ]}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--chart-2)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {groupBy === "month"
                      ? t.reports.sales.month
                      : groupBy === "unit"
                        ? t.reports.sales.unit
                        : t.reports.sales.consultant}
                  </TableHead>
                  <TableHead className="text-right">
                    {t.reports.sales.count}
                  </TableHead>
                  <TableHead className="text-right">
                    {t.reports.sales.total}
                  </TableHead>
                  <TableHead className="text-right">
                    {t.reports.sales.avgTicket}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={`${row.group_key}-${i}`}>
                    <TableCell>{row.group_key}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.enrollments}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.total_value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.avg_ticket)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoolingSection() {
  // Backend: GET /reports/cooling — no filters, grouped by owner.
  const query = useReportCooling();
  const groups = query.data?.groups ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4 text-warning-foreground dark:text-warning" />
          {t.reports.cooling.title}
        </CardTitle>
        <CardDescription>{t.reports.cooling.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : groups.length === 0 ? (
          <EmptyState message={t.reports.cooling.empty} />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.owner_id ?? "__queue__"}>
                <h4 className="mb-2 text-sm font-semibold">
                  {group.owner_name ?? t.kanban.queueTitle}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {group.count}
                  </span>
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.deal.detailTitle}</TableHead>
                      <TableHead>{t.deal.stage}</TableHead>
                      <TableHead className="text-right">
                        {t.reports.cooling.lastActivity}
                      </TableHead>
                      <TableHead className="text-right">
                        {t.reports.cooling.daysIdle}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.deals.map((deal) => (
                      <TableRow key={deal.deal_id}>
                        <TableCell>
                          <Link
                            href={`/negociacoes/${deal.deal_id}`}
                            className="font-medium hover:underline"
                          >
                            {deal.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {deal.stage_name}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDateTime(deal.last_activity_at)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-warning-foreground dark:text-warning">
                          {deal.days_idle}d
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const { isAdmin, loading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = React.useState<PeriodKey>("30");
  const [unitId, setUnitId] = React.useState(ALL);
  const [ownerId, setOwnerId] = React.useState(ALL);
  // "" while the active cycle loads; then the active id (default) or ALL.
  const [cycleId, setCycleId] = React.useState("");

  const { data: units } = useUnits();
  const { data: users } = useUsers(isAdmin);
  const { data: cycles } = useCycles();
  const activeCycleQuery = useActiveCycle();

  React.useEffect(() => {
    if (!loading && !isAdmin) router.replace("/negociacoes");
  }, [loading, isAdmin, router]);

  // Default cycle filter = active cycle; ALL when none exists.
  React.useEffect(() => {
    if (cycleId === "" && activeCycleQuery.isSuccess) {
      setCycleId(activeCycleQuery.data ? activeCycleQuery.data.id : ALL);
    }
  }, [cycleId, activeCycleQuery.isSuccess, activeCycleQuery.data]);

  const selectedCycleId = cycleId && cycleId !== ALL ? cycleId : undefined;

  const filters: ReportFilters = React.useMemo(() => {
    const { from, to } = periodToRange(period);
    return {
      from,
      to,
      unit_id: unitId === ALL ? undefined : unitId,
      owner_id: ownerId === ALL ? undefined : ownerId,
      cycle_id: selectedCycleId,
    };
  }, [period, unitId, ownerId, selectedCycleId]);

  const summaryQuery = useReportSummary(filters);
  const summary = summaryQuery.data;

  if (!isAdmin) return <LoadingState />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          {t.reports.title}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {t.reports.subtitle}
        </p>
      </div>

      {/* Global filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t.reports.filters.period}
          </Label>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as PeriodKey)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t.reports.filters.last7}</SelectItem>
              <SelectItem value="30">{t.reports.filters.last30}</SelectItem>
              <SelectItem value="90">{t.reports.filters.last90}</SelectItem>
              <SelectItem value="year">{t.reports.filters.thisYear}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t.cycle.filterLabel}
          </Label>
          <Select value={cycleId || ALL} onValueChange={setCycleId}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.cycle.allCycles}</SelectItem>
              {(cycles ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t.reports.filters.unit}
          </Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.common.all}</SelectItem>
              {(units ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t.reports.filters.owner}
          </Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.common.all}</SelectItem>
              {(users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label={t.reports.kpi.leads}
          value={summary ? String(summary.leads_count) : t.common.none}
          icon={Users}
          loading={summaryQuery.isLoading}
        />
        <KpiCard
          label={t.reports.kpi.conversion}
          value={summary ? pct(summary.conversion_rate) : t.common.none}
          icon={TrendingUp}
          loading={summaryQuery.isLoading}
        />
        <KpiCard
          label={t.reports.kpi.responseTime}
          value={summary ? formatMinutes(summary.median_response_minutes) : t.common.none}
          icon={Timer}
          loading={summaryQuery.isLoading}
        />
        <KpiCard
          label={t.reports.kpi.sales}
          value={
            summary
              ? `${summary.sales_count} · ${formatCurrency(summary.sales_value)}`
              : t.common.none
          }
          icon={Trophy}
          loading={summaryQuery.isLoading}
        />
        {/* CAC is never faked: null (no spend / no won) renders as blank. */}
        <KpiCard
          label={t.reports.kpi.cac}
          value={
            summary
              ? summary.cac_average !== null
                ? formatCurrency(summary.cac_average)
                : t.common.none
              : t.common.none
          }
          icon={Coins}
          loading={summaryQuery.isLoading}
        />
      </div>

      <CacSection filters={filters} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <FunnelSection filters={filters} />
        <LostReasonsSection filters={filters} />
      </div>
      <ResponseTimeSection filters={filters} />
      <ConversationsSection filters={filters} />
      <NoNextStepSection
        rows={summary?.no_next_step ?? []}
        loading={summaryQuery.isLoading}
      />
      <GoalsSection cycleId={selectedCycleId} />
      <SalesSection filters={filters} />
      <CoolingSection />
    </div>
  );
}
