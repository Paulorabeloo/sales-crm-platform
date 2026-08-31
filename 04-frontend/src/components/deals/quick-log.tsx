"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  Lightbulb,
  MessageSquareText,
  PhoneMissed,
  ThumbsUp,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { NextContactPrompt } from "@/components/deals/next-contact-prompt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useQuickLog, useSetNextContact } from "@/hooks/mutations";
import { useObjections, useSettings } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { dealsApi } from "@/lib/api/resources";
import type { QuickLogKind, QuickLogResponse } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cadencePreset, dateToContactISO, todayISO } from "@/lib/utils";

const KIND_META: {
  kind: QuickLogKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "attempt_no_answer", label: t.quickLog.noAnswer, icon: PhoneMissed },
  { kind: "talked_advance", label: t.quickLog.talkedAdvance, icon: ThumbsUp },
  {
    kind: "talked_objection",
    label: t.quickLog.talkedObjection,
    icon: ShieldAlert,
  },
  {
    kind: "visit_scheduled",
    label: t.quickLog.visitScheduled,
    icon: CalendarCheck,
  },
];

interface QuickLogActionsProps {
  dealId: string;
  /** Compact dropdown (kanban card) instead of the button row (detail). */
  asMenu?: boolean;
}

/**
 * One-click contact logging: 4 outcomes -> POST /deals/{id}/log,
 * chained with the next-contact prompt (cadence-preselected, the spec/09.3).
 * "Conversou, com objeção" opens the catalog select first (phase ) and sends
 * objection_id with the log.
 */
export function QuickLogActions({ dealId, asMenu = false }: QuickLogActionsProps) {
  const queryClient = useQueryClient();
  const quickLog = useQuickLog(dealId);
  const setNextContact = useSetNextContact(dealId);
  const { data: settings } = useSettings();

  // Deferred from useQuickLog: refetching My Day mid-flow would unmount the
  // row hosting the chained prompt (the first quick log registers the first
  // contact and removes the lead from "respond now").
  const invalidateMyDay = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["my-day"] });
  }, [queryClient]);

  const [visitOpen, setVisitOpen] = React.useState(false);
  const [visitDate, setVisitDate] = React.useState("");
  const [objectionOpen, setObjectionOpen] = React.useState(false);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [suggestedDays, setSuggestedDays] = React.useState<number | null>(null);

  function start(kind: QuickLogKind) {
    if (kind === "visit_scheduled") {
      setVisitDate("");
      setVisitOpen(true);
      return;
    }
    if (kind === "talked_objection") {
      // phase : pick the objection BEFORE logging (objection_id in the log).
      setObjectionOpen(true);
      return;
    }
    quickLog.mutate(
      { kind },
      {
        onSuccess: (res) => {
          setSuggestedDays(
            cadencePreset(settings?.followup_cadence, res.attempts_count),
          );
          setPromptOpen(true);
        },
      },
    );
  }

  function confirmVisit() {
    if (!visitDate) return;
    quickLog.mutate(
      { kind: "visit_scheduled", next_contact_at: dateToContactISO(visitDate) },
      {
        onSuccess: () => {
          setVisitOpen(false);
          invalidateMyDay(); // no chained prompt on the visit path
        },
      },
    );
  }

  return (
    <>
      {asMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              aria-label={t.quickLog.trigger}
            >
              <MessageSquareText className="size-3" />
              {t.quickLog.trigger}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t.quickLog.trigger}</DropdownMenuLabel>
            {KIND_META.map(({ kind, label, icon: Icon }) => (
              <DropdownMenuItem key={kind} onSelect={() => start(kind)}>
                <Icon className="text-muted-foreground" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_META.map(({ kind, label, icon: Icon }) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              disabled={quickLog.isPending}
              onClick={() => start(kind)}
            >
              <Icon className="size-3.5 text-muted-foreground" />
              {label}
            </Button>
          ))}
        </div>
      )}

      {/* Visit date (required by the backend for visit_scheduled) */}
      <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.quickLog.visitTitle}</DialogTitle>
            <DialogDescription>{t.quickLog.visitDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visit-date">{t.quickLog.visitDate}</Label>
            <Input
              id="visit-date"
              type="date"
              min={todayISO()}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVisitOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={!visitDate || quickLog.isPending}
              onClick={confirmVisit}
            >
              {quickLog.isPending ? t.common.saving : t.quickLog.visitConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Objection catalog select (phase ) — logs talked_objection itself. */}
      <ObjectionDialog
        dealId={dealId}
        open={objectionOpen}
        onOpenChange={setObjectionOpen}
        onLogged={(res) => {
          setSuggestedDays(
            cadencePreset(settings?.followup_cadence, res.attempts_count),
          );
          setPromptOpen(true);
        }}
      />

      <NextContactPrompt
        open={promptOpen}
        onOpenChange={(open) => {
          setPromptOpen(open);
          if (!open) invalidateMyDay();
        }}
        suggestedDays={suggestedDays}
        onSelect={(iso) => {
          if (iso) setNextContact.mutate(iso);
        }}
      />
    </>
  );
}

