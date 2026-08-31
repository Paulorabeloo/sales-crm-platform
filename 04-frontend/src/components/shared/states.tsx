"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/strings";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-label={t.common.loading}
      className={cn("size-5 animate-spin text-muted-foreground", className)}
    />
  );
}

/** Skeleton block used while a section loads — calmer than a spinner. */
export function LoadingState({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2.5 py-6"
    >
      <span className="sr-only">{label ?? t.common.loading}</span>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

/** Quiet geometric illustration for empty sections — three fading funnel
 * bars echoing the brand mark. */
function EmptyGlyph() {
  return (
    <svg
      viewBox="0 0 64 44"
      aria-hidden
      className="h-11 w-16 text-muted-foreground/50"
    >
      <rect
        x="6"
        y="6"
        width="52"
        height="7"
        rx="3.5"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="14"
        y="19"
        width="36"
        height="7"
        rx="3.5"
        fill="currentColor"
        opacity="0.32"
      />
      <rect
        x="22"
        y="32"
        width="20"
        height="7"
        rx="3.5"
        fill="currentColor"
        opacity="0.18"
      />
    </svg>
  );
}

export function EmptyState({
  message,
  action,
}: {
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/25 py-12 text-center">
      <EmptyGlyph />
      <p className="max-w-sm text-[13px] text-muted-foreground">
        {message ?? t.common.emptyDefault}
      </p>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.04] py-12 text-center">
      <AlertCircle className="size-7 text-destructive/80" />
      <p className="text-[13px] text-foreground">
        {message ?? t.common.errorTitle}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.common.errorRetry}
        </Button>
      )}
    </div>
  );
}
