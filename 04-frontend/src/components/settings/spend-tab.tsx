"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
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
import { queryKeys, useCampaignSpend, useUnits } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { campaignSpendApi } from "@/lib/api/resources";
import type { CampaignSpend } from "@/lib/api/types";
import { formatCurrencyInput, parseCurrencyInput } from "@/lib/currency";
import { t } from "@/lib/strings";

const NONE = "__none__";

/** "2026-08-01" -> "08/2026" for the table. */
function formatMonth(monthISO: string): string {
  const [year, month] = monthISO.split("-");
  return month && year ? `${month}/${year}` : monthISO;
}

/** Current month as the `<input type="month">` value (YYYY-MM, local). */
function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function useInvalidateSpend() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.campaignSpend });
    void queryClient.invalidateQueries({ queryKey: ["report-cac"] });
    void queryClient.invalidateQueries({ queryKey: ["report-summary"] });
  }, [queryClient]);
}

/** Inline amount editor (PATCH only touches the amount, per the contract). */
function AmountCell({ spend }: { spend: CampaignSpend }) {
  const [value, setValue] = React.useState(formatCurrencyInput(spend.amount));
  const invalidate = useInvalidateSpend();

  React.useEffect(() => {
    setValue(formatCurrencyInput(spend.amount));
  }, [spend.amount]);

  const update = useMutation({
    mutationFn: (amount: number) => campaignSpendApi.update(spend.id, amount),
    onSuccess: () => {
      toast.success(t.settings.spend.updated);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function save() {
    const parsed = parseCurrencyInput(value);
    if (parsed === null || parsed < 0) {
      setValue(formatCurrencyInput(spend.amount));
      return;
    }
    if (formatCurrencyInput(parsed) !== formatCurrencyInput(spend.amount)) {
      update.mutate(parsed);
    }
  }

  return (
    <Input
      value={value}
      inputMode="decimal"
      aria-label={t.settings.spend.amount}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="tnum w-28 text-right"
    />
  );
}

function SpendRow({
  spend,
  unitName,
}: {
  spend: CampaignSpend;
  unitName: (id: string | null) => string;
}) {
  const invalidate = useInvalidateSpend();
  const remove = useMutation({
    mutationFn: () => campaignSpendApi.remove(spend.id),
    onSuccess: () => {
      toast.success(t.settings.spend.deleted);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <TableRow>
      <TableCell className="tnum font-medium">
        {formatMonth(spend.month)}
      </TableCell>
      <TableCell>{spend.source}</TableCell>
      <TableCell className="text-muted-foreground">
        {spend.campaign ?? t.common.none}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {unitName(spend.unit_id)}
      </TableCell>
      <TableCell className="text-right">
        <AmountCell spend={spend} />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label={t.common.remove}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function SpendTab() {
  const spendQuery = useCampaignSpend();
  const { data: units } = useUnits();
  const invalidate = useInvalidateSpend();

  const [month, setMonth] = React.useState(currentMonthValue());
  const [source, setSource] = React.useState("");
  const [campaign, setCampaign] = React.useState("");
  const [unitId, setUnitId] = React.useState(NONE);
  const [amount, setAmount] = React.useState("");

  const create = useMutation({
    mutationFn: () => {
      const parsed = parseCurrencyInput(amount);
      return campaignSpendApi.create({
        month: `${month}-01`,
        source: source.trim(),
        campaign: campaign.trim() || null,
        unit_id: unitId === NONE ? null : unitId,
        amount: parsed ?? 0,
      });
    },
    onSuccess: () => {
      toast.success(t.settings.spend.created);
      setSource("");
      setCampaign("");
      setAmount("");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unitName = React.useCallback(
    (id: string | null) =>
      id
        ? ((units ?? []).find((u) => u.id === id)?.name ?? t.common.none)
        : t.settings.spend.allUnits,
    [units],
  );

  if (spendQuery.isLoading) return <LoadingState />;
  if (spendQuery.isError)
    return (
      <ErrorState
        message={errorMessage(spendQuery.error)}
        onRetry={() => void spendQuery.refetch()}
      />
    );

  const rows = spendQuery.data ?? [];
  const parsedAmount = parseCurrencyInput(amount);
  const canCreate =
    !!month && !!source.trim() && parsedAmount !== null && parsedAmount >= 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.spend.subtitle}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-month">{t.settings.spend.month}</Label>
          <Input
            id="spend-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-source">{t.settings.spend.source}</Label>
          <Input
            id="spend-source"
            value={source}
            placeholder={t.settings.spend.sourcePlaceholder}
            onChange={(e) => setSource(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-campaign">
            {t.settings.spend.campaign} ({t.common.optional})
          </Label>
          <Input
            id="spend-campaign"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t.settings.spend.unit}</Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t.settings.spend.allUnits}</SelectItem>
              {(units ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-amount">{t.settings.spend.amount}</Label>
          <Input
            id="spend-amount"
            value={amount}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => setAmount(e.target.value)}
            className="w-28"
          />
        </div>
        <Button
          disabled={!canCreate || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.spend.add}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message={t.settings.spend.empty} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.settings.spend.month}</TableHead>
                <TableHead>{t.settings.spend.source}</TableHead>
                <TableHead>{t.settings.spend.campaign}</TableHead>
                <TableHead>{t.settings.spend.unit}</TableHead>
                <TableHead className="text-right">
                  {t.settings.spend.amount}
                </TableHead>
                <TableHead className="text-right">
                  {t.common.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((spend) => (
                <SpendRow key={spend.id} spend={spend} unitName={unitName} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
