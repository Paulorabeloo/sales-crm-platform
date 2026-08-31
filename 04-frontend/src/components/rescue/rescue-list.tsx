"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
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
import { useReopenInCycle } from "@/hooks/mutations";
import { useRecoverableDeals } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { RecoverableDealItem } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { formatDate, formatRelativeAge } from "@/lib/utils";

function RescueRow({
  item,
  onReopen,
}: {
  item: RecoverableDealItem;
  onReopen: (item: RecoverableDealItem) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/negociacoes/${item.deal_id}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {item.contact_name || item.title}
          </Link>
          <span className="tnum rounded-full bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">
            {t.rescue.age(formatRelativeAge(item.lost_at))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {item.interest_course && <span>{item.interest_course}</span>}
          <Badge variant="secondary" className="text-muted-foreground">
            {t.rescue.fromCycle(item.cycle_name)}
          </Badge>
          <span>{t.rescue.lostAt(formatDate(item.lost_at))}</span>
          {item.owner_name && <span>{item.owner_name}</span>}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onReopen(item)}
      >
        <RotateCcw className="size-3.5" />
        {t.rescue.reopen}
      </Button>
    </li>
  );
}

/**
 * Win-back list: recoverable lost deals from previous cycles,
 * grouped by lost reason. "Reabrir no ciclo atual" creates a NEW deal (the
 * old one stays lost) and links both timelines.
 */
export function RescueList() {
  const query = useRecoverableDeals();
  const reopen = useReopenInCycle();
  const router = useRouter();
  const [confirmItem, setConfirmItem] =
    React.useState<RecoverableDealItem | null>(null);

  const groups = React.useMemo(() => {
    const map = new Map<string, RecoverableDealItem[]>();
    for (const item of query.data?.items ?? []) {
      const list = map.get(item.lost_reason_label) ?? [];
      list.push(item);
      map.set(item.lost_reason_label, list);
    }
    return [...map.entries()];
  }, [query.data]);

  function confirmReopen() {
    if (!confirmItem) return;
    reopen.mutate(confirmItem.deal_id, {
      onSuccess: (newDeal) => {
        setConfirmItem(null);
        toast.success(t.rescue.reopened, {
          action: {
            label: t.rescue.openNew,
            onClick: () => router.push(`/negociacoes/${newDeal.id}`),
          },
        });
      },
    });
  }

  if (query.isLoading) return <LoadingState />;
  if (query.isError)
    return (
      <ErrorState
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">{t.rescue.subtitle}</p>

      {groups.length === 0 ? (
        <EmptyState message={t.rescue.empty} />
      ) : (
        groups.map(([reason, items]) => (
          <section key={reason} className="flex flex-col gap-2">
            <h2 className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
              {reason}
              <span className="tnum rounded-full bg-muted px-2 py-px text-[11px] font-semibold text-muted-foreground">
                {t.rescue.reasonCount(items.length)}
              </span>
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <RescueRow
                  key={item.deal_id}
                  item={item}
                  onReopen={setConfirmItem}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <Dialog
        open={confirmItem !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmItem(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.rescue.reopenTitle}</DialogTitle>
            <DialogDescription>
              {confirmItem &&
                t.rescue.reopenDescription(
                  confirmItem.contact_name || confirmItem.title,
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmItem(null)}>
              {t.common.cancel}
            </Button>
            <Button disabled={reopen.isPending} onClick={confirmReopen}>
              {reopen.isPending ? t.common.saving : t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
