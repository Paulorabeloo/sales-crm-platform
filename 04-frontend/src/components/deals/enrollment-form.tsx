"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateDeal } from "@/hooks/mutations";
import type { Deal, EnrollmentData } from "@/lib/api/types";
import { formatCurrencyInput, parseCurrencyInput } from "@/lib/currency";
import {
  enrollmentFormSchema,
  type EnrollmentFormInput,
} from "@/lib/schemas";
import { t } from "@/lib/strings";

function str(v: string | null | undefined): string {
  return v ?? "";
}

function boolToForm(v: boolean | null | undefined): "" | "yes" | "no" {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "";
}

function formToBool(v: string | undefined): boolean | null {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

function toForm(data: EnrollmentData): EnrollmentFormInput {
  return {
    interest_area: str(data.interest_area),
    interest_course: str(data.interest_course),
    entry_method: data.entry_method ?? "",
    modality: data.modality ?? "",
    enrollment_semester: str(data.enrollment_semester),
    how_found_us: str(data.how_found_us),
    budget_range: str(data.budget_range),
    needs_scholarship_or_financing: boolToForm(
      data.needs_scholarship_or_financing,
    ),
    // B1 fix: prefill in pt-BR so re-saving never re-parses "500.00" as 50000.
    monthly_fee_value: formatCurrencyInput(data.monthly_fee_value),
    scholarship_offered: str(data.scholarship_offered),
    negotiated_final_condition: str(data.negotiated_final_condition),
    payment_method: str(data.payment_method),
    payment_status: str(data.payment_status),
    payment_date: str(data.payment_date),
    decision_deadline: str(data.decision_deadline),
    main_objection: str(data.main_objection),
    scheduling_status: str(data.scheduling_status),
    finished_high_school: boolToForm(data.finished_high_school),
    cpf: str(data.cpf),
    rg: str(data.rg),
    birth_date: str(data.birth_date),
    address: str(data.address),
    contract_signed: boolToForm(data.contract_signed),
    contract_accepted_at: data.contract_accepted_at
      ? data.contract_accepted_at.slice(0, 10)
      : "",
    contract_link: str(data.contract_link),
    ra_number: str(data.ra_number),
  };
}

function orNull(v: string | undefined): string | null {
  return v && v.trim() !== "" ? v : null;
}

function toPayload(values: EnrollmentFormInput): EnrollmentData {
  const fee = parseCurrencyInput(values.monthly_fee_value ?? "");
  return {
    interest_area: orNull(values.interest_area),
    interest_course: orNull(values.interest_course),
    entry_method: values.entry_method ? values.entry_method : null,
    modality: values.modality ? values.modality : null,
    enrollment_semester: orNull(values.enrollment_semester),
    how_found_us: orNull(values.how_found_us),
    budget_range: orNull(values.budget_range),
    needs_scholarship_or_financing: formToBool(
      values.needs_scholarship_or_financing,
    ),
    monthly_fee_value: fee,
    scholarship_offered: orNull(values.scholarship_offered),
    negotiated_final_condition: orNull(values.negotiated_final_condition),
    payment_method: orNull(values.payment_method),
    payment_status: orNull(values.payment_status),
    payment_date: orNull(values.payment_date),
    decision_deadline: orNull(values.decision_deadline),
    main_objection: orNull(values.main_objection),
    scheduling_status: orNull(values.scheduling_status),
    finished_high_school: formToBool(values.finished_high_school),
    cpf: orNull(values.cpf),
    rg: orNull(values.rg),
    birth_date: orNull(values.birth_date),
    address: orNull(values.address),
    contract_signed: formToBool(values.contract_signed),
    contract_accepted_at: values.contract_accepted_at
      ? `${values.contract_accepted_at}T00:00:00`
      : null,
    contract_link: orNull(values.contract_link),
    ra_number: orNull(values.ra_number),
  };
}

type Form = UseFormReturn<EnrollmentFormInput>;
type TextField = keyof EnrollmentFormInput;

function TextInput({
  form,
  name,
  label,
  type = "text",
}: {
  form: Form;
  name: TextField;
  label: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`ef-${name}`}>{label}</Label>
      <Input id={`ef-${name}`} type={type} {...form.register(name)} />
    </div>
  );
}

