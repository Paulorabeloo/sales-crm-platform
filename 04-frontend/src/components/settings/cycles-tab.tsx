"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys, useCycles } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { cyclesApi, dealsApi } from "@/lib/api/resources";
import type { Cycle } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { todayISO } from "@/lib/utils";

function useInvalidateCycles() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cycles });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activeCycle });
    void queryClient.invalidateQueries({ queryKey: ["kanban"] });
    void queryClient.invalidateQueries({ queryKey: ["recoverable-deals"] });
    void queryClient.invalidateQueries({ queryKey: ["goal-progress"] });
    void queryClient.invalidateQueries({ queryKey: ["my-goal-progress"] });
  }, [queryClient]);
}

/** Confirmation before activating a cycle (deactivates the current one). */
function ActivateCycleDialog({ cycle }: { cycle: Cycle }) {
  const [open, setOpen] = React.useState(false);
  const invalidate = useInvalidateCycles();

  const activate = useMutation({
    mutationFn: () => cyclesApi.activate(cycle.id),
    onSuccess: () => {
      toast.success(t.settings.cycles.activated);
      invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-3.5" />
        {t.settings.cycles.activate}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t.settings.cycles.activateTitle(cycle.name)}
          </DialogTitle>
          <DialogDescription>
            {t.settings.cycles.activateWarning}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
          >
            {activate.isPending ? t.common.saving : t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rollover confirmation showing how many open deals will be moved. */
function RolloverDialog({
  cycle,
  activeCycleName,
}: {
  cycle: Cycle;
  activeCycleName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const invalidate = useInvalidateCycles();

  const countQuery = useQuery({
    queryKey: ["cycle-open-count", cycle.id] as const,
    queryFn: () => dealsApi.countOpenInCycle(cycle.id),
    enabled: open,
  });

  const rollover = useMutation({
    mutationFn: () => cyclesApi.rollover(cycle.id),
    onSuccess: (res) => {
      toast.success(t.settings.cycles.rolloverDone(res.moved_count));
      invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const count = countQuery.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <ArrowRightLeft className="size-3.5" />
        {t.settings.cycles.rollover}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t.settings.cycles.rolloverTitle(cycle.name)}
          </DialogTitle>
          <DialogDescription>
            {countQuery.isLoading || count === undefined
              ? t.common.loading
              : count === 0
                ? t.settings.cycles.rolloverNone
                : t.settings.cycles.rolloverDescription(
                    count,
                    activeCycleName,
                  )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={!count || rollover.isPending}
            onClick={() => rollover.mutate()}
          >
            {rollover.isPending ? t.common.saving : t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CycleRow({
  cycle,
  activeCycleName,
}: {
  cycle: Cycle;
  activeCycleName: string | null;
}) {
  const [name, setName] = React.useState(cycle.name);
  const invalidate = useInvalidateCycles();

  React.useEffect(() => setName(cycle.name), [cycle.name]);

  const update = useMutation({
    mutationFn: (body: {
      name?: string;
      starts_on?: string;
      deadline_on?: string | null;
    }) => cyclesApi.update(cycle.id, body),
    onSuccess: () => {
      toast.success(t.settings.cycles.updated);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => cyclesApi.remove(cycle.id),
    onSuccess: () => {
      toast.success(t.settings.cycles.deleted);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            aria-label={t.settings.cycles.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== cycle.name)
                update.mutate({ name: trimmed });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="max-w-36"
          />
          {cycle.is_active && (
            <Badge variant="success">{t.settings.cycles.activeBadge}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Input
          type="date"
          defaultValue={cycle.starts_on}
          aria-label={t.settings.cycles.startsOn}
          onBlur={(e) => {
            const v = e.target.value;
            if (v && v !== cycle.starts_on) update.mutate({ starts_on: v });
          }}
          className="w-36"
        />
      </TableCell>
      <TableCell>
        <Input
          type="date"
          defaultValue={cycle.deadline_on ?? ""}
          aria-label={t.settings.cycles.deadlineOn}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (cycle.deadline_on ?? ""))
              update.mutate({ deadline_on: v || null });
          }}
          className="w-36"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {!cycle.is_active && <ActivateCycleDialog cycle={cycle} />}
          {!cycle.is_active && activeCycleName && (
            <RolloverDialog cycle={cycle} activeCycleName={activeCycleName} />
          )}
          {!cycle.is_active && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t.common.remove}
              title={t.settings.cycles.deleteHint}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CyclesTab() {
  const cyclesQuery = useCycles();
  const invalidate = useInvalidateCycles();
  const [newName, setNewName] = React.useState("");
  const [newStart, setNewStart] = React.useState(todayISO());
  const [newDeadline, setNewDeadline] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      cyclesApi.create({
        name: newName.trim(),
        starts_on: newStart,
        deadline_on: newDeadline || null,
      }),
    onSuccess: () => {
      toast.success(t.settings.cycles.created);
      setNewName("");
      setNewDeadline("");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (cyclesQuery.isLoading) return <LoadingState />;
  if (cyclesQuery.isError)
    return (
      <ErrorState
        message={errorMessage(cyclesQuery.error)}
        onRetry={() => void cyclesQuery.refetch()}
      />
    );

  const cycles = cyclesQuery.data ?? [];
  const activeCycleName = cycles.find((c) => c.is_active)?.name ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.cycles.subtitle}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cycle-name">{t.settings.cycles.name}</Label>
          <Input
            id="new-cycle-name"
            value={newName}
            placeholder={t.settings.cycles.namePlaceholder}
            onChange={(e) => setNewName(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cycle-start">{t.settings.cycles.startsOn}</Label>
          <Input
            id="new-cycle-start"
            type="date"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cycle-deadline">
            {t.settings.cycles.deadlineOn} ({t.common.optional})
          </Label>
          <Input
            id="new-cycle-deadline"
            type="date"
            value={newDeadline}
            onChange={(e) => setNewDeadline(e.target.value)}
            className="w-40"
          />
        </div>
        <Button
          disabled={!newName.trim() || !newStart || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.cycles.newCycle}
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.settings.cycles.name}</TableHead>
              <TableHead>{t.settings.cycles.startsOn}</TableHead>
              <TableHead>{t.settings.cycles.deadlineOn}</TableHead>
              <TableHead className="text-right">{t.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycles.map((cycle) => (
              <CycleRow
                key={cycle.id}
                cycle={cycle}
                activeCycleName={activeCycleName}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
