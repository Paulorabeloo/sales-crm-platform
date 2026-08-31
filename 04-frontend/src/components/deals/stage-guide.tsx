"use client";

import * as React from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { usePipelines } from "@/hooks/queries";
import { t } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * Discreet collapsible "Guia desta etapa" panel: renders the
 * current stage's playbook (plain text), collapsed by default with a teaser.
 */
export function StageGuide({ stageId }: { stageId: string }) {
  const { data: pipelines } = usePipelines();
  const [open, setOpen] = React.useState(false);

  const stage = React.useMemo(() => {
    for (const pipeline of pipelines ?? []) {
      const found = pipeline.stages.find((s) => s.id === stageId);
      if (found) return found;
    }
    return undefined;
  }, [pipelines, stageId]);

  const playbook = stage?.playbook?.trim();
  if (!playbook) return null;

  const teaser = playbook.split("\n")[0];

  return (
    <div className="rounded-lg border border-accent-foreground/15 bg-accent/40 dark:bg-accent/25">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen className="size-3.5 shrink-0 text-accent-foreground" />
        <span className="text-[13px] font-medium text-accent-foreground">
          {t.guide.title}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {teaser}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <p className="whitespace-pre-wrap px-3 pb-3 pl-[2.15rem] text-[13px] leading-relaxed text-foreground/85">
          {playbook}
        </p>
      )}
    </div>
  );
}
