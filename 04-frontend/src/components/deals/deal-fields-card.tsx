"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { useUpdateDeal } from "@/hooks/mutations";
import { useUnits, useUsers } from "@/hooks/queries";
import type { Deal } from "@/lib/api/types";
import { formatCurrencyInput, parseCurrencyInput } from "@/lib/currency";
import { t } from "@/lib/strings";

const NONE = "__none__";

interface DealFieldsForm {
  title: string;
  value: string;
  qualification: string;
  expected_close_date: string;
  source: string;
  campaign: string;
  unit_id: string;
  owner_id: string;
}

function toForm(deal: Deal): DealFieldsForm {
  return {
    title: deal.title ?? "",
    // B1 fix: prefill in pt-BR so re-saving never re-parses "500.00" as 50000.
    value: formatCurrencyInput(deal.value),
    qualification: deal.qualification ? String(deal.qualification) : NONE,
    expected_close_date: deal.expected_close_date ?? "",
    source: deal.source ?? "",
    campaign: deal.campaign ?? "",
    unit_id: deal.unit_id ?? NONE,
    owner_id: deal.owner_id ?? NONE,
  };
}

/** Editable first-class deal fields (saved via PATCH /deals/{id}). */
export function DealFieldsCard({ deal }: { deal: Deal }) {
  const { isAdmin } = useAuth();
  const { data: units } = useUnits();
  const { data: users } = useUsers(isAdmin);
  const updateDeal = useUpdateDeal(deal.id);

  const form = useForm<DealFieldsForm>({ defaultValues: toForm(deal) });

  React.useEffect(() => {
    form.reset(toForm(deal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  function onSubmit(values: DealFieldsForm) {
    updateDeal.mutate(
      {
        title: values.title || deal.contact.name,
        value: parseCurrencyInput(values.value),
        qualification:
          values.qualification !== NONE ? Number(values.qualification) : null,
        expected_close_date: values.expected_close_date || null,
        source: values.source || null,
        campaign: values.campaign || null,
        unit_id: values.unit_id !== NONE ? values.unit_id : null,
        // Backend PATCH ignores null fields, so un-assigning via this form is
        // not supported — only send owner_id when an owner is chosen (admin).
        ...(isAdmin && values.owner_id !== NONE
          ? { owner_id: values.owner_id }
          : {}),
      },
      {
        onSuccess: () => form.reset(form.getValues()),
      },
    );
  }

  const disabled = deal.status !== "open";

  return (
    <Card id="deal-fields-card">
      <CardHeader>
        <CardTitle className="text-base">{t.deal.detailTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="df-title">{t.deal.titleLabel}</Label>
            <Input
              id="df-title"
              disabled={disabled}
              {...form.register("title")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="df-value">{t.deal.value}</Label>
            <Input
              id="df-value"
              inputMode="decimal"
              disabled={disabled}
              {...form.register("value")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.qualification.label}</Label>
            <Select
              value={form.watch("qualification")}
              onValueChange={(v) =>
                form.setValue("qualification", v, { shouldDirty: true })
              }
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.common.notInformed}</SelectItem>
                {[1, 2, 3, 4, 5].map((level) => (
                  <SelectItem key={level} value={String(level)}>
                    {t.qualification.levels[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="df-close">{t.deal.expectedCloseDate}</Label>
            <Input
              id="df-close"
              type="date"
              disabled={disabled}
              {...form.register("expected_close_date")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.deal.unit}</Label>
            <Select
              value={form.watch("unit_id")}
              onValueChange={(v) =>
                form.setValue("unit_id", v, { shouldDirty: true })
              }
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.common.notInformed}</SelectItem>
                {(units ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="df-source">{t.deal.source}</Label>
            <Input
              id="df-source"
              disabled={disabled}
              {...form.register("source")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="df-campaign">{t.deal.campaign}</Label>
            <Input
              id="df-campaign"
              disabled={disabled}
              {...form.register("campaign")}
            />
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-1.5">
              <Label>{t.deal.owner}</Label>
              <Select
                value={form.watch("owner_id")}
                onValueChange={(v) =>
                  form.setValue("owner_id", v, { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t.deal.noOwner}</SelectItem>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.formState.isDirty && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={updateDeal.isPending}>
                {updateDeal.isPending ? t.common.saving : t.common.save}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
