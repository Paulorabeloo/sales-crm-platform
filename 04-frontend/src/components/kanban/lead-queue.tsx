"use client";

import { Inbox, UserPlus } from "lucide-react";
import { DealCardContent } from "@/components/kanban/deal-card";
import { Button } from "@/components/ui/button";
import { useClaimDeal } from "@/hooks/mutations";
import type { DealCard } from "@/lib/api/types";
import { t } from "@/lib/strings";

interface LeadQueueProps {
  deals: DealCard[];
}

/** Unassigned leads (from the capture webhook) waiting for an owner. */
export function LeadQueue({ deals }: LeadQueueProps) {
  const claim = useClaimDeal();

  if (deals.length === 0) return null;

  return (
    <details
      open
      className="rounded-lg border border-primary/25 bg-primary/[0.045] dark:bg-primary/[0.07]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3">
        <Inbox className="size-4 text-accent-foreground" />
        <span className="flex items-baseline gap-1.5 text-[13px] font-semibold tracking-tight">
          {t.kanban.queueTitle}
          <span className="tnum rounded-full bg-primary/15 px-1.5 py-px text-[11px] font-semibold text-accent-foreground">
            {deals.length}
          </span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          · {t.kanban.queueSubtitle}
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {deals.map((deal) => (
          <DealCardContent
            key={deal.id}
            deal={deal}
            action={
              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={claim.isPending}
                onClick={() => claim.mutate(deal.id)}
              >
                <UserPlus className="size-3.5" />
                {claim.isPending ? t.kanban.claiming : t.kanban.claim}
              </Button>
            }
          />
        ))}
      </div>
    </details>
  );
}
