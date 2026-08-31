"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { NextContactPrompt } from "@/components/deals/next-contact-prompt";
import { Button } from "@/components/ui/button";
import { useRegisterFirstContact, useSetNextContact } from "@/hooks/mutations";
import { useSettings } from "@/hooks/queries";
import { t } from "@/lib/strings";
import { cadencePreset } from "@/lib/utils";

/**
 * "Registrar 1º contato" button chained with the next-contact prompt
 * (the spec: the prompt also fires on first-contact registration).
 */
export function FirstContactButton({
  dealId,
  className,
}: {
  dealId: string;
  className?: string;
}) {
  const firstContact = useRegisterFirstContact();
  const setNextContact = useSetNextContact(dealId);
  const { data: settings } = useSettings();
  const [promptOpen, setPromptOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={firstContact.isPending}
        onClick={() =>
          firstContact.mutate(dealId, {
            onSuccess: () => setPromptOpen(true),
          })
        }
      >
        <Clock className="size-3" />
        {t.kanban.registerFirstContact}
      </Button>
      <NextContactPrompt
        open={promptOpen}
        onOpenChange={setPromptOpen}
        suggestedDays={cadencePreset(settings?.followup_cadence, 0)}
        onSelect={(iso) => {
          if (iso) setNextContact.mutate(iso);
        }}
      />
    </>
  );
}
