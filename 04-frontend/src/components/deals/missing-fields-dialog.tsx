"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LoadingState } from "@/components/shared/states";
import { useDeal, useDealFields, useUnits } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { contactsApi, dealsApi } from "@/lib/api/resources";
import type { DealFieldDef } from "@/lib/api/types";
import { parseCurrencyInput } from "@/lib/currency";
import { t } from "@/lib/strings";

/** Money keys parsed with the pt-BR currency helper. */
const CURRENCY_KEYS = new Set(["value", "enrollment.monthly_fee_value"]);

export function dealFieldLabel(key: string): string {
  return t.dealFields.labels[key] ?? key;
}

type FieldValue = string | boolean;

interface MissingFieldsDialogProps {
  dealId: string;
  missingFields: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Retried action after the fields are saved (repeat the move / won). */
  onCompleted: () => void;
  /** Changes the primary button label ("Salvar e concluir" on won). */
  wonContext?: boolean;
}

function fieldDef(
  catalog: DealFieldDef[] | undefined,
  key: string,
): DealFieldDef {
  return catalog?.find((f) => f.key === key) ?? { key, type: "string" };
}

function isFilled(key: string, def: DealFieldDef, value: FieldValue): boolean {
  if (def.type === "boolean" || key === "first_whatsapp_contact_at") {
    return value === true;
  }
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Stage gate dialog (spec 08): lists the 422 `missing_fields` with inline
 * inputs, saves them and lets the caller repeat the blocked action.
 */
export function MissingFieldsDialog({
  dealId,
  missingFields,
  open,
  onOpenChange,
  onCompleted,
  wonContext = false,
}: MissingFieldsDialogProps) {
  const queryClient = useQueryClient();
  const dealQuery = useDeal(dealId);
  const { data: catalog } = useDealFields();
  const { data: units } = useUnits();
  const [values, setValues] = React.useState<Record<string, FieldValue>>({});

  React.useEffect(() => {
    if (open) setValues({});
  }, [open, missingFields]);

  const deal = dealQuery.data;

  const save = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error("deal not loaded");
      const dealPatch: Record<string, unknown> = {};
      const enrollmentPatch: Record<string, unknown> = {};
      const contactPatch: Record<string, unknown> = {};
      let registerFirstContact = false;

      for (const key of missingFields) {
        const def = fieldDef(catalog, key);
        const raw = values[key];
        if (key === "first_whatsapp_contact_at") {
          if (raw === true) registerFirstContact = true;
          continue;
        }
        const converted = convert(key, def, raw);
        if (key.startsWith("enrollment.")) {
          enrollmentPatch[key.slice("enrollment.".length)] = converted;
        } else if (key.startsWith("contact.")) {
          contactPatch[key.slice("contact.".length)] = converted;
        } else {
          dealPatch[key] = converted;
        }
      }

      if (Object.keys(enrollmentPatch).length > 0) {
        dealPatch.enrollment_data = {
          ...(deal.enrollment_data ?? {}),
          ...enrollmentPatch,
        };
      }
      if (Object.keys(contactPatch).length > 0) {
        await contactsApi.update(deal.contact_id, contactPatch);
      }
      if (registerFirstContact) {
        await dealsApi.registerFirstContact(deal.id);
      }
      if (Object.keys(dealPatch).length > 0) {
        await dealsApi.update(deal.id, dealPatch);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["activities", dealId] });
      onOpenChange(false);
      onCompleted();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const allFilled = missingFields.every((key) =>
    isFilled(key, fieldDef(catalog, key), values[key] ?? ""),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-accent-foreground" />
            {wonContext ? t.gate.titleWon : t.gate.title}
          </DialogTitle>
          <DialogDescription>{t.gate.description}</DialogDescription>
        </DialogHeader>

        {dealQuery.isLoading || !deal ? (
          <LoadingState />
        ) : (
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-1">
            {missingFields.map((key) => (
              <GateFieldInput
                key={key}
                fieldKey={key}
                def={fieldDef(catalog, key)}
                value={values[key] ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                units={units}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={!allFilled || save.isPending || !deal}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t.common.saving
              : wonContext
                ? t.gate.saveAndRetryWon
                : t.gate.saveAndRetry}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function convert(key: string, def: DealFieldDef, raw: FieldValue): unknown {
  if (def.type === "boolean") return raw === true;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (def.type === "number") {
    if (CURRENCY_KEYS.has(key)) return parseCurrencyInput(value);
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (def.type === "datetime") return value ? `${value}T00:00:00` : null;
  return value || null;
}

function GateFieldInput({
  fieldKey,
  def,
  value,
  onChange,
  units,
}: {
  fieldKey: string;
  def: DealFieldDef;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  units: { id: string; name: string }[] | undefined;
}) {
  const label = dealFieldLabel(fieldKey);
  const id = `gate-${fieldKey.replace(/\./g, "-")}`;

  // First contact is write-once via backend trigger: register, don't type.
  if (fieldKey === "first_whatsapp_contact_at") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">
            {t.gate.registerFirstContactNow}
          </span>
        </div>
        <Switch
          checked={value === true}
          aria-label={label}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    );
  }

  if (def.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">
            {t.gate.booleanHint}
          </span>
        </div>
        <Switch
          checked={value === true}
          aria-label={label}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    );
  }

  if (fieldKey === "unit_id") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger>
            <SelectValue placeholder={t.createDeal.unitPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {(units ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (fieldKey === "qualification") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((level) => (
              <SelectItem key={level} value={String(level)}>
                {t.qualification.levels[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (fieldKey === "enrollment.entry_method") {
    return (
      <EnumSelect
        label={label}
        value={value}
        onChange={onChange}
        options={t.enrollment.interest.entryMethods}
      />
    );
  }
  if (fieldKey === "enrollment.modality") {
    return (
      <EnumSelect
        label={label}
        value={value}
        onChange={onChange}
        options={t.enrollment.interest.modalities}
      />
    );
  }

  const inputType =
    def.type === "date" || def.type === "datetime" ? "date" : "text";
  const currency = CURRENCY_KEYS.has(fieldKey);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={inputType}
        inputMode={def.type === "number" ? "decimal" : undefined}
        placeholder={currency ? "0,00" : undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function EnumSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  options: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={onChange}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(options).map(([key, optionLabel]) => (
            <SelectItem key={key} value={key}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

