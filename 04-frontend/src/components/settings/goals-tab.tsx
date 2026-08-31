"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useCycles,
  useGoals,
  useUnits,
  useUsers,
} from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { goalsApi } from "@/lib/api/resources";
import type { Goal, GoalScope } from "@/lib/api/types";
import { t } from "@/lib/strings";

function useInvalidateGoals() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["goals"] });
    void queryClient.invalidateQueries({ queryKey: ["goal-progress"] });
    void queryClient.invalidateQueries({ queryKey: ["my-goal-progress"] });
  }, [queryClient]);
}

/** Inline target editor (PATCH only touches target_count). */
function TargetCell({ goal }: { goal: Goal }) {
  const [value, setValue] = React.useState(String(goal.target_count));
  const invalidate = useInvalidateGoals();

  React.useEffect(() => setValue(String(goal.target_count)), [goal.target_count]);

  const update = useMutation({
    mutationFn: (target: number) => goalsApi.update(goal.id, target),
    onSuccess: () => {
      toast.success(t.settings.goals.updated);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function save() {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setValue(String(goal.target_count));
      return;
    }
    if (parsed !== goal.target_count) update.mutate(parsed);
  }

  return (
    <Input
      type="number"
      min={1}
      value={value}
      aria-label={t.settings.goals.target}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="tnum w-24 text-right"
    />
  );
}

export function GoalsTab() {
  const cyclesQuery = useCycles();
  const cycles = React.useMemo(
    () => cyclesQuery.data ?? [],
    [cyclesQuery.data],
  );
  const activeCycle = cycles.find((c) => c.is_active);
  const [cycleId, setCycleId] = React.useState("");

  React.useEffect(() => {
    if (!cycleId && cycles.length > 0) {
      setCycleId((activeCycle ?? cycles[0]).id);
    }
  }, [cycleId, cycles, activeCycle]);

  const goalsQuery = useGoals(cycleId || undefined);
  const { data: users } = useUsers();
  const { data: units } = useUnits();
  const invalidate = useInvalidateGoals();

  const [scope, setScope] = React.useState<GoalScope>("consultant");
  const [targetUserId, setTargetUserId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [target, setTarget] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      goalsApi.create({
        cycle_id: cycleId,
        scope,
        ...(scope === "consultant"
          ? { target_user_id: targetUserId }
          : { unit_id: unitId }),
        target_count: Number(target),
      }),
    onSuccess: () => {
      toast.success(t.settings.goals.created);
      setTarget("");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => goalsApi.remove(id),
    onSuccess: () => {
      toast.success(t.settings.goals.deleted);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const userName = (id: string | null) =>
    (users ?? []).find((u) => u.id === id)?.name ?? t.common.none;
  const unitName = (id: string | null) =>
    (units ?? []).find((u) => u.id === id)?.name ?? t.common.none;

  if (cyclesQuery.isLoading) return <LoadingState />;
  if (cyclesQuery.isError)
    return (
      <ErrorState
        message={errorMessage(cyclesQuery.error)}
        onRetry={() => void cyclesQuery.refetch()}
      />
    );

  const goals = goalsQuery.data ?? [];
  const parsedTarget = Number(target);
  const canCreate =
    !!cycleId &&
    Number.isInteger(parsedTarget) &&
    parsedTarget >= 1 &&
    (scope === "consultant" ? !!targetUserId : !!unitId);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.goals.subtitle}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>{t.settings.goals.cycle}</Label>
        <Select value={cycleId} onValueChange={setCycleId}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cycles.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? ` (${t.settings.cycles.activeBadge})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label>{t.settings.goals.scope}</Label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as GoalScope)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consultant">
                {t.settings.goals.scopeConsultant}
              </SelectItem>
              <SelectItem value="unit">{t.settings.goals.scopeUnit}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "consultant" ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t.settings.goals.scopeConsultant}</Label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>{t.settings.goals.scopeUnit}</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(units ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-target">{t.settings.goals.target}</Label>
          <Input
            id="goal-target"
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-28"
          />
        </div>
        <Button
          disabled={!canCreate || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.goals.add}
        </Button>
      </div>

      {goalsQuery.isLoading ? (
        <LoadingState />
      ) : goals.length === 0 ? (
        <EmptyState message={t.settings.goals.empty} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.settings.goals.scope}</TableHead>
                <TableHead>{t.reports.goals.who}</TableHead>
                <TableHead className="text-right">
                  {t.settings.goals.target}
                </TableHead>
                <TableHead className="text-right">
                  {t.common.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goals.map((goal) => (
                <TableRow key={goal.id}>
                  <TableCell>
                    <Badge variant="secondary">
                      {goal.scope === "consultant"
                        ? t.settings.goals.scopeConsultant
                        : t.settings.goals.scopeUnit}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {goal.scope === "consultant"
                      ? userName(goal.target_user_id)
                      : unitName(goal.unit_id)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <TargetCell goal={goal} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t.common.remove}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(goal.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
