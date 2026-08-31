"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { CyclesTab } from "@/components/settings/cycles-tab";
import { GoalsTab } from "@/components/settings/goals-tab";
import { ObjectionsTab } from "@/components/settings/objections-tab";
import { SpendTab } from "@/components/settings/spend-tab";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useDealFields,
  useLeadSources,
  useLostReasons,
  useMessageTemplates,
  usePipelines,
  useUnits,
  useSettings,
  useUsers,
  queryKeys,
} from "@/hooks/queries";
import { API_BASE, errorMessage } from "@/lib/api/client";
import {
  leadSourcesApi,
  lostReasonsApi,
  messageTemplatesApi,
  pipelinesApi,
  unitsApi,
  settingsApi,
  usersApi,
} from "@/lib/api/resources";
import type {
  LostReason,
  MessageTemplate,
  Unit,
  Stage,
  User,
} from "@/lib/api/types";
import { renderTemplate } from "@/lib/utils";
import { userFormSchema, type UserFormInput } from "@/lib/schemas";
import { t } from "@/lib/strings";

const NONE = "__none__";

// ---------------------------------------------------------------- Users tab

function CreateUserDialog() {
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const { data: units } = useUnits();

  const form = useForm<UserFormInput>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "CONSULTOR",
      unit_id: "",
    },
  });

  const createUser = useMutation({
    mutationFn: (values: UserFormInput) =>
      usersApi.create({
        name: values.name,
        email: values.email,
        password: values.password,
        role: values.role,
        unit_id: values.unit_id || null,
      }),
    onSuccess: () => {
      toast.success(t.settings.users.created);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      setOpen(false);
      form.reset();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t.settings.users.newUser}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.settings.users.newUser}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => createUser.mutate(v))}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-name">{t.settings.users.name}</Label>
            <Input id="u-name" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-email">{t.settings.users.email}</Label>
            <Input id="u-email" type="email" {...form.register("email")} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-password">{t.settings.users.password}</Label>
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <p className="text-xs text-destructive">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t.settings.users.role}</Label>
              <Select
                value={form.watch("role")}
                onValueChange={(v) =>
                  form.setValue("role", v as UserFormInput["role"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONSULTOR">
                    {t.settings.users.roleConsultant}
                  </SelectItem>
                  <SelectItem value="ADMIN">
                    {t.settings.users.roleAdmin}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.settings.users.unit}</Label>
              <Select
                value={form.watch("unit_id") || NONE}
                onValueChange={(v) =>
                  form.setValue("unit_id", v === NONE ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t.common.none}</SelectItem>
                  {(units ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? t.common.saving : t.common.create}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: User }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");

  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id, password),
    onSuccess: () => {
      toast.success(t.settings.users.passwordReset);
      setOpen(false);
      setPassword("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t.settings.users.resetPassword}
        onClick={() => setOpen(true)}
      >
        <KeyRound className="size-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t.settings.users.resetPassword}: {user.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rp-password">{t.settings.users.newPassword}</Label>
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button
          disabled={password.length < 8 || reset.isPending}
          onClick={() => reset.mutate()}
        >
          {reset.isPending ? t.common.saving : t.common.save}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const usersQuery = useUsers();
  const { data: units } = useUnits();
  const queryClient = useQueryClient();

  const updateUser = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      usersApi.update(id, { is_active }),
    onSuccess: () => {
      toast.success(t.settings.users.updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unitName = (id: string | null) =>
    (units ?? []).find((p) => p.id === id)?.name ?? t.common.none;

  if (usersQuery.isLoading) return <LoadingState />;
  if (usersQuery.isError)
    return (
      <ErrorState
        message={errorMessage(usersQuery.error)}
        onRetry={() => void usersQuery.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateUserDialog />
      </div>
      <p className="text-sm text-muted-foreground">
        {t.settings.users.confirmDeactivate}
      </p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.settings.users.name}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t.settings.users.email}
              </TableHead>
              <TableHead>{t.settings.users.role}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t.settings.users.unit}
              </TableHead>
              <TableHead>{t.common.active}</TableHead>
              <TableHead className="text-right">{t.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(usersQuery.data ?? []).map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {user.email}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={user.role === "ADMIN" ? "default" : "secondary"}
                  >
                    {user.role === "ADMIN"
                      ? t.settings.users.roleAdmin
                      : t.settings.users.roleConsultant}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {unitName(user.unit_id)}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={user.is_active}
                    aria-label={
                      user.is_active ? t.common.deactivate : t.common.activate
                    }
                    onCheckedChange={(checked) =>
                      updateUser.mutate({ id: user.id, is_active: checked })
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <ResetPasswordDialog user={user} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Units tab

function UnitRow({ unit }: { unit: Unit }) {
  const [name, setName] = React.useState(unit.name);
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (body: { name?: string; is_active?: boolean }) =>
      unitsApi.update(unit.id, body),
    onSuccess: () => {
      toast.success(t.settings.units.updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function saveName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== unit.name) update.mutate({ name: trimmed });
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          value={name}
          aria-label={t.settings.units.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="max-w-xs"
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={unit.is_active}
          aria-label={unit.is_active ? t.common.deactivate : t.common.activate}
          onCheckedChange={(checked) => update.mutate({ is_active: checked })}
        />
      </TableCell>
    </TableRow>
  );
}

function UnitsTab() {
  const unitsQuery = useUnits();
  const queryClient = useQueryClient();
  const [newName, setNewName] = React.useState("");

  const create = useMutation({
    mutationFn: () => unitsApi.create({ name: newName.trim() }),
    onSuccess: () => {
      toast.success(t.settings.units.created);
      setNewName("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (unitsQuery.isLoading) return <LoadingState />;
  if (unitsQuery.isError)
    return (
      <ErrorState
        message={errorMessage(unitsQuery.error)}
        onRetry={() => void unitsQuery.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.units.renameHint}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-unit">{t.settings.units.name}</Label>
          <Input
            id="new-unit"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.units.newUnit}
        </Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.settings.units.name}</TableHead>
              <TableHead>{t.common.active}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(unitsQuery.data ?? []).map((unit) => (
              <UnitRow key={unit.id} unit={unit} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Stages tab

/** Per-stage config (spec 08/12): required fields + playbook textarea. */
function StageConfigDialog({ stage }: { stage: Stage }) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>(
    stage.required_fields,
  );
  const [playbook, setPlaybook] = React.useState(stage.playbook ?? "");
  const { data: catalog } = useDealFields();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setSelected(stage.required_fields);
      setPlaybook(stage.playbook ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      pipelinesApi.updateStage(stage.id, {
        required_fields: selected,
        playbook: playbook.trim() ? playbook : null,
      }),
    onSuccess: () => {
      toast.success(t.settings.stages.configSaved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelines });
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function toggle(key: string, checked: boolean) {
    setSelected((prev) =>
      checked ? [...prev, key] : prev.filter((k) => k !== key),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-3.5" />
        {t.settings.stages.configure}
      </Button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t.settings.stages.configureTitle(stage.name)}
          </DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium">
                {t.settings.stages.requiredFields}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.settings.stages.requiredFieldsHint}
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {(catalog ?? []).map((field) => {
                const label = t.dealFields.labels[field.key] ?? field.key;
                const id = `rf-${stage.id}-${field.key.replace(/\./g, "-")}`;
                return (
                  <li key={field.key} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={selected.includes(field.key)}
                      onCheckedChange={(checked) =>
                        toggle(field.key, checked === true)
                      }
                    />
                    <Label
                      htmlFor={id}
                      className="cursor-pointer text-[13px] font-normal"
                    >
                      {label}
                    </Label>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pb-${stage.id}`}>
              {t.settings.stages.playbook}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t.settings.stages.playbookHint}
            </p>
            <Textarea
              id={`pb-${stage.id}`}
              rows={5}
              placeholder={t.settings.stages.playbookPlaceholder}
              value={playbook}
              onChange={(e) => setPlaybook(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t.common.saving : t.common.save}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const [name, setName] = React.useState(stage.name);
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (body: { name: string }) =>
      pipelinesApi.updateStage(stage.id, body),
    onSuccess: () => {
      toast.success(t.settings.stages.updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelines });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => pipelinesApi.deleteStage(stage.id),
    onSuccess: () => {
      toast.success(t.settings.stages.deleted);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelines });
    },
    onError: () => toast.error(t.settings.stages.deleteBlocked),
  });

  return (
    <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="w-6 text-center text-sm font-semibold text-muted-foreground">
        {stage.sort_order}
      </span>
      <Input
        value={name}
        aria-label={t.settings.stages.name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== stage.name) update.mutate({ name: trimmed });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="max-w-xs"
      />
      {stage.is_won_stage && (
        <Badge variant="success">
          <Star className="size-3" />
          {t.settings.stages.wonStage}
        </Badge>
      )}
      {stage.required_fields.length > 0 && (
        <Badge variant="secondary" className="hidden text-muted-foreground sm:inline-flex">
          {t.settings.stages.requiredCount(stage.required_fields.length)}
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1">
        <StageConfigDialog stage={stage} />
        {!stage.is_won_stage && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t.common.remove}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

function StagesTab() {
  const pipelinesQuery = usePipelines();
  const queryClient = useQueryClient();
  const [pipelineId, setPipelineId] = React.useState("");
  const [newStage, setNewStage] = React.useState("");

  const pipelines = pipelinesQuery.data ?? [];
  const active =
    pipelines.find((p) => p.id === pipelineId) ??
    pipelines.find((p) => p.is_default) ??
    pipelines[0];

  const addStage = useMutation({
    // Backend requires an explicit unique sort_order — append after the last.
    mutationFn: () => {
      const nextOrder =
        Math.max(0, ...(active?.stages ?? []).map((s) => s.sort_order)) + 1;
      return pipelinesApi.createStage(active?.id ?? "", {
        name: newStage.trim(),
        sort_order: nextOrder,
      });
    },
    onSuccess: () => {
      toast.success(t.settings.stages.created);
      setNewStage("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelines });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (pipelinesQuery.isLoading) return <LoadingState />;
  if (pipelinesQuery.isError)
    return (
      <ErrorState
        message={errorMessage(pipelinesQuery.error)}
        onRetry={() => void pipelinesQuery.refetch()}
      />
    );
  if (!active) return <EmptyState />;

  const stages = [...active.stages].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.stages.subtitle}
      </p>
      {pipelines.length > 1 && (
        <Select
          value={active.id}
          onValueChange={setPipelineId}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="new-stage">{t.settings.stages.name}</Label>
          <Input
            id="new-stage"
            value={newStage}
            onChange={(e) => setNewStage(e.target.value)}
          />
        </div>
        <Button
          disabled={!newStage.trim() || addStage.isPending}
          onClick={() => addStage.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.stages.newStage}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Messages tab

/** WhatsApp message template editor with live variable preview (spec 09.4). */
function TemplateCard({ template }: { template: MessageTemplate }) {
  const [name, setName] = React.useState(template.name);
  const [body, setBody] = React.useState(template.body);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    setName(template.name);
    setBody(template.body);
  }, [template.name, template.body]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["message-templates"] });

  const update = useMutation({
    mutationFn: (patch: {
      name?: string;
      body?: string;
      is_active?: boolean;
    }) => messageTemplatesApi.update(template.id, patch),
    onSuccess: () => {
      toast.success(t.settings.messages.updated);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => messageTemplatesApi.remove(template.id),
    onSuccess: () => {
      toast.success(t.settings.messages.deleted);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const dirty = name.trim() !== template.name || body !== template.body;
  const preview = renderTemplate(body, t.settings.messages.sampleVars);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            aria-label={t.settings.messages.name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-60 font-medium"
          />
          <div className="ml-auto flex items-center gap-2">
            <Switch
              checked={template.is_active}
              aria-label={
                template.is_active ? t.common.deactivate : t.common.activate
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
              title={t.settings.messages.deleteConfirmHint}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <Textarea
          value={body}
          rows={3}
          aria-label={t.settings.messages.body}
          onChange={(e) => setBody(e.target.value)}
        />
        {body.trim() && (
          <div className="rounded-md bg-muted/60 px-3 py-2">
            <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
              {t.settings.messages.preview}
            </p>
            <p className="whitespace-pre-wrap text-[13px]">{preview}</p>
          </div>
        )}
        {dirty && (
          <div>
            <Button
              size="sm"
              disabled={!name.trim() || !body.trim() || update.isPending}
              onClick={() => update.mutate({ name: name.trim(), body })}
            >
              {update.isPending ? t.common.saving : t.common.save}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessagesTab() {
  const templatesQuery = useMessageTemplates(true);
  const queryClient = useQueryClient();
  const [newName, setNewName] = React.useState("");
  const [newBody, setNewBody] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      messageTemplatesApi.create({ name: newName.trim(), body: newBody }),
    onSuccess: () => {
      toast.success(t.settings.messages.created);
      setNewName("");
      setNewBody("");
      void queryClient.invalidateQueries({ queryKey: ["message-templates"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (templatesQuery.isLoading) return <LoadingState />;
  if (templatesQuery.isError)
    return (
      <ErrorState
        message={errorMessage(templatesQuery.error)}
        onRetry={() => void templatesQuery.refetch()}
      />
    );

  const templates = templatesQuery.data ?? [];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.messages.subtitle}
      </p>
      <p className="rounded-md bg-accent/50 px-3 py-2 text-xs text-accent-foreground dark:bg-accent/30">
        {t.settings.messages.variablesHint}
      </p>

      {templates.length === 0 ? (
        <EmptyState message={t.settings.messages.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => (
            <li key={template.id}>
              <TemplateCard template={template} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardDescription>{t.settings.messages.newTemplate}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-tpl-name">{t.settings.messages.name}</Label>
            <Input
              id="new-tpl-name"
              value={newName}
              placeholder={t.settings.messages.namePlaceholder}
              onChange={(e) => setNewName(e.target.value)}
              className="max-w-60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-tpl-body">{t.settings.messages.body}</Label>
            <Textarea
              id="new-tpl-body"
              rows={3}
              value={newBody}
              placeholder={t.settings.messages.bodyPlaceholder}
              onChange={(e) => setNewBody(e.target.value)}
            />
          </div>
          <div>
            <Button
              disabled={!newName.trim() || !newBody.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="size-4" />
              {t.settings.messages.newTemplate}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Lost reasons tab

function LostReasonRow({ reason }: { reason: LostReason }) {
  const [label, setLabel] = React.useState(reason.label);
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (body: {
      label?: string;
      is_active?: boolean;
      is_recoverable?: boolean;
    }) => lostReasonsApi.update(reason.id, body),
    onSuccess: () => {
      toast.success(t.settings.lostReasons.updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lostReasons });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Input
        value={label}
        aria-label={t.settings.lostReasons.label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const trimmed = label.trim();
          if (trimmed && trimmed !== reason.label)
            update.mutate({ label: trimmed });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="max-w-xs"
      />
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Switch
            id={`lr-recoverable-${reason.id}`}
            checked={reason.is_recoverable}
            aria-label={t.settings.lostReasons.recoverable}
            onCheckedChange={(checked) =>
              update.mutate({ is_recoverable: checked })
            }
          />
          <Label
            htmlFor={`lr-recoverable-${reason.id}`}
            className="text-xs font-normal text-muted-foreground"
          >
            {t.settings.lostReasons.recoverable}
          </Label>
        </div>
        <Switch
          checked={reason.is_active}
          aria-label={
            reason.is_active ? t.common.deactivate : t.common.activate
          }
          onCheckedChange={(checked) => update.mutate({ is_active: checked })}
        />
      </div>
    </li>
  );
}

function LostReasonsTab() {
  const reasonsQuery = useLostReasons();
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = React.useState("");

  const create = useMutation({
    mutationFn: () => lostReasonsApi.create({ label: newLabel.trim() }),
    onSuccess: () => {
      toast.success(t.settings.lostReasons.created);
      setNewLabel("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.lostReasons });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (reasonsQuery.isLoading) return <LoadingState />;
  if (reasonsQuery.isError)
    return (
      <ErrorState
        message={errorMessage(reasonsQuery.error)}
        onRetry={() => void reasonsQuery.refetch()}
      />
    );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.lostReasons.deactivateHint}{" "}
        {t.settings.lostReasons.recoverableHint}
      </p>
      <ul className="flex flex-col gap-2">
        {(reasonsQuery.data ?? []).map((reason) => (
          <LostReasonRow key={reason.id} reason={reason} />
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="new-reason">{t.settings.lostReasons.label}</Label>
          <Input
            id="new-reason"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </div>
        <Button
          disabled={!newLabel.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.lostReasons.newReason}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Lead sources tab

function webhookUrl(token: string): string {
  return `${API_BASE}/webhooks/leads/${token}`;
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success(t.common.copied);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error(t.errors.generic);
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {t.settings.leadSources.copyUrl}
    </Button>
  );
}

function LeadSourcesTab() {
  const sourcesQuery = useLeadSources();
  const { data: units } = useUnits();
  const queryClient = useQueryClient();
  const [newName, setNewName] = React.useState("");
  const [newUnit, setNewUnit] = React.useState(NONE);

  const create = useMutation({
    mutationFn: () =>
      leadSourcesApi.create({
        name: newName.trim(),
        default_unit_id: newUnit === NONE ? null : newUnit,
      }),
    onSuccess: () => {
      toast.success(t.settings.leadSources.created);
      setNewName("");
      setNewUnit(NONE);
      void queryClient.invalidateQueries({ queryKey: queryKeys.leadSources });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Backend has no reactivation — a source is revoked permanently.
  const revoke = useMutation({
    mutationFn: (id: string) => leadSourcesApi.revoke(id),
    onSuccess: () => {
      toast.success(t.settings.leadSources.revoked);
      void queryClient.invalidateQueries({ queryKey: queryKeys.leadSources });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (sourcesQuery.isLoading) return <LoadingState />;
  if (sourcesQuery.isError)
    return (
      <ErrorState
        message={errorMessage(sourcesQuery.error)}
        onRetry={() => void sourcesQuery.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.settings.leadSources.webhookHint}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-source">{t.settings.leadSources.name}</Label>
          <Input
            id="new-source"
            value={newName}
            placeholder={t.settings.leadSources.namePlaceholder}
            onChange={(e) => setNewName(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t.settings.leadSources.defaultUnit}</Label>
          <Select value={newUnit} onValueChange={setNewUnit}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t.common.none}</SelectItem>
              {(units ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-4" />
          {t.settings.leadSources.newSource}
        </Button>
      </div>

      {(sourcesQuery.data ?? []).length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {(sourcesQuery.data ?? []).map((source) => (
            <Card key={source.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{source.name}</span>
                  <div className="flex items-center gap-2">
                    {source.is_active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={revoke.isPending}
                        title={t.settings.leadSources.revokeHint}
                        onClick={() => revoke.mutate(source.id)}
                      >
                        <Trash2 className="size-3.5" />
                        {t.settings.leadSources.revoke}
                      </Button>
                    ) : (
                      <Badge variant="destructive">
                        {t.settings.leadSources.revokedBadge}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                    {webhookUrl(source.token)}
                  </code>
                  <CopyUrlButton url={webhookUrl(source.token)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- General tab

function GeneralTab() {
  const settingsQuery = useSettings();
  const queryClient = useQueryClient();
  const [coolingDays, setCoolingDays] = React.useState("");

  React.useEffect(() => {
    if (settingsQuery.data) {
      setCoolingDays(String(settingsQuery.data.cooling_days));
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({ cooling_days: Number(coolingDays) }),
    onSuccess: () => {
      toast.success(t.settings.general.saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (settingsQuery.isLoading) return <LoadingState />;
  if (settingsQuery.isError)
    return (
      <ErrorState
        message={errorMessage(settingsQuery.error)}
        onRetry={() => void settingsQuery.refetch()}
      />
    );

  const parsed = Number(coolingDays);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 60;

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardDescription>{t.settings.general.coolingHint}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="cooling-days">{t.settings.general.coolingDays}</Label>
          <Input
            id="cooling-days"
            type="number"
            min={1}
            max={60}
            value={coolingDays}
            onChange={(e) => setCoolingDays(e.target.value)}
          />
        </div>
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Page

export default function SettingsPage() {
  const { isAdmin, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !isAdmin) router.replace("/negociacoes");
  }, [loading, isAdmin, router]);

  if (!isAdmin) return <LoadingState />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">
        {t.settings.title}
      </h1>
      <Tabs defaultValue="users">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="users">{t.settings.tabs.users}</TabsTrigger>
          <TabsTrigger value="units">{t.settings.tabs.units}</TabsTrigger>
          <TabsTrigger value="stages">{t.settings.tabs.stages}</TabsTrigger>
          <TabsTrigger value="messages">{t.settings.tabs.messages}</TabsTrigger>
          <TabsTrigger value="cycles">{t.settings.tabs.cycles}</TabsTrigger>
          <TabsTrigger value="spend">{t.settings.tabs.spend}</TabsTrigger>
          <TabsTrigger value="goals">{t.settings.tabs.goals}</TabsTrigger>
          <TabsTrigger value="objections">
            {t.settings.tabs.objections}
          </TabsTrigger>
          <TabsTrigger value="lost-reasons">
            {t.settings.tabs.lostReasons}
          </TabsTrigger>
          <TabsTrigger value="lead-sources">
            {t.settings.tabs.leadSources}
          </TabsTrigger>
          <TabsTrigger value="general">{t.settings.tabs.general}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="units">
          <UnitsTab />
        </TabsContent>
        <TabsContent value="stages">
          <StagesTab />
        </TabsContent>
        <TabsContent value="messages">
          <MessagesTab />
        </TabsContent>
        <TabsContent value="cycles">
          <CyclesTab />
        </TabsContent>
        <TabsContent value="spend">
          <SpendTab />
        </TabsContent>
        <TabsContent value="goals">
          <GoalsTab />
        </TabsContent>
        <TabsContent value="objections">
          <ObjectionsTab />
        </TabsContent>
        <TabsContent value="lost-reasons">
          <LostReasonsTab />
        </TabsContent>
        <TabsContent value="lead-sources">
          <LeadSourcesTab />
        </TabsContent>
        <TabsContent value="general">
          <GeneralTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
