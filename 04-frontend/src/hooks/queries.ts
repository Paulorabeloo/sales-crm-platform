"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import {
  campaignSpendApi,
  contactsApi,
  cyclesApi,
  dealFieldsApi,
  dealsApi,
  goalsApi,
  leadSourcesApi,
  lostReasonsApi,
  messageTemplatesApi,
  myDayApi,
  objectionsApi,
  pipelinesApi,
  unitsApi,
  reportsApi,
  settingsApi,
  tasksApi,
  usersApi,
  type KanbanFilters,
} from "@/lib/api/resources";
import type { Cycle, ReportFilters } from "@/lib/api/types";

export const queryKeys = {
  kanban: (filters: KanbanFilters) => ["kanban", filters] as const,
  deal: (id: string) => ["deal", id] as const,
  activities: (dealId: string) => ["activities", dealId] as const,
  dealTasks: (dealId: string) => ["deal-tasks", dealId] as const,
  myTasks: ["my-tasks"] as const,
  contacts: (search: string, page: number) => ["contacts", search, page] as const,
  users: ["users"] as const,
  units: ["units"] as const,
  pipelines: ["pipelines"] as const,
  lostReasons: ["lost-reasons"] as const,
  leadSources: ["lead-sources"] as const,
  settings: ["settings"] as const,
  dealFields: ["deal-fields"] as const,
  myDay: (ownerId?: string) => ["my-day", ownerId ?? null] as const,
  messageTemplates: (includeInactive: boolean) =>
    ["message-templates", includeInactive] as const,
  cycles: ["cycles"] as const,
  activeCycle: ["active-cycle"] as const,
  campaignSpend: ["campaign-spend"] as const,
  goals: (cycleId?: string) => ["goals", cycleId ?? null] as const,
  goalProgress: (cycleId?: string) =>
    ["goal-progress", cycleId ?? null] as const,
  myGoalProgress: (cycleId?: string) =>
    ["my-goal-progress", cycleId ?? null] as const,
  objections: (includeInactive: boolean) =>
    ["objections", includeInactive] as const,
  recoverable: (cycleIdBefore?: string) =>
    ["recoverable-deals", cycleIdBefore ?? null] as const,
};

export function useKanban(filters: KanbanFilters) {
  return useQuery({
    queryKey: queryKeys.kanban(filters),
    queryFn: () => dealsApi.kanban(filters),
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: queryKeys.deal(id),
    queryFn: () => dealsApi.get(id),
  });
}

export function useActivities(dealId: string) {
  return useQuery({
    queryKey: queryKeys.activities(dealId),
    queryFn: () => dealsApi.activities(dealId),
  });
}

export function useDealTasks(dealId: string) {
  return useQuery({
    queryKey: queryKeys.dealTasks(dealId),
    queryFn: () => dealsApi.tasks(dealId),
  });
}

export function useMyTasks() {
  return useQuery({ queryKey: queryKeys.myTasks, queryFn: tasksApi.mine });
}

export function useContacts(search: string, page: number) {
  return useQuery({
    queryKey: queryKeys.contacts(search, page),
    queryFn: () => contactsApi.list({ search: search || undefined, page }),
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: usersApi.list,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: queryKeys.units,
    queryFn: unitsApi.list,
    staleTime: 5 * 60_000,
  });
}

export function usePipelines() {
  return useQuery({
    queryKey: queryKeys.pipelines,
    queryFn: pipelinesApi.list,
    staleTime: 5 * 60_000,
  });
}

export function useLostReasons() {
  return useQuery({
    queryKey: queryKeys.lostReasons,
    queryFn: lostReasonsApi.list,
    staleTime: 5 * 60_000,
  });
}

export function useLeadSources(enabled = true) {
  return useQuery({
    queryKey: queryKeys.leadSources,
    queryFn: leadSourcesApi.list,
    enabled,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: settingsApi.get,
    staleTime: 5 * 60_000,
  });
}

/** Required-fields catalog (GET /deal-fields) — static per session. */
export function useDealFields() {
  return useQuery({
    queryKey: queryKeys.dealFields,
    queryFn: dealFieldsApi.list,
    staleTime: 30 * 60_000,
  });
}

