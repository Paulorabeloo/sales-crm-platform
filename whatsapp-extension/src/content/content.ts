/**
 * Content-script entry point: picks the surface adapter, mounts the panel,
 * and orchestrates the lookup flow (phone -> contact -> deal -> card).
 */

import { api } from "../lib/api";
import type { BgError } from "../lib/messages";
import { firstName, looksLikePhone, normalizePhone } from "../lib/phone";
import { STRINGS } from "../lib/strings";
import { renderTemplate } from "../lib/template";
import type {
  ContactOut,
  DealOut,
  Me,
  MessageTemplateOut,
  PipelineOut,
  UnitOut,
} from "../lib/types";
import type { ConversationInfo, SurfaceAdapter } from "./adapter";
import { Panel, type LeadView } from "./panel";
import { customInboxAdapter } from "./custom-inbox-dom";
import { whatsAppAdapter } from "./wa-dom";

const ADAPTERS: SurfaceAdapter[] = [whatsAppAdapter, customInboxAdapter];

interface Catalogs {
  me: Me;
  units: UnitOut[];
  pipelines: PipelineOut[];
  templates: MessageTemplateOut[];
  crmBase: string;
}

let catalogs: Catalogs | null = null;
let currentConversation: ConversationInfo | null = null;
/** Monotonic token so stale async lookups never overwrite newer state. */
let lookupSeq = 0;

function errorMessage(error: BgError): string {
  if (error.status === 0) return STRINGS.errorNetwork;
  if (error.status === 401 || error.code === "not_logged_in") return STRINGS.errorUnauthorized;
  return error.detail || STRINGS.errorGeneric;
}

async function loadCatalogs(): Promise<Catalogs | BgError> {
  if (catalogs) return catalogs;
  const [meRes, unitsRes, pipelinesRes, templatesRes, configRes] = await Promise.all([
    sendMe(),
    api.listUnits(),
    api.listPipelines(),
    api.listTemplates(),
    api.getConfig(),
  ]);
  if (!meRes.ok) return meRes.error;
  if (!unitsRes.ok) return unitsRes.error;
  if (!pipelinesRes.ok) return pipelinesRes.error;
  if (!templatesRes.ok) return templatesRes.error;
  const crmBase = configRes.ok ? configRes.data.crmBase : "http://localhost:3000";
  catalogs = {
    me: meRes.data,
    units: unitsRes.data,
    pipelines: pipelinesRes.data,
    templates: templatesRes.data,
    crmBase,
  };
  return catalogs;
}

async function sendMe() {
  const state = await api.getAuthState();
  if (!state.ok) return state;
  if (!state.data.loggedIn || !state.data.user) {
    return {
      ok: false as const,
      error: { status: 401, code: "not_logged_in", detail: "Not logged in" },
    };
  }
  return { ok: true as const, data: state.data.user };
}

function stageNameFor(deal: DealOut, pipelines: PipelineOut[]): string | null {
  for (const pipeline of pipelines) {
    const stage = pipeline.stages.find((s) => s.id === deal.stage_id);
    if (stage) return stage.name;
  }
  return null;
}

function ownerLabelFor(deal: DealOut, me: Me): string {
  if (deal.owner_id === null) return STRINGS.ownerQueue;
  if (deal.owner_id === me.id) return STRINGS.ownerYou;
  return STRINGS.ownerOther;
}

function buildTemplates(
  templates: MessageTemplateOut[],
  contact: ContactOut | null,
  deal: DealOut | null,
  cat: Catalogs,
): LeadView["templates"] {
  const unitName = deal?.unit_id
    ? (cat.units.find((u) => u.id === deal.unit_id)?.name ?? "")
    : "";
  const vars = {
    first_name: firstName(contact?.name ?? currentConversation?.name ?? ""),
    course: String(deal?.enrollment_data?.["interest_course"] ?? ""),
    unit: unitName,
    consultant: cat.me.name,
  };
  return templates.map((template) => ({
    template,
    rendered: renderTemplate(template.body, vars),
  }));
}

/** Prefer the newest open deal; fall back to the newest deal of any status. */
function pickDeal(deals: DealOut[]): DealOut | null {
  return deals.find((d) => d.status === "open") ?? deals[0] ?? null;
}