function YesNoSelect({
  form,
  name,
  label,
}: {
  form: Form;
  name: "needs_scholarship_or_financing" | "finished_high_school" | "contract_signed";
  label: string;
}) {
  const value = form.watch(name) ?? "";
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value === "" ? "__unset__" : value}
        onValueChange={(v) =>
          form.setValue(name, v === "__unset__" ? "" : (v as "yes" | "no"), {
            shouldDirty: true,
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">{t.common.notInformed}</SelectItem>
          <SelectItem value="yes">{t.common.yes}</SelectItem>
          <SelectItem value="no">{t.common.no}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

/** Progressive "enrollment data" form (deals.enrollment_data JSONB). */
export function EnrollmentForm({ deal }: { deal: Deal }) {
  const updateDeal = useUpdateDeal(deal.id);
  const form = useForm<EnrollmentFormInput>({
    resolver: zodResolver(enrollmentFormSchema),
    defaultValues: toForm(deal.enrollment_data ?? {}),
  });

  React.useEffect(() => {
    form.reset(toForm(deal.enrollment_data ?? {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  function onSubmit(values: EnrollmentFormInput) {
    updateDeal.mutate(
      { enrollment_data: toPayload(values) },
      {
        onSuccess: () => {
          toast.success(t.enrollment.saved);
          form.reset(form.getValues());
        },
      },
    );
  }

  const s = t.enrollment;

  return (
    <Card id="enrollment-form-card">
      <CardHeader>
        <CardTitle className="text-base">{t.deal.enrollmentTitle}</CardTitle>
        <CardDescription>{t.deal.enrollmentSubtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-5"
        >
          {/* Interest */}
          <SectionTitle>{s.interest.title}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput form={form} name="interest_area" label={s.interest.interest_area} />
            <TextInput form={form} name="interest_course" label={s.interest.interest_course} />
            <div className="flex flex-col gap-1.5">
              <Label>{s.interest.entry_method}</Label>
              <Select
                value={form.watch("entry_method") || "__unset__"}
                onValueChange={(v) =>
                  form.setValue(
                    "entry_method",
                    v === "__unset__"
                      ? ""
                      : (v as EnrollmentFormInput["entry_method"] & string),
                    { shouldDirty: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">{t.common.notInformed}</SelectItem>
                  {Object.entries(s.interest.entryMethods).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{s.interest.modality}</Label>
              <Select
                value={form.watch("modality") || "__unset__"}
                onValueChange={(v) =>
                  form.setValue(
                    "modality",
                    v === "__unset__"
                      ? ""
                      : (v as EnrollmentFormInput["modality"] & string),
                    { shouldDirty: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">{t.common.notInformed}</SelectItem>
                  {Object.entries(s.interest.modalities).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput form={form} name="enrollment_semester" label={s.interest.enrollment_semester} />
            <TextInput form={form} name="how_found_us" label={s.interest.how_found_us} />
          </div>

          <Separator />

          {/* Financial */}
          <SectionTitle>{s.financial.title}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput form={form} name="budget_range" label={s.financial.budget_range} />
            <YesNoSelect form={form} name="needs_scholarship_or_financing" label={s.financial.needs_scholarship_or_financing} />
            <TextInput form={form} name="monthly_fee_value" label={s.financial.monthly_fee_value} />
            <TextInput form={form} name="scholarship_offered" label={s.financial.scholarship_offered} />
            <TextInput form={form} name="negotiated_final_condition" label={s.financial.negotiated_final_condition} />
            <TextInput form={form} name="payment_method" label={s.financial.payment_method} />
            <TextInput form={form} name="payment_status" label={s.financial.payment_status} />
            <TextInput form={form} name="payment_date" label={s.financial.payment_date} type="date" />
          </div>

          <Separator />

          {/* Qualification / negotiation */}
          <SectionTitle>{s.qualification.title}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput form={form} name="decision_deadline" label={s.qualification.decision_deadline} type="date" />
            <TextInput form={form} name="scheduling_status" label={s.qualification.scheduling_status} />
            <YesNoSelect form={form} name="finished_high_school" label={s.qualification.finished_high_school} />
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ef-main_objection">{s.qualification.main_objection}</Label>
              <Textarea id="ef-main_objection" {...form.register("main_objection")} />
            </div>
          </div>

          <Separator />

          {/* Documents / closing */}
          <SectionTitle>{s.documents.title}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput form={form} name="cpf" label={s.documents.cpf} />
            <TextInput form={form} name="rg" label={s.documents.rg} />
            <TextInput form={form} name="birth_date" label={s.documents.birth_date} type="date" />
            <TextInput form={form} name="address" label={s.documents.address} />
            <YesNoSelect form={form} name="contract_signed" label={s.documents.contract_signed} />
            <TextInput form={form} name="contract_accepted_at" label={s.documents.contract_accepted_at} type="date" />
            <TextInput form={form} name="contract_link" label={s.documents.contract_link} />
            <TextInput form={form} name="ra_number" label={s.documents.ra_number} />
          </div>

          {form.formState.isDirty && (
            <div>
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
