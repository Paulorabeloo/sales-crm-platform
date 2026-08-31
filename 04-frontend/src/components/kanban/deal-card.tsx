"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { CheckCircle2, Flame, GraduationCap, MapPin } from "lucide-react";
import { FirstContactButton } from "@/components/deals/first-contact-button";
import { NextStepBadge } from "@/components/deals/next-step-badge";
import { QuickLogActions } from "@/components/deals/quick-log";
import { Badge } from "@/components/ui/badge";
import { useUnits } from "@/hooks/queries";
import type { DealCard as DealCardType, DealStatus } from "@/lib/api/types";
import { t } from "@/lib/strings";
import {
  cn,
  daysSince,
  formatCurrency,
  formatDateTime,
  num,
} from "@/lib/utils";

export function statusVariant(
  status: DealStatus,
): "default" | "success" | "destructive" {
  if (status === "won") return "success";
  if (status === "lost") return "destructive";
  return "default";
}

/** Client-side cooling check for the deal detail (cards use `is_cooling`). */
export function isCooling(
  deal: { status: DealStatus; last_activity_at: string },
  coolingDays: number,
): boolean {
  return (
    deal.status === "open" && daysSince(deal.last_activity_at) > coolingDays
  );
}

interface DealCardProps {
  deal: DealCardType;
  /** Extra action rendered at the card footer (e.g. claim button). */
  action?: React.ReactNode;
}

/** Presentational deal card, shared by the board, queue and mobile list. */
export function DealCardContent({ deal, action }: DealCardProps) {
  const router = useRouter();
  const { data: units } = useUnits();
  const unitName = deal.unit_id
    ? units?.find((p) => p.id === deal.unit_id)?.name
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/negociacoes/${deal.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/negociacoes/${deal.id}`);
      }}
      className={cn(
        "group flex cursor-pointer flex-col gap-1.5 rounded-md border bg-card p-2.5 text-left shadow-[0_1px_2px_rgba(16,24,32,0.05)] transition-[border-color,box-shadow,transform] duration-150 hover:border-primary/30 hover:shadow-[0_2px_8px_rgba(16,24,32,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        deal.status === "lost" && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold leading-snug">
          {deal.contact_name || deal.title}
        </span>
        {num(deal.value) > 0 && (
          <span className="tnum shrink-0 text-xs font-medium text-muted-foreground">
            {formatCurrency(deal.value)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {unitName && (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{unitName}</span>
          </span>
        )}
        {deal.interest_course && (
          <span className="flex items-center gap-1.5">
            <GraduationCap className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{deal.interest_course}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={statusVariant(deal.status)}>
          {t.status[deal.status]}
        </Badge>
        {deal.is_cooling && (
          <Badge variant="warning">
            <Flame className="size-3" />
            {t.kanban.coolingBadge(daysSince(deal.last_activity_at))}
          </Badge>
        )}
        <NextStepBadge
          status={deal.status}
          nextContactAt={deal.next_contact_at}
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {deal.first_whatsapp_contact_at ? (
          <span className="tnum inline-flex items-center gap-1 rounded-full bg-success/8 px-1.5 py-px text-[11px] font-medium text-success dark:bg-success/14">
            <CheckCircle2 className="size-3" />
            {t.kanban.firstContactAt(
              formatDateTime(deal.first_whatsapp_contact_at),
            )}
          </span>
        ) : deal.status === "open" ? (
          <FirstContactButton
            dealId={deal.id}
            className="h-6 gap-1 px-2 text-[11px]"
          />
        ) : null}
        {deal.status === "open" && <QuickLogActions dealId={deal.id} asMenu />}
      </div>

      {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
    </div>
  );
}

/** Draggable wrapper used inside the kanban board (desktop). */
export function DraggableDealCard({ deal }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: deal.id,
      data: { deal },
      disabled: deal.status !== "open",
    });

  const style: React.CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(1.5deg)`,
        zIndex: 30,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        isDragging &&
          "opacity-95 [&>div]:shadow-[0_10px_28px_rgba(16,24,32,0.18)] [&>div]:ring-1 [&>div]:ring-primary/25",
      )}
      {...listeners}
      {...attributes}
    >
      <DealCardContent deal={deal} />
    </div>
  );
}
