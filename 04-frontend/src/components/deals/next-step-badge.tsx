"use client";

import { CalendarClock, CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DealStatus } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { cn, formatDate, hasNoNextStep } from "@/lib/utils";

interface NextStepBadgeProps {
  status: DealStatus;
  nextContactAt: string | null;
  /** When set, the badge becomes a button (opens the next-contact prompt). */
  onClick?: () => void;
  className?: string;
}

/**
 * Follow-up state of an open deal: gray-attention badge when
 * there is no FUTURE next contact, date badge when one is scheduled.
 */
export function NextStepBadge({
  status,
  nextContactAt,
  onClick,
  className,
}: NextStepBadgeProps) {
  if (status !== "open") return null;

  const overdue = hasNoNextStep({ status, next_contact_at: nextContactAt });
  const badge = overdue ? (
    <Badge variant="secondary" className={cn("text-muted-foreground", className)}>
      <CalendarX2 className="size-3" />
      {t.nextContact.badgeNone}
    </Badge>
  ) : (
    <Badge variant="outline" className={cn("text-muted-foreground", className)}>
      <CalendarClock className="size-3" />
      {t.nextContact.badgeAt(formatDate(nextContactAt))}
    </Badge>
  );

  if (!onClick) return badge;
  return (
    <button
      type="button"
      aria-label={t.nextContact.editAria}
      onClick={onClick}
      className="rounded-full transition-opacity duration-150 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {badge}
    </button>
  );
}
