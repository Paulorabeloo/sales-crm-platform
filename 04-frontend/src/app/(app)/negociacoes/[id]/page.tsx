"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Flame, RotateCcw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { ClosingChecklist } from "@/components/deals/closing-checklist";
import { DealFieldsCard } from "@/components/deals/deal-fields-card";
import { DealObjectionCard } from "@/components/deals/objection-card";
import { DealTasks } from "@/components/deals/deal-tasks";
import { EnrollmentForm } from "@/components/deals/enrollment-form";
import { FirstContactButton } from "@/components/deals/first-contact-button";
import { MissingFieldsDialog } from "@/components/deals/missing-fields-dialog";
import { NextContactPrompt } from "@/components/deals/next-contact-prompt";
import { NextStepBadge } from "@/components/deals/next-step-badge";
import { QuickLogActions } from "@/components/deals/quick-log";
import { StageGuide } from "@/components/deals/stage-guide";
import { Timeline } from "@/components/deals/timeline";
import { WhatsAppButton } from "@/components/deals/whatsapp-button";
import {
  MarkLostDialog,
  MarkWonDialog,
} from "@/components/deals/won-lost-dialogs";
import { isCooling, statusVariant } from "@/components/kanban/deal-card";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  gateMissingFields,
  isStageGateError,
  useMoveDeal,
  useReopenDeal,
  useSetNextContact,
} from "@/hooks/mutations";
import {
  useDeal,
  usePipelines,
  useSettings,
  useUnits,
  useUsers,
} from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { t } from "@/lib/strings";
import { cadencePreset, daysSince, formatDateTime } from "@/lib/utils";

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;
  const { isAdmin, user } = useAuth();

  const dealQuery = useDeal(dealId);
  const settingsQuery = useSettings();
  const coolingDays = settingsQuery.data?.cooling_days ?? 3;
  const { data: users } = useUsers(isAdmin);
  const { data: units } = useUnits();
  const { data: pipelines } = usePipelines();
  const reopen = useReopenDeal(dealId);
  const moveDeal = useMoveDeal();
  const setNextContact = useSetNextContact(dealId);

  // Stage gate + follow-up prompt state (specs 08 / 09.2).
  const [gate, setGate] = React.useState<{
    stageId: string;
    missing: string[];
  } | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);

  const requestMove = React.useCallback(
    (stageId: string) => {
      moveDeal.mutate(
        { dealId, stageId },
        {
          onSuccess: () => setPromptOpen(true),
          onError: (error) => {
            if (isStageGateError(error)) {
              setGate({ stageId, missing: gateMissingFields(error) });
            }
          },
        },
      );
    },
    [moveDeal, dealId],
  );

  if (dealQuery.isLoading) return <LoadingState />;
  if (dealQuery.isError || !dealQuery.data) {
    return (
      <ErrorState
        message={
          dealQuery.error ? errorMessage(dealQuery.error) : t.deal.notFound
        }
        onRetry={() => void dealQuery.refetch()}
      />
    );
  }

  const deal = dealQuery.data;
  const cooling = isCooling(deal, coolingDays);
  // Backend returns owner_id only — resolve the name locally (own deal or
  // admin user list).
  const ownerName = deal.owner_id
    ? deal.owner_id === user?.id
      ? user.name
      : users?.find((u) => u.id === deal.owner_id)?.name ?? t.deal.owner
    : null;

  const pipeline = (pipelines ?? []).find((p) => p.id === deal.pipeline_id);
  const stages = [...(pipeline?.stages ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const unitName = deal.unit_id
    ? units?.find((u) => u.id === deal.unit_id)?.name
    : undefined;
  const templateVars = {
    first_name: (deal.contact.name || deal.title).trim().split(/\s+/)[0] ?? "",
    course: deal.enrollment_data?.interest_course ?? "",
    unit: unitName ?? "",
    consultant: ownerName ?? user?.name ?? "",
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit gap-1 px-2 text-muted-foreground"
          asChild
        >
          <Link href="/negociacoes">
            <ArrowLeft className="size-4" />
            {t.common.back}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {deal.contact.name || deal.title}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={statusVariant(deal.status)}>
                {t.status[deal.status]}
              </Badge>
              {cooling && (
                <Badge variant="warning">
                  <Flame className="size-3" />
                  {t.kanban.coolingBadge(daysSince(deal.last_activity_at))}
                </Badge>
              )}
              <NextStepBadge
                status={deal.status}
                nextContactAt={deal.next_contact_at}
                onClick={() => setPromptOpen(true)}
              />
              {ownerName ? (
                <span className="text-xs text-muted-foreground">
                  {t.deal.owner}: {ownerName}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t.deal.noOwner}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {deal.status === "open" && stages.length > 0 && (
              <Select
                value={deal.stage_id}
                onValueChange={(stageId) => {
                  if (stageId !== deal.stage_id) requestMove(stageId);
                }}
                disabled={moveDeal.isPending}
              >
                <SelectTrigger
                  className="h-8 w-48"
                  aria-label={t.deal.stage}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages
                    .filter((s) => !s.is_won_stage || s.id === deal.stage_id)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <WhatsAppButton
              dealId={deal.id}
              phone={deal.contact.phone_whatsapp}
              dealStatus={deal.status}
              firstContactAt={deal.first_whatsapp_contact_at}
              vars={templateVars}
            />
            {deal.status === "open" && (
              <>
                <MarkWonDialog deal={deal} />
                <MarkLostDialog deal={deal} />
              </>
            )}
            {deal.status !== "open" && isAdmin && (
              <Button
                variant="outline"
                size="sm"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate()}
              >
                <RotateCcw className="size-4" />
                {t.deal.reopen}
              </Button>
            )}
          </div>
        </div>

        {/* First WhatsApp contact chip + quick log */}
        <div className="flex flex-wrap items-center gap-2">
          {deal.first_whatsapp_contact_at ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" />
              {t.kanban.firstContactAt(
                formatDateTime(deal.first_whatsapp_contact_at),
              )}
            </span>
          ) : deal.status === "open" ? (
            <FirstContactButton dealId={deal.id} className="gap-1.5" />
          ) : null}
          {deal.status === "open" && <QuickLogActions dealId={deal.id} />}
        </div>

        {/* Stage playbook (spec 12.1) */}
        <StageGuide stageId={deal.stage_id} />
      </div>

      {/* Closing checklist (spec 10.5): pre-won stage only, fully generic. */}
      <ClosingChecklist deal={deal} stages={stages} />

      {/* Content grid */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <DealFieldsCard deal={deal} />
          <DealObjectionCard deal={deal} vars={templateVars} />
          <EnrollmentForm deal={deal} />
        </div>
        <div className="flex flex-col gap-4">
          <DealTasks dealId={deal.id} />
          <Timeline dealId={deal.id} />
        </div>
      </div>

      {/* Stage gate (spec 08): fill missing fields, then retry the move. */}
      {gate && (
        <MissingFieldsDialog
          dealId={deal.id}
          missingFields={gate.missing}
          open
          onOpenChange={(o) => {
            if (!o) setGate(null);
          }}
          onCompleted={() => {
            const pending = gate;
            setGate(null);
            requestMove(pending.stageId);
          }}
        />
      )}

      <NextContactPrompt
        open={promptOpen}
        onOpenChange={setPromptOpen}
        suggestedDays={cadencePreset(settingsQuery.data?.followup_cadence, 0)}
        onSelect={(iso) => {
          if (iso) setNextContact.mutate(iso);
        }}
      />
    </div>
  );
}