async function buildLeadView(contact: ContactOut, cat: Catalogs): Promise<LeadView | BgError> {
  const dealsRes = await api.listDealsByContact(contact.id);
  if (!dealsRes.ok) return dealsRes.error;
  const deal = pickDeal(dealsRes.data.items);

  let activities: LeadView["activities"] = [];
  if (deal) {
    const activitiesRes = await api.listActivities(deal.id, 3);
    if (activitiesRes.ok) activities = activitiesRes.data.items;
  }
  return {
    contact,
    deal,
    stageName: deal ? stageNameFor(deal, cat.pipelines) : null,
    ownerLabel: deal ? ownerLabelFor(deal, cat.me) : "",
    activities,
    templates: buildTemplates(cat.templates, contact, deal, cat),
    crmUrl: deal ? `${cat.crmBase}/negociacoes/${deal.id}` : null,
  };
}

async function refresh(panel: Panel): Promise<void> {
  const seq = ++lookupSeq;
  const conversation = currentConversation;

  const authState = await api.getAuthState();
  if (seq !== lookupSeq) return;
  if (!authState.ok || !authState.data.loggedIn) {
    panel.render({ kind: "loggedOut" });
    return;
  }

  if (!conversation) {
    panel.render({ kind: "noConversation" });
    return;
  }
  if (conversation.isGroup) {
    panel.render({ kind: "group" });
    return;
  }

  panel.render({ kind: "loading" });
  const cat = await loadCatalogs();
  if (seq !== lookupSeq) return;
  if (!("me" in cat)) {
    panel.render({ kind: "error", message: errorMessage(cat) });
    return;
  }

  if (!conversation.phone) {
    panel.render({
      kind: "create",
      view: {
        name: conversation.name && !looksLikePhone(conversation.name) ? conversation.name : "",
        phone: null,
        units: cat.units,
      },
    });
    return;
  }

  const searchRes = await api.searchContactsByPhone(conversation.phone);
  if (seq !== lookupSeq) return;
  if (!searchRes.ok) {
    panel.render({ kind: "error", message: errorMessage(searchRes.error) });
    return;
  }
  const exact = searchRes.data.items.find((c) => c.phone_whatsapp === conversation.phone);
  if (!exact) {
    panel.render({
      kind: "create",
      view: {
        name: conversation.name && !looksLikePhone(conversation.name) ? conversation.name : "",
        phone: conversation.phone,
        units: cat.units,
      },
    });
    return;
  }

  const view = await buildLeadView(exact, cat);
  if (seq !== lookupSeq) return;
  if (!("contact" in view)) {
    panel.render({ kind: "error", message: errorMessage(view) });
    return;
  }
  panel.render({ kind: "lead", view });
}

/** Re-fetch the current lead after a mutation (quick log, schedule, ...). */
async function refreshAfterAction(panel: Panel, toast?: string): Promise<void> {
  if (toast) panel.toast(toast);
  await refresh(panel);
}

