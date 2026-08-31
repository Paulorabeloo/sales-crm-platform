"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useCreateDeal } from "@/hooks/mutations";
import { useUnits } from "@/hooks/queries";
import { parseCurrencyInput } from "@/lib/currency";
import { createDealSchema, type CreateDealFormInput } from "@/lib/schemas";
import { t } from "@/lib/strings";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function CreateDealDialog({ pipelineId }: { pipelineId: string }) {
  const [open, setOpen] = React.useState(false);
  const { data: units } = useUnits();
  const createDeal = useCreateDeal();

  const form = useForm<CreateDealFormInput>({
    resolver: zodResolver(createDealSchema),
    defaultValues: {
      contact_name: "",
      contact_phone: "",
      interest_course: "",
      value: "",
      unit_id: "",
      source: "",
    },
  });

  function onSubmit(values: CreateDealFormInput) {
    createDeal.mutate(
      {
        contact: {
          name: values.contact_name,
          phone_whatsapp: values.contact_phone,
        },
        pipeline_id: pipelineId,
        unit_id: values.unit_id || null,
        // B1 fix: shared parser accepts "1.500,50", "1500.50" and "500.00".
        value: values.value ? parseCurrencyInput(values.value) : null,
        interest_course: values.interest_course || null,
        source: values.source || null,
      },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {t.kanban.newDeal}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.createDeal.title}</DialogTitle>
          <DialogDescription>{t.createDeal.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cd-name">{t.createDeal.contactName}</Label>
            <Input id="cd-name" {...form.register("contact_name")} />
            <FieldError
              message={form.formState.errors.contact_name?.message}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cd-phone">{t.createDeal.contactPhone}</Label>
            <Input
              id="cd-phone"
              type="tel"
              placeholder={t.contacts.phonePlaceholder}
              {...form.register("contact_phone")}
            />
            <FieldError
              message={form.formState.errors.contact_phone?.message}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-course">{t.createDeal.course}</Label>
              <Input id="cd-course" {...form.register("interest_course")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-value">{t.createDeal.value}</Label>
              <Input
                id="cd-value"
                inputMode="decimal"
                {...form.register("value")}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.createDeal.unit}</Label>
            <Select
              value={form.watch("unit_id") ?? ""}
              onValueChange={(v) => form.setValue("unit_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t.createDeal.unitPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {(units ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cd-source">
              {t.createDeal.source}{" "}
              <span className="text-xs text-muted-foreground">
                ({t.common.optional})
              </span>
            </Label>
            <Input id="cd-source" {...form.register("source")} />
          </div>
          <Button type="submit" disabled={createDeal.isPending}>
            {createDeal.isPending ? t.common.saving : t.createDeal.submit}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
