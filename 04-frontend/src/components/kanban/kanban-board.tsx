"use client";

import * as React from "react";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { MissingFieldsDialog } from "@/components/deals/missing-fields-dialog";
import { NextContactPrompt } from "@/components/deals/next-contact-prompt";
import {
  DealCardContent,
  DraggableDealCard,
} from "@/components/kanban/deal-card";
import {
  gateMissingFields,
  isStageGateError,
  useMoveDeal,
  useSetNextContactFor,
} from "@/hooks/mutations";
import { useSettings } from "@/hooks/queries";
import type { DealCard, KanbanStageColumn, Stage } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cadencePreset, cn, formatCurrency } from "@/lib/utils";

interface ColumnProps {
  stage: Stage;
  column: KanbanStageColumn | undefined;
}

function ColumnHeader({ stage, column }: ColumnProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <h3 className="truncate text-[13px] font-semibold tracking-tight">
          {stage.name}
        </h3>
        <span className="tnum shrink-0 text-[11px] font-medium text-muted-foreground">
          {column?.deals.length ?? 0}
        </span>
      </div>
      <span className="tnum shrink-0 text-[11px] font-medium text-muted-foreground">
        {formatCurrency(column?.sum_value ?? 0)}
      </span>
    </div>
  );
}

function BoardColumn({ stage, column }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const deals = column?.deals ?? [];

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      <ColumnHeader stage={stage} column={column} />
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-1.5 rounded-lg border border-transparent bg-muted/45 p-1.5 transition-colors duration-150",
          isOver && "border-primary/35 bg-accent/70",
        )}
      >
        {deals.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground/80">
            {t.kanban.emptyColumn}
          </p>
        ) : (
          deals.map((deal) => <DraggableDealCard key={deal.id} deal={deal} />)
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  stages: Stage[];
  /** Backend kanban stages (aggregates + cards), post client-side filtering. */
  columns: KanbanStageColumn[];
}

export function KanbanBoard({ stages, columns }: KanbanBoardProps) {
  const moveDeal = useMoveDeal();
  const { data: settings } = useSettings();
  // Stage gate (spec 08): 422 opens the missing-fields dialog, then retries.
  const [gate, setGate] = React.useState<{
    dealId: string;
    stageId: string;
    missing: string[];
  } | null>(null);
  // Follow-up prompt after a successful move (spec 09.2).
  const [promptDealId, setPromptDealId] = React.useState<string | null>(null);
  const setNextContact = useSetNextContactFor();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const columnsByStage = React.useMemo(() => {
    const map = new Map<string, KanbanStageColumn>();
    for (const col of columns) map.set(col.stage_id, col);
    return map;
  }, [columns]);

  const requestMove = React.useCallback(
    (dealId: string, stageId: string) => {
      moveDeal.mutate(
        { dealId, stageId },
        {
          onSuccess: () => setPromptDealId(dealId),
          onError: (error) => {
            if (isStageGateError(error)) {
              setGate({ dealId, stageId, missing: gateMissingFields(error) });
            }
          },
        },
      );
    },
    [moveDeal],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const deal = active.data.current?.deal as DealCard | undefined;
    const targetStageId = String(over.id);
    if (!deal || deal.stage_id === targetStageId) return;

    const targetStage = stages.find((s) => s.id === targetStageId);
    if (targetStage?.is_won_stage) {
      // Business rule 2: entering the won stage requires the explicit
      // "mark as won" action (with final value confirmation).
      toast.info(t.kanban.movedToWonStage);
      return;
    }
    requestMove(deal.id, targetStageId);
  }

  return (
    <>
      {/* Desktop: horizontal drag-and-drop board */}
      <div className="hidden md:block">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="kanban-scroll flex gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <BoardColumn
                key={stage.id}
                stage={stage}
                column={columnsByStage.get(stage.id)}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {/* Mobile: stacked accordion per stage */}
      <div className="flex flex-col gap-3 md:hidden">
        {stages.map((stage) => {
          const column = columnsByStage.get(stage.id);
          const deals = column?.deals ?? [];
          return (
            <details
              key={stage.id}
              open={deals.length > 0}
              className="rounded-lg border bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3">
                <span className="flex items-baseline gap-1.5 text-[13px] font-semibold tracking-tight">
                  {stage.name}
                  <span className="tnum text-[11px] font-medium text-muted-foreground">
                    {deals.length}
                  </span>
                </span>
                <span className="tnum text-[11px] font-medium text-muted-foreground">
                  {formatCurrency(column?.sum_value ?? 0)}
                </span>
              </summary>
              <div className="flex flex-col gap-2 px-3 pb-3">
                {deals.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    {t.kanban.emptyColumn}
                  </p>
                ) : (
                  deals.map((deal) => (
                    <DealCardContent key={deal.id} deal={deal} />
                  ))
                )}
              </div>
            </details>
          );
        })}
      </div>

      {gate && (
        <MissingFieldsDialog
          dealId={gate.dealId}
          missingFields={gate.missing}
          open
          onOpenChange={(o) => {
            if (!o) setGate(null);
          }}
          onCompleted={() => {
            const pending = gate;
            setGate(null);
            requestMove(pending.dealId, pending.stageId);
          }}
        />
      )}

      <NextContactPrompt
        open={promptDealId !== null}
        onOpenChange={(o) => {
          if (!o) setPromptDealId(null);
        }}
        suggestedDays={cadencePreset(settings?.followup_cadence, 0)}
        onSelect={(iso) => {
          if (iso && promptDealId) {
            setNextContact.mutate({ dealId: promptDealId, nextContactAt: iso });
          }
          setPromptDealId(null);
        }}
      />
    </>
  );
}
