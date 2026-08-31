"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MissingFieldsDialog } from "@/components/deals/missing-fields-dialog";
import {
  gateMissingFields,
  isStageGateError,
  useMarkLost,
  useMarkWon,
} from "@/hooks/mutations";
import { useLostReasons } from "@/hooks/queries";
import type { Deal } from "@/lib/api/types";
import { formatCurrencyInput, parseCurrencyInput } from "@/lib/currency";
import { t } from "@/lib/strings";
import { num } from "@/lib/utils";

export function MarkWonDialog({ deal }: { deal: Deal }) {
  const [open, setOpen] = React.useState(false);
  // B1 fix: prefill in pt-BR ("500,00") and parse with the shared helper so
  // confirming the API value never multiplies it by 100.
  const [value, setValue] = React.useState(formatCurrencyInput(deal.value));
  const [gateFields, setGateFields] = React.useState<string[] | null>(null);
  const markWon = useMarkWon(deal.id);

  React.useEffect(() => {
    if (open) setValue(formatCurrencyInput(deal.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function confirm() {
    const parsed = parseCurrencyInput(value);
    markWon.mutate(parsed !== null ? parsed : num(deal.value), {
      onSuccess: () => setOpen(false),
      onError: (error) => {
        if (isStageGateError(error)) setGateFields(gateMissingFields(error));
      },
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="success" size="sm">
            <CheckCircle2 className="size-4" />
            {t.deal.markWon}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deal.wonDialogTitle}</DialogTitle>
            <DialogDescription>{t.deal.wonDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="won-value">{t.deal.value}</Label>
            <Input
              id="won-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="success"
              disabled={markWon.isPending}
              onClick={confirm}
            >
              {markWon.isPending ? t.common.saving : t.deal.wonConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage gate: fill the missing fields, then retry the won. */}
      <MissingFieldsDialog
        dealId={deal.id}
        missingFields={gateFields ?? []}
        open={gateFields !== null}
        onOpenChange={(o) => {
          if (!o) setGateFields(null);
        }}
        onCompleted={confirm}
        wonContext
      />
    </>
  );
}

export function MarkLostDialog({ deal }: { deal: Deal }) {
  const [open, setOpen] = React.useState(false);
  const [reasonId, setReasonId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const { data: reasons } = useLostReasons();
  const markLost = useMarkLost(deal.id);

  function confirm() {
    setTouched(true);
    if (!reasonId) return;
    markLost.mutate(
      { lostReasonId: reasonId, lostNotes: notes || undefined },
      { onSuccess: () => setOpen(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:border-destructive/40 hover:bg-destructive/[0.06] hover:text-destructive"
        >
          <XCircle className="size-4" />
          {t.deal.markLost}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.deal.lostDialogTitle}</DialogTitle>
          <DialogDescription>{t.deal.lostDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.deal.lostReason}</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger>
                <SelectValue placeholder={t.deal.lostReasonPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {(reasons ?? [])
                  .filter((r) => r.is_active)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {touched && !reasonId && (
              <p className="text-xs text-destructive">
                {t.errors.byCode.lost_reason_required}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-notes">{t.deal.lostNotes}</Label>
            <Textarea
              id="lost-notes"
              placeholder={t.deal.lostNotesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={markLost.isPending}
            onClick={confirm}
          >
            {markLost.isPending ? t.common.saving : t.deal.lostConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
