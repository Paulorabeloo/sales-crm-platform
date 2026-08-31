"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMessageTemplates, useObjections } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import { objectionsApi } from "@/lib/api/resources";
import type { MessageTemplate, Objection } from "@/lib/api/types";
import { t } from "@/lib/strings";

const NONE = "__none__";

function useInvalidateObjections() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["objections"] });
  }, [queryClient]);
}

function TemplateSelect({
  value,
  onChange,
  templates,
}: {
  value: string | null;
  onChange: (templateId: string | null) => void;
  templates: MessageTemplate[];
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t.settings.objections.noTemplate}</SelectItem>
        {templates.map((tpl) => (
          <SelectItem key={tpl.id} value={tpl.id}>
            {tpl.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ObjectionCard({
  objection,
  templates,
}: {
  objection: Objection;
  templates: MessageTemplate[];
}) {
  const [name, setName] = React.useState(objection.name);
  const [rebuttal, setRebuttal] = React.useState(objection.rebuttal);
  const invalidate = useInvalidateObjections();

  React.useEffect(() => {
    setName(objection.name);
    setRebuttal(objection.rebuttal);
  }, [objection.name, objection.rebuttal]);

  const update = useMutation({
    mutationFn: (patch: {
      name?: string;
      rebuttal?: string;
      template_id?: string | null;
      is_active?: boolean;
    }) => objectionsApi.update(objection.id, patch),
    onSuccess: () => {
      toast.success(t.settings.objections.updated);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => objectionsApi.remove(objection.id),
    onSuccess: () => {
      toast.success(t.settings.objections.deleted);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const dirty =
    name.trim() !== objection.name || rebuttal !== objection.rebuttal;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            aria-label={t.settings.objections.name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-56 font-medium"
          />
          <div className="ml-auto flex items-center gap-2">
            <Switch
              checked={objection.is_active}
              aria-label={
                objection.is_active ? t.common.deactivate : t.common.activate
              }
              onCheckedChange={(checked) =>
                update.mutate({ is_active: checked })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t.common.remove}
              title={t.settings.objections.deleteHint}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t.settings.objections.rebuttal}
          </Label>
          <Textarea
            value={rebuttal}
            rows={3}
            aria-label={t.settings.objections.rebuttal}
            onChange={(e) => setRebuttal(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t.settings.objections.template}
          </Label>
          <TemplateSelect
            value={objection.template_id}
            templates={templates}
            onChange={(templateId) => update.mutate({ template_id: templateId })}
          />
        </div>
        {dirty && (
          <div>
            <Button
              size="sm"
              disabled={!name.trim() || !rebuttal.trim() || update.isPending}
              onClick={() => update.mutate({ name: name.trim(), rebuttal })}
            >
              {update.isPending ? t.common.saving : t.common.save}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ObjectionsTab() {
  const objectionsQuery = useObjections(true);
  const templatesQuery = useMessageTemplates(true);
  const invalidate = useInvalidateObjections();

  const [newName, setNewName] = React.useState("");
  const [newRebuttal, setNewRebuttal] = React.useState("");
  const [newTemplateId, setNewTemplateId] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      objectionsApi.create({
        name: newName.trim(),
        rebuttal: newRebuttal,
        template_id: newTemplateId,
      }),
    onSuccess: () => {
      toast.success(t.settings.objections.created);
      setNewName("");
      setNewRebuttal("");
      setNewTemplateId(null);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (objectionsQuery.isLoading) return <LoadingState />;
  if (objectionsQuery.isError)
    return (
      <ErrorState
        message={errorMessage(objectionsQuery.error)}
        onRetry={() => void objectionsQuery.refetch()}
      />
    );

  const objections = objectionsQuery.data ?? [];
  const templates = (templatesQuery.data ?? []).filter((tpl) => tpl.is_active);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.objections.subtitle}
      </p>

      {objections.length === 0 ? (
        <EmptyState message={t.settings.objections.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {objections.map((objection) => (
            <li key={objection.id}>
              <ObjectionCard objection={objection} templates={templates} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardDescription>
            {t.settings.objections.newObjection}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-obj-name">{t.settings.objections.name}</Label>
            <Input
              id="new-obj-name"
              value={newName}
              placeholder={t.settings.objections.namePlaceholder}
              onChange={(e) => setNewName(e.target.value)}
              className="max-w-56"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-obj-rebuttal">
              {t.settings.objections.rebuttal}
            </Label>
            <Textarea
              id="new-obj-rebuttal"
              rows={3}
              value={newRebuttal}
              placeholder={t.settings.objections.rebuttalPlaceholder}
              onChange={(e) => setNewRebuttal(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              {t.settings.objections.template} ({t.common.optional})
            </Label>
            <TemplateSelect
              value={newTemplateId}
              templates={templates}
              onChange={setNewTemplateId}
            />
          </div>
          <div>
            <Button
              disabled={
                !newName.trim() || !newRebuttal.trim() || create.isPending
              }
              onClick={() => create.mutate()}
            >
              <Plus className="size-4" />
              {t.settings.objections.newObjection}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
