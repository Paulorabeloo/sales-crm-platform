"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api/client";
import {
  contactsApi,
  dealsApi,
  tasksApi,
  type CreateDealInput,
} from "@/lib/api/resources";
import type {
  Deal,
  DealCard,
  KanbanResponse,
  QuickLogKind,
} from "@/lib/api/types";
import { t } from "@/lib/strings";

/**
 * PATCH /deals returns DealOut WITHOUT the embedded contact, while the detail
 * cache holds DealDetailOut (with contact). Merge instead of replacing so the
 * detail page never loses `deal.contact` mid-render.
 */
function mergeDealCache(
  queryClient: ReturnType<typeof useQueryClient>,
  dealId: string,
  deal: Deal,
) {
  queryClient.setQueryData<Deal>(["deal", dealId], (old) =>
    old ? { ...old, ...deal, contact: deal.contact ?? old.contact } : undefined,
  );
}

function invalidateDeal(
  queryClient: ReturnType<typeof useQueryClient>,
  dealId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
  void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
  void queryClient.invalidateQueries({ queryKey: ["kanban"] });
  void queryClient.invalidateQueries({ queryKey: ["my-day"] });
}

/** 422 gate from PATCH /deals/{id}/stage and POST /deals/{id}/won. */
export function isStageGateError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && error.code === "stage_requirements_missing"
  );
}

/** Missing field keys carried by the stage gate 422. */
export function gateMissingFields(error: ApiError): string[] {
  const missing = error.extras.missing_fields;
  return Array.isArray(missing)
    ? missing.filter((k): k is string => typeof k === "string")
    : [];
}

/** Optimistic drag-and-drop between kanban stages, with rollback on error. */
export function useMoveDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      dealId,
      stageId,
      nextContactAt,
    }: {
      dealId: string;
      stageId: string;
      nextContactAt?: string;
    }) => dealsApi.move(dealId, stageId, nextContactAt),
    onMutate: async ({ dealId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ["kanban"] });
      const snapshots = queryClient.getQueriesData<KanbanResponse>({
        queryKey: ["kanban"],
      });
      queryClient.setQueriesData<KanbanResponse>(
        { queryKey: ["kanban"] },
        (old) => {
          if (!old) return old;
          let moved: DealCard | undefined;
          const stages = old.stages.map((col) => {
            const found = col.deals.find((d) => d.id === dealId);
            if (!found) return col;
            moved = found;
            return {
              ...col,
              deals: col.deals.filter((d) => d.id !== dealId),
              count: col.count - 1,
            };
          });
          if (!moved) return old;
          const movedDeal: DealCard = { ...moved, stage_id: stageId };
          const withTarget = stages.map((col) =>
            col.stage_id === stageId
              ? {
                  ...col,
                  deals: [movedDeal, ...col.deals],
                  count: col.count + 1,
                }
              : col,
          );
          return { ...old, stages: withTarget };
        },
      );
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      // The stage gate is handled by the caller (missing-fields dialog).
      if (isStageGateError(error)) return;
      toast.error(errorMessage(error) || t.kanban.moveError);
    },
    onSettled: (_data, _error, { dealId }) => {
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["my-day"] });
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDealInput) => dealsApi.create(input),
    onSuccess: () => {
      toast.success(t.createDeal.success);
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateDeal(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      dealsApi.update(dealId, body),
    onSuccess: (deal) => {
      mergeDealCache(queryClient, dealId, deal);
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useMarkWon(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value?: number | null) => dealsApi.markWon(dealId, value),
    onSuccess: () => {
      toast.success(t.deal.wonSuccess);
      invalidateDeal(queryClient, dealId);
    },
    onError: (error) => {
      // The stage gate is handled by the caller (missing-fields dialog).
      if (isStageGateError(error)) return;
      toast.error(errorMessage(error));
    },
  });
}

