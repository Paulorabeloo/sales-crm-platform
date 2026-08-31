"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
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
import { Switch } from "@/components/ui/switch";
import { useCycles, useUnits, useUsers } from "@/hooks/queries";
import type { Pipeline } from "@/lib/api/types";
import { t } from "@/lib/strings";

const ALL = "__all__";

export interface KanbanFilterState {
  pipeline_id: string;
  owner_id: string;
  status: string;
  unit_id: string;
  /** "" while the active cycle loads; ALL = every cycle; otherwise a cycle id. */
  cycle_id: string;
  cooling: boolean;
  noNextStep: boolean;
  search: string;
}

interface FiltersBarProps {
  pipelines: Pipeline[];
  filters: KanbanFilterState;
  onChange: (next: KanbanFilterState) => void;
  /** Default cycle (the active one) — "clear filters" resets back to it. */
  defaultCycleId?: string;
}

export function FiltersBar({
  pipelines,
  filters,
  onChange,
  defaultCycleId,
}: FiltersBarProps) {
  const { isAdmin } = useAuth();
  const { data: units } = useUnits();
  const { data: users } = useUsers(isAdmin);
  const { data: cycles } = useCycles();
  const [searchDraft, setSearchDraft] = React.useState(filters.search);

  React.useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  // Debounce search typing
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (searchDraft !== filters.search) {
        onChange({ ...filters, search: searchDraft });
      }
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const cycleDefault = defaultCycleId ?? ALL;
  const hasActiveFilters =
    filters.owner_id !== ALL ||
    filters.status !== ALL ||
    filters.unit_id !== ALL ||
    (filters.cycle_id !== "" && filters.cycle_id !== cycleDefault) ||
    filters.cooling ||
    filters.noNextStep ||
    filters.search !== "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          {t.kanban.filters.pipeline}
        </Label>
        <Select
          value={filters.pipeline_id}
          onValueChange={(v) => onChange({ ...filters, pipeline_id: v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isAdmin && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t.kanban.filters.owner}
          </Label>
          <Select
            value={filters.owner_id}
            onValueChange={(v) => onChange({ ...filters, owner_id: v })}
          >
            <SelectTrigger className="w-40">
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
      )}

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          {t.cycle.filterLabel}
        </Label>
        <Select
          value={filters.cycle_id || cycleDefault}
          onValueChange={(v) => onChange({ ...filters, cycle_id: v })}
        >
          <SelectTrigger className="w-40">
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
          {t.kanban.filters.status}
        </Label>
        <Select
          value={filters.status}
          onValueChange={(v) => onChange({ ...filters, status: v })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.common.all}</SelectItem>
            <SelectItem value="open">{t.status.open}</SelectItem>
            <SelectItem value="won">{t.status.won}</SelectItem>
            <SelectItem value="lost">{t.status.lost}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          {t.kanban.filters.unit}
        </Label>
        <Select
          value={filters.unit_id}
          onValueChange={(v) => onChange({ ...filters, unit_id: v })}
        >
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

      <div className="flex h-9 items-center gap-2">
        <Switch
          id="cooling-filter"
          checked={filters.cooling}
          onCheckedChange={(v) => onChange({ ...filters, cooling: v })}
        />
        <Label htmlFor="cooling-filter" className="text-sm">
          {t.kanban.filters.cooling}
        </Label>
      </div>

      <div className="flex h-9 items-center gap-2">
        <Switch
          id="no-next-step-filter"
          checked={filters.noNextStep}
          onCheckedChange={(v) => onChange({ ...filters, noNextStep: v })}
        />
        <Label htmlFor="no-next-step-filter" className="text-sm">
          {t.kanban.filters.noNextStep}
        </Label>
      </div>

      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={t.kanban.filters.searchPlaceholder}
          className="pl-8"
          aria-label={t.common.search}
        />
      </div>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...filters,
              owner_id: ALL,
              status: ALL,
              unit_id: ALL,
              cycle_id: cycleDefault,
              cooling: false,
              noNextStep: false,
              search: "",
            })
          }
        >
          <X className="size-4" />
          {t.kanban.filters.clear}
        </Button>
      )}
    </div>
  );
}

export { ALL as FILTER_ALL };
