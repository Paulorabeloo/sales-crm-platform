"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CycleCountdown } from "@/components/cycles/cycle-countdown";
import { CreateDealDialog } from "@/components/kanban/create-deal-dialog";
import {
  FILTER_ALL,
  FiltersBar,
  type KanbanFilterState,
} from "@/components/kanban/filters-bar";
import { GoalProgressBar } from "@/components/kanban/goal-progress";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { LeadQueue } from "@/components/kanban/lead-queue";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { useActiveCycle, useKanban, usePipelines } from "@/hooks/queries";
import type { KanbanFilters } from "@/lib/api/resources";
import type { DealCard, KanbanStageColumn } from "@/lib/api/types";
import { errorMessage } from "@/lib/api/client";
import { t } from "@/lib/strings";

/** Case-insensitive match on contact name / title / course (client-side —
 * the backend kanban has no search param). */
function matchesSearch(deal: DealCard, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return (
    deal.contact_name.toLowerCase().includes(q) ||
    deal.title.toLowerCase().includes(q) ||
    (deal.interest_course ?? "").toLowerCase().includes(q)
  );
}

function DealsPageInner() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";

  const pipelinesQuery = usePipelines();
  const activeCycleQuery = useActiveCycle();

  const [filters, setFilters] = React.useState<KanbanFilterState>({
    pipeline_id: "",
    owner_id: FILTER_ALL,
    status: FILTER_ALL,
    unit_id: FILTER_ALL,
    cycle_id: "",
    cooling: false,
    noNextStep: false,
    search: initialSearch,
  });

  // Default cycle filter = active cycle; ALL when none exists.
  React.useEffect(() => {
    if (filters.cycle_id === "" && activeCycleQuery.isSuccess) {
      const active = activeCycleQuery.data;
      setFilters((f) =>
        f.cycle_id === ""
          ? { ...f, cycle_id: active ? active.id : FILTER_ALL }
          : f,
      );
    }
  }, [activeCycleQuery.isSuccess, activeCycleQuery.data, filters.cycle_id]);

  // Header search navigates with ?q= — keep local filter in sync.
  React.useEffect(() => {
    setFilters((f) =>
      f.search === initialSearch ? f : { ...f, search: initialSearch },
    );
  }, [initialSearch]);

  // Pick the default pipeline once loaded.
  const pipelines = React.useMemo(
    () => (pipelinesQuery.data ?? []).filter((p) => p.is_active),
    [pipelinesQuery.data],
  );
  React.useEffect(() => {
    if (!filters.pipeline_id && pipelines.length > 0) {
      const def = pipelines.find((p) => p.is_default) ?? pipelines[0];
      setFilters((f) => ({ ...f, pipeline_id: def.id }));
    }
  }, [pipelines, filters.pipeline_id]);

  const selectedCycleId =
    filters.cycle_id && filters.cycle_id !== FILTER_ALL
      ? filters.cycle_id
      : undefined;

  const apiFilters: KanbanFilters = {
    pipeline_id: filters.pipeline_id || undefined,
    owner_id: filters.owner_id === FILTER_ALL ? undefined : filters.owner_id,
    status: filters.status === FILTER_ALL ? undefined : filters.status,
    unit_id: filters.unit_id === FILTER_ALL ? undefined : filters.unit_id,
    cooling: filters.cooling || undefined,
    no_next_step: filters.noNextStep || undefined,
    cycle_id: selectedCycleId,
    search: filters.search || undefined,
  };

  const kanbanQuery = useKanban(apiFilters);

  // Client-side: apply the text search and split the unassigned queue
  // (owner_id null + open) out of the board columns.
  const view = React.useMemo(() => {
    const data = kanbanQuery.data;
    if (!data) return null;
    const unassigned: DealCard[] = [];
    const columns: KanbanStageColumn[] = data.stages.map((col) => {
      const kept: DealCard[] = [];
      for (const deal of col.deals) {
        if (!matchesSearch(deal, filters.search)) continue;
        if (deal.owner_id === null && deal.status === "open") {
          unassigned.push(deal);
        } else {
          kept.push(deal);
        }
      }
      return { ...col, deals: kept };
    });
    return { columns, unassigned };
  }, [kanbanQuery.data, filters.search]);

  const activePipeline = pipelines.find((p) => p.id === filters.pipeline_id);
  const stages = React.useMemo(
    () =>
      [...(activePipeline?.stages ?? [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    [activePipeline],
  );

  const loading =
    pipelinesQuery.isLoading || (!!filters.pipeline_id && kanbanQuery.isLoading);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            {t.kanban.title}
          </h1>
          <CycleCountdown />
          <GoalProgressBar cycleId={selectedCycleId} />
        </div>
        {filters.pipeline_id && (
          <CreateDealDialog pipelineId={filters.pipeline_id} />
        )}
      </div>

      {pipelines.length > 0 && (
        <FiltersBar
          pipelines={pipelines}
          filters={filters}
          onChange={setFilters}
          defaultCycleId={activeCycleQuery.data?.id}
        />
      )}

      {loading ? (
        <LoadingState />
      ) : pipelinesQuery.isError ? (
        <ErrorState
          message={errorMessage(pipelinesQuery.error)}
          onRetry={() => void pipelinesQuery.refetch()}
        />
      ) : kanbanQuery.isError ? (
        <ErrorState
          message={errorMessage(kanbanQuery.error)}
          onRetry={() => void kanbanQuery.refetch()}
        />
      ) : view ? (
        <>
          <LeadQueue deals={view.unassigned} />
          {stages.length === 0 ? (
            <EmptyState message={t.kanban.emptyBoard} />
          ) : (
            <KanbanBoard stages={stages} columns={view.columns} />
          )}
        </>
      ) : null}
    </div>
  );
}

export default function DealsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <DealsPageInner />
    </React.Suspense>
  );
}
