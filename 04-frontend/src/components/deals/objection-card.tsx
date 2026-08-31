"use client";

import * as React from "react";
import { Lightbulb, MessageCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateDeal } from "@/hooks/mutations";
import { useMessageTemplates, useObjections } from "@/hooks/queries";
import type { Deal } from "@/lib/api/types";
import { t } from "@/lib/strings";
import { renderTemplate, waLink, type TemplateVars } from "@/lib/utils";

const NONE = "__none__";
const LEGACY = "__legacy__";

/**
 * Catalog objection on the deal detail (spec 12.2): a select over the
 * objections catalog (PATCH deals.objection_id). A pre-catalog free-text
 * value (enrollment_data.main_objection) shows as the "Outro: ..." option.
 * Selecting an objection reveals the suggested rebuttal and, when a template
 * is linked, a "Responder no WhatsApp" button.
 */
export function DealObjectionCard({
  deal,
  vars,
}: {
  deal: Deal;
  vars: TemplateVars;
}) {
  const { data: objections } = useObjections();
  const { data: templates } = useMessageTemplates();
  const updateDeal = useUpdateDeal(deal.id);

  const legacyText = deal.enrollment_data?.main_objection?.trim() || null;
  const selected =
    (objections ?? []).find((o) => o.id === deal.objection_id) ?? null;
  const template = selected?.template_id
    ? ((templates ?? []).find(
        (tpl) => tpl.id === selected.template_id && tpl.is_active,
      ) ?? null)
    : null;

  const value = deal.objection_id ?? (legacyText ? LEGACY : NONE);
  const disabled = deal.status !== "open" || updateDeal.isPending;

  function onChange(next: string) {
    if (next === value) return;
    const objectionId = next === NONE || next === LEGACY ? null : next;
    updateDeal.mutate(
      { objection_id: objectionId },
      { onSuccess: () => toast.success(t.objection.saved) },
    );
  }

  function respond() {
    if (!template) return;
    window.open(
      waLink(deal.contact.phone_whatsapp, renderTemplate(template.body, vars)),
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-muted-foreground" />
          {t.objection.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger aria-label={t.objection.cardTitle}>
            <SelectValue placeholder={t.objection.selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t.objection.none}</SelectItem>
            {legacyText && (
              <SelectItem value={LEGACY}>
                {t.objection.legacy(legacyText)}
              </SelectItem>
            )}
            {(objections ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <div className="flex flex-col gap-2 rounded-lg bg-accent/50 px-3 py-2.5 dark:bg-accent/30">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-accent-foreground">
              <Lightbulb className="size-3.5" />
              {t.objection.rebuttalTitle}
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
              {selected.rebuttal}
            </p>
            {template && deal.status === "open" && (
              <div>
                <Button size="sm" variant="outline" onClick={respond}>
                  <MessageCircle className="size-3.5 text-[#25D366]" />
                  {t.objection.respondWhatsApp}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