const OTHER = "__other__";

/**
 * "Conversou, com objeção" dialog (phase ): select from the objections
 * catalog (log carries objection_id and the rebuttal shows inline as
 * coaching) or describe a free-text objection (kept in
 * enrollment_data.main_objection, as before).
 */
function ObjectionDialog({
  dealId,
  open,
  onOpenChange,
  onLogged,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: (res: QuickLogResponse) => void;
}) {
  const queryClient = useQueryClient();
  const { data: objections } = useObjections();
  const [selection, setSelection] = React.useState("");
  const [freeText, setFreeText] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSelection("");
      setFreeText("");
    }
  }, [open]);

  const selected = (objections ?? []).find((o) => o.id === selection) ?? null;
  const isOther = selection === OTHER;
  const canSave = isOther ? freeText.trim() !== "" : !!selected;

  const save = useMutation({
    mutationFn: async (): Promise<QuickLogResponse> => {
      const res = await dealsApi.log(dealId, {
        kind: "talked_objection",
        ...(selected ? { objection_id: selected.id } : {}),
      });
      if (isOther && freeText.trim()) {
        // Merge over the fresh deal so no other enrollment field is lost.
        const deal = await dealsApi.get(dealId);
        await dealsApi.update(dealId, {
          enrollment_data: {
            ...(deal.enrollment_data ?? {}),
            main_objection: freeText.trim(),
          },
        });
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(t.quickLog.objectionSaved);
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      // ["my-day"] is invalidated by the chained prompt's close handler (see
      // QuickLogActions) so the hosting My Day row survives until then.
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
      onOpenChange(false);
      onLogged(res);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.quickLog.objectionTitle}</DialogTitle>
          <DialogDescription>
            {t.quickLog.objectionDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={selection} onValueChange={setSelection}>
            <SelectTrigger aria-label={t.quickLog.objectionSelectLabel}>
              <SelectValue
                placeholder={t.quickLog.objectionSelectPlaceholder}
              />
            </SelectTrigger>
            <SelectContent>
              {(objections ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
              <SelectItem value={OTHER}>{t.quickLog.objectionOther}</SelectItem>
            </SelectContent>
          </Select>

          {selected && (
            <div className="flex flex-col gap-1 rounded-lg bg-accent/50 px-3 py-2.5 dark:bg-accent/30">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-accent-foreground">
                <Lightbulb className="size-3.5" />
                {t.objection.rebuttalTitle}
              </p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                {selected.rebuttal}
              </p>
            </div>
          )}

          {isOther && (
            <Textarea
              value={freeText}
              placeholder={t.quickLog.objectionPlaceholder}
              aria-label={t.quickLog.objectionOther}
              onChange={(e) => setFreeText(e.target.value)}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t.common.saving : t.quickLog.objectionSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