function mount(adapter: SurfaceAdapter): void {
  let panel: Panel;

  const handlers = {
    async onQuickLog(kind: string, visitDateIso?: string) {
      const view = await currentDeal();
      if (!view) return;
      const result = await api.quickLog(
        view.id,
        kind as "attempt_no_answer",
        visitDateIso,
      );
      if (!result.ok) {
        panel.toast(errorMessage(result.error));
        return;
      }
      await refreshAfterAction(panel, STRINGS.quickLogSaved);
    },
    async onScheduleNext(dateIso: string) {
      const view = await currentDeal();
      if (!view) return;
      const result = await api.scheduleNextContact(view.id, dateIso);
      if (!result.ok) {
        panel.toast(errorMessage(result.error));
        return;
      }
      await refreshAfterAction(panel, STRINGS.scheduleSaved);
    },
    async onFirstContact() {
      const view = await currentDeal();
      if (!view) return;
      const result = await api.registerFirstContact(view.id);
      if (!result.ok) {
        panel.toast(errorMessage(result.error));
        return;
      }
      await refreshAfterAction(panel, STRINGS.firstContactSaved);
    },
    async onCreateLead(data: { name: string; phone: string; course: string; unitId: string | null }) {
      const normalized = normalizePhone(data.phone);
      if (!normalized) {
        panel.toast(STRINGS.phoneInvalid);
        await refresh(panel);
        return;
      }
      const cat = catalogs;
      if (!cat) return;

      let contactId: string;
      const contactRes = await api.createContact({
        name: data.name,
        phone_whatsapp: normalized,
      });
      if (contactRes.ok) {
        contactId = contactRes.data.id;
      } else if (
        contactRes.error.code === "duplicate_phone" &&
        typeof contactRes.error.extras?.["existing_contact_id"] === "string"
      ) {
        // Dedupe: reuse the existing contact and show it.
        panel.toast(STRINGS.duplicatePhone);
        contactId = contactRes.error.extras["existing_contact_id"];
      } else {
        panel.toast(errorMessage(contactRes.error));
        await refresh(panel);
        return;
      }

      const dealRes = await api.createDeal({
        title: data.name,
        contact_id: contactId,
        owner_id: cat.me.id,
        source: "whatsapp",
        ...(data.unitId ? { unit_id: data.unitId } : {}),
        ...(data.course ? { enrollment_data: { interest_course: data.course } } : {}),
      });
      if (!dealRes.ok) {
        panel.toast(errorMessage(dealRes.error));
        await refresh(panel);
        return;
      }
      // Ensure the panel's conversation phone matches what we just created,
      // so the refreshed lookup finds the new lead.
      if (currentConversation && !currentConversation.phone) {
        currentConversation = { ...currentConversation, phone: normalized };
      }
      await refreshAfterAction(panel, STRINGS.leadCreated);
    },
    async onCreateDealForContact() {
      // Contact exists, no deal: reuse the create flow prefilled from CRM data.
      const conversation = currentConversation;
      if (!conversation?.phone || !catalogs) return;
      const searchRes = await api.searchContactsByPhone(conversation.phone);
      if (!searchRes.ok) {
        panel.toast(errorMessage(searchRes.error));
        return;
      }
      const exact = searchRes.data.items.find((c) => c.phone_whatsapp === conversation.phone);
      if (!exact) return;
      const dealRes = await api.createDeal({
        title: exact.name,
        contact_id: exact.id,
        owner_id: catalogs.me.id,
        source: "whatsapp",
      });
      if (!dealRes.ok) {
        panel.toast(errorMessage(dealRes.error));
        return;
      }
      await refreshAfterAction(panel, STRINGS.leadCreated);
    },
    async onManualPhone(rawPhone: string) {
      const normalized = normalizePhone(rawPhone);
      if (!normalized) {
        panel.toast(STRINGS.phoneInvalid);
        return;
      }
      if (currentConversation) {
        currentConversation = { ...currentConversation, phone: normalized };
      }
      await refresh(panel);
    },
  };

  /** Resolve the deal currently shown (re-lookup by conversation phone). */
  async function currentDeal(): Promise<DealOut | null> {
    const conversation = currentConversation;
    if (!conversation?.phone) return null;
    const searchRes = await api.searchContactsByPhone(conversation.phone);
    if (!searchRes.ok) return null;
    const exact = searchRes.data.items.find((c) => c.phone_whatsapp === conversation.phone);
    if (!exact) return null;
    const dealsRes = await api.listDealsByContact(exact.id);
    if (!dealsRes.ok) return null;
    return pickDeal(dealsRes.data.items);
  }

  panel = new Panel(handlers);
  currentConversation = adapter.getOpenConversation();
  void refresh(panel);

  adapter.onConversationChange((conversation) => {
    currentConversation = conversation;
    catalogsStale();
    void refresh(panel);
  });

  // React to login/logout done through the popup.
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "session") {
      catalogs = null;
      void refresh(panel);
    }
  });
}

/** Catalogs are cached per login; conversation switches keep them. */
function catalogsStale(): void {
  // Intentionally a no-op today: catalogs only depend on the session.
}

const adapter = ADAPTERS.find((a) => a.detect());
if (adapter) {
  if (adapter.surface === "custom-inbox") {
    console.info(`[CRM Lead Capture] ${STRINGS.inboxNotConfigured}`);
  }
  mount(adapter);
}