/** Quick log (POST /deals/{id}/log) — one-click contact outcome. */
export function useQuickLog(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      kind: QuickLogKind;
      note?: string;
      next_contact_at?: string;
      /** Catalog objection; only valid with kind=talked_objection (phase ). */
      objection_id?: string;
    }) => dealsApi.log(dealId, body),
    onSuccess: (_res, body) => {
      toast.success(t.quickLog.logged);
      // ["my-day"] is intentionally NOT invalidated here: the first quick log
      // registers the first contact, which takes the lead out of "respond
      // now" — refetching now would unmount the My Day row that hosts the
      // chained next-contact prompt. QuickLogActions invalidates ["my-day"]
      // when the prompt closes.
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      if (body.kind === "visit_scheduled") {
        // The backend also creates a "Visit" task on this deal.
        void queryClient.invalidateQueries({ queryKey: ["deal-tasks", dealId] });
        void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/**
 * Variant with the deal id in the mutation variables — for callers where the
 * target deal changes at runtime (e.g. the kanban board prompt), so the id is
 * not read from stale hook state.
 */
export function useSetNextContactFor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      dealId,
      nextContactAt,
    }: {
      dealId: string;
      nextContactAt: string | null;
    }) => dealsApi.update(dealId, { next_contact_at: nextContactAt }),
    onSuccess: (deal, { dealId }) => {
      toast.success(t.nextContact.saved);
      mergeDealCache(queryClient, dealId, deal);
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["my-day"] });
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Sets/clears deals.next_contact_at (PATCH sends null to clear). */
export function useSetNextContact(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nextContactAt: string | null) =>
      dealsApi.update(dealId, { next_contact_at: nextContactAt }),
    onSuccess: (deal) => {
      toast.success(t.nextContact.saved);
      mergeDealCache(queryClient, dealId, deal);
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["my-day"] });
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useMarkLost(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      lostReasonId,
      lostNotes,
    }: {
      lostReasonId: string;
      lostNotes?: string;
    }) => dealsApi.markLost(dealId, lostReasonId, lostNotes),
    onSuccess: () => {
      toast.success(t.deal.lostSuccess);
      invalidateDeal(queryClient, dealId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/**
 * Rescue action (phase ): creates a NEW deal in the active cycle from a lost
 * one. Returns the new deal so the caller can link to it in the toast.
 */
export function useReopenInCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dealId: string) => dealsApi.reopenInCycle(dealId),
    onSuccess: (_newDeal, oldDealId) => {
      void queryClient.invalidateQueries({ queryKey: ["recoverable-deals"] });
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["my-day"] });
      void queryClient.invalidateQueries({ queryKey: ["deal", oldDealId] });
      void queryClient.invalidateQueries({
        queryKey: ["activities", oldDealId],
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useReopenDeal(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dealsApi.reopen(dealId),
    onSuccess: () => invalidateDeal(queryClient, dealId),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useRegisterFirstContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dealId: string) => dealsApi.registerFirstContact(dealId),
    onSuccess: (_deal, dealId) => {
      toast.success(t.deal.firstContactSuccess);
      invalidateDeal(queryClient, dealId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useClaimDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dealId: string) => dealsApi.claim(dealId),
    onSuccess: (_deal, dealId) => {
      toast.success(t.kanban.claimed);
      invalidateDeal(queryClient, dealId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useAddNote(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => dealsApi.addNote(dealId, body),
    onSuccess: () => {
      toast.success(t.deal.noteAdded);
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCreateTask(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; due_date: string }) =>
      tasksApi.create({ deal_id: dealId, ...input }),
    onSuccess: () => {
      toast.success(t.tasks.created);
      void queryClient.invalidateQueries({ queryKey: ["deal-tasks", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useToggleTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, isDone }: { taskId: string; isDone: boolean }) =>
      tasksApi.update(taskId, { is_done: isDone }),
    onSuccess: (task) => {
      if (task.is_done) toast.success(t.tasks.completed);
      void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["deal-tasks", task.deal_id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["activities", task.deal_id],
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof contactsApi.create>[0]) =>
      contactsApi.create(input),
    onSuccess: () => {
      toast.success(t.contacts.created);
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof contactsApi.update>[1];
    }) => contactsApi.update(id, body),
    onSuccess: () => {
      toast.success(t.contacts.updated);
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
