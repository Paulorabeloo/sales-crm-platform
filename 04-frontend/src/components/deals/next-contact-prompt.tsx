"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/strings";
import { cn, dateToContactISO, nextContactISO, todayISO } from "@/lib/utils";

interface NextContactPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Suggested interval in days (from the follow-up cadence). The matching
   * option is visually pre-selected; a non-standard value gets its own button.
   */
  suggestedDays?: number | null;
  /** Called with the ISO timestamp, or null for "no next step" (skip). */
  onSelect: (nextContactAt: string | null) => void;
}

const BASE_OPTIONS = [1, 3, 7];

/**
 * Lightweight one-click "next contact" prompt (spec 09.2), chained after
 * quick logs, first contact and stage moves.
 */
export function NextContactPrompt({
  open,
  onOpenChange,
  suggestedDays,
  onSelect,
}: NextContactPromptProps) {
  const [picking, setPicking] = React.useState(false);
  const [customDate, setCustomDate] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPicking(false);
      setCustomDate("");
    }
  }, [open]);

  const options = React.useMemo(() => {
    const days = [...BASE_OPTIONS];
    if (
      suggestedDays !== null &&
      suggestedDays !== undefined &&
      !days.includes(suggestedDays)
    ) {
      days.push(suggestedDays);
      days.sort((a, b) => a - b);
    }
    return days;
  }, [suggestedDays]);

  function choose(iso: string | null) {
    onOpenChange(false);
    onSelect(iso);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-accent-foreground" />
            {t.nextContact.title}
          </DialogTitle>
          <DialogDescription>{t.nextContact.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {options.map((days) => {
              const suggested = days === suggestedDays;
              return (
                <Button
                  key={days}
                  variant={suggested ? "default" : "outline"}
                  className={cn(suggested && "relative")}
                  onClick={() => choose(nextContactISO(days))}
                >
                  {days === 1 ? t.nextContact.tomorrow : t.nextContact.inDays(days)}
                </Button>
              );
            })}
          </div>
          {suggestedDays !== null && suggestedDays !== undefined && (
            <p className="text-xs text-muted-foreground">
              {t.nextContact.suggested}:{" "}
              {suggestedDays === 1
                ? t.nextContact.tomorrow.toLowerCase()
                : t.nextContact.inDays(suggestedDays).toLowerCase()}
            </p>
          )}

          {picking ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="next-contact-date">
                  {t.nextContact.pickDate}
                </Label>
                <Input
                  id="next-contact-date"
                  type="date"
                  min={todayISO()}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </div>
              <Button
                disabled={!customDate}
                onClick={() => choose(dateToContactISO(customDate))}
              >
                {t.common.confirm}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setPicking(true)}>
              {t.nextContact.pickDate}
            </Button>
          )}

          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => choose(null)}
          >
            {t.nextContact.skip}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