/** GET /my-day — admin may scope to a single consultant via ownerId. */
export function useMyDay(ownerId?: string) {
  return useQuery({
    queryKey: queryKeys.myDay(ownerId),
    queryFn: () => myDayApi.get(ownerId),
  });
}

export function useMessageTemplates(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.messageTemplates(includeInactive),
    queryFn: () => messageTemplatesApi.list(includeInactive),
    staleTime: 5 * 60_000,
  });
}

// ---------- Cycles / goals / spend / objections / rescue (wave 2) ----------

export function useCycles() {
  return useQuery({
    queryKey: queryKeys.cycles,
    queryFn: cyclesApi.list,
    staleTime: 5 * 60_000,
  });
}

/** Active cycle; resolves to null (not an error) when none is active. */
export function useActiveCycle() {
  return useQuery<Cycle | null>({
    queryKey: queryKeys.activeCycle,
    queryFn: async () => {
      try {
        return await cyclesApi.active();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useCampaignSpend(enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaignSpend,
    queryFn: () => campaignSpendApi.list(),
    enabled,
  });
}

export function useGoals(cycleId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.goals(cycleId),
    queryFn: () => goalsApi.list(cycleId),
    enabled: enabled && !!cycleId,
  });
}

/** Admin ranking (default: active cycle server-side). */
export function useGoalProgress(cycleId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.goalProgress(cycleId),
    queryFn: () => goalsApi.progress(cycleId),
    enabled,
  });
}

/** Consultant-scoped goals of the logged-in user (kanban progress bar). */
export function useMyGoalProgress(cycleId?: string) {
  return useQuery({
    queryKey: queryKeys.myGoalProgress(cycleId),
    queryFn: () => goalsApi.myProgress(cycleId),
    retry: false,
  });
}

export function useObjections(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.objections(includeInactive),
    queryFn: () => objectionsApi.list(includeInactive),
    staleTime: 5 * 60_000,
  });
}

/** Recoverable lost deals from previous cycles (rescue list + menu badge). */
export function useRecoverableDeals(cycleIdBefore?: string) {
  return useQuery({
    queryKey: queryKeys.recoverable(cycleIdBefore),
    queryFn: () => dealsApi.recoverable(cycleIdBefore),
    staleTime: 60_000,
    retry: false,
  });
}

// ---------- Reports ----------

export function useReportSummary(f: ReportFilters) {
  return useQuery({
    queryKey: ["report-summary", f] as const,
    queryFn: () => reportsApi.summary(f),
  });
}

export function useReportFunnel(f: ReportFilters) {
  return useQuery({
    queryKey: ["report-funnel", f] as const,
    queryFn: () => reportsApi.funnel(f),
  });
}

export function useReportLostReasons(f: ReportFilters) {
  return useQuery({
    queryKey: ["report-lost-reasons", f] as const,
    queryFn: () => reportsApi.lostReasons(f),
  });
}

export function useReportResponseTime(
  f: Pick<ReportFilters, "from" | "to" | "cycle_id">,
) {
  return useQuery({
    queryKey: ["report-response-time", f.from, f.to, f.cycle_id] as const,
    queryFn: () => reportsApi.responseTime(f),
  });
}

export function useReportSales(
  f: Pick<ReportFilters, "from" | "to" | "cycle_id"> & { group_by?: string },
) {
  return useQuery({
    queryKey: [
      "report-sales",
      f.from,
      f.to,
      f.cycle_id,
      f.group_by ?? "month",
    ] as const,
    queryFn: () => reportsApi.sales(f),
  });
}

export function useReportCooling() {
  return useQuery({
    queryKey: ["report-cooling"] as const,
    queryFn: () => reportsApi.cooling(),
  });
}

export function useReportCac(
  f: { from?: string; to?: string; cycle_id?: string },
  groupBy: "source" | "campaign" | "unit" | "month",
) {
  return useQuery({
    queryKey: ["report-cac", f.from, f.to, f.cycle_id, groupBy] as const,
    queryFn: () => reportsApi.cac(f, groupBy),
  });
}

export function useReportConversations(
  f: Pick<ReportFilters, "from" | "to" | "cycle_id">,
) {
  return useQuery({
    queryKey: ["report-conversations", f.from, f.to, f.cycle_id] as const,
    queryFn: () => reportsApi.conversations(f),
  });
}
