"use client";

import * as React from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRegisterFirstContact, useSetNextContact } from "@/hooks/mutations";
import { useMessageTemplates, useSettings } from "@/hooks/queries";
import type { DealStatus } from "@/lib/api/types";
import { t } from "@/lib/strings";
import {
  cadencePreset,
  renderTemplate,
  waLink,
  type TemplateVars,
} from "@/lib/utils";

interface WhatsAppButtonProps {
  dealId: string;
  phone: string;
  dealStatus: DealStatus;
  firstContactAt: string | null;
  /** Values for {{first_name}}, {{course}}, {{unit}}, {{consultant}}. */
  vars: TemplateVars;
  className?: string;
}

/**
 * Opens wa.me for the deal contact, with a dropdown of active message
 * templates rendered client-side (spec 09.4). "Sem mensagem" keeps the old
 * behavior; unregistered first contact still offers the write-once metric,
 * now chained with the next-contact prompt.
 */
export function WhatsAppButton({
  dealId,
  phone,
  dealStatus,
  firstContactAt,
  vars,
  className,
}: WhatsAppButtonProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const pendingUrl = React.useRef<string | null>(null);
  const firstContact = useRegisterFirstContact();
  const setNextContact = useSetNextContact(dealId);
  const { data: settings } = useSettings();
  const { data: templates } = useMessageTemplates();

  const activeTemplates = (templates ?? []).filter((tpl) => tpl.is_active);

  function openUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function proceed(text?: string) {
    const url = waLink(phone, text);
    if (!firstContactAt && dealStatus === "open") {
      pendingUrl.current = url;
      setConfirmOpen(true);
    } else {
      openUrl(url);
    }
  }

  const trigger =
    activeTemplates.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className={className}>
            <MessageCircle className="size-4 text-[#25D366]" />
            {t.deal.openWhatsApp}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t.whatsapp.withTemplate}</DropdownMenuLabel>
          {activeTemplates.map((tpl) => (
            <DropdownMenuItem
              key={tpl.id}
              onSelect={() => proceed(renderTemplate(tpl.body, vars))}
            >
              {tpl.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => proceed()}>
            {t.whatsapp.noTemplate}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button
        size="sm"
        variant="outline"
        className={className}
        onClick={() => proceed()}
      >
        <MessageCircle className="size-4 text-[#25D366]" />
        {t.deal.openWhatsApp}
      </Button>
    );

  return (
    <>
      {trigger}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deal.firstContactDialogTitle}</DialogTitle>
            <DialogDescription>
              {t.deal.firstContactDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                if (pendingUrl.current) openUrl(pendingUrl.current);
              }}
            >
              {t.deal.firstContactOnlyOpen}
            </Button>
            <Button
              disabled={firstContact.isPending}
              onClick={() => {
                firstContact.mutate(dealId, {
                  onSuccess: () => setPromptOpen(true),
                  onSettled: () => {
                    setConfirmOpen(false);
                    if (pendingUrl.current) openUrl(pendingUrl.current);
                  },
                });
              }}
            >
              {t.deal.firstContactRegister}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
