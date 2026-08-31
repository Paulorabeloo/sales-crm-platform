"use client";

import * as React from "react";
import { MessageCircle, Pencil, Plus, Search } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCreateContact, useUpdateContact } from "@/hooks/mutations";
import { useContacts } from "@/hooks/queries";
import { errorMessage } from "@/lib/api/client";
import type { Contact } from "@/lib/api/types";
import { contactSchema, type ContactInput } from "@/lib/schemas";
import { t } from "@/lib/strings";
import { waLink } from "@/lib/utils";

function ContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();

  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      phone_whatsapp: "",
      email: "",
      city: "",
      notes: "",
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: contact?.name ?? "",
        phone_whatsapp: contact?.phone_whatsapp ?? "",
        email: contact?.email ?? "",
        city: contact?.city ?? "",
        notes: contact?.notes ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact]);

  function onSubmit(values: ContactInput) {
    const body = {
      name: values.name,
      phone_whatsapp: values.phone_whatsapp,
      email: values.email || null,
      city: values.city || null,
      notes: values.notes || null,
    };
    if (contact) {
      updateContact.mutate(
        { id: contact.id, body },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createContact.mutate(body, { onSuccess: () => onOpenChange(false) });
    }
  }

  const pending = createContact.isPending || updateContact.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {contact ? t.contacts.editContact : t.contacts.newContact}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-name">{t.contacts.name}</Label>
            <Input id="ct-name" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-phone">{t.contacts.phone}</Label>
            <Input
              id="ct-phone"
              type="tel"
              placeholder={t.contacts.phonePlaceholder}
              {...form.register("phone_whatsapp")}
            />
            {form.formState.errors.phone_whatsapp && (
              <p className="text-xs text-destructive">
                {form.formState.errors.phone_whatsapp.message}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-email">{t.contacts.email}</Label>
              <Input id="ct-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-city">{t.contacts.city}</Label>
              <Input id="ct-city" {...form.register("city")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-notes">{t.contacts.notes}</Label>
            <Textarea id="ct-notes" {...form.register("notes")} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t.common.saving : t.common.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactsPage() {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [search]);

  const contactsQuery = useContacts(debounced, page);
  const data = contactsQuery.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          {t.contacts.title}
        </h1>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t.contacts.newContact}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.contacts.searchPlaceholder}
          className="pl-8"
          aria-label={t.common.search}
        />
      </div>

      {contactsQuery.isLoading ? (
        <LoadingState />
      ) : contactsQuery.isError ? (
        <ErrorState
          message={errorMessage(contactsQuery.error)}
          onRetry={() => void contactsQuery.refetch()}
        />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState message={t.contacts.empty} />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.contacts.name}</TableHead>
                  <TableHead>{t.contacts.phone}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t.contacts.email}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t.contacts.city}
                  </TableHead>
                  <TableHead className="text-right">
                    {t.common.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">
                      {contact.name}
                    </TableCell>
                    <TableCell>{contact.phone_whatsapp}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {contact.email ?? t.common.none}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {contact.city ?? t.common.none}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.deal.openWhatsApp}
                          asChild
                        >
                          <a
                            href={waLink(contact.phone_whatsapp)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MessageCircle className="size-4 text-[#25D366]" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.common.edit}
                          onClick={() => {
                            setEditing(contact);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t.common.pageOf(page, totalPages)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t.common.previous}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ContactDialog
        contact={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
