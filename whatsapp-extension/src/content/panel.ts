/**
 * Side panel UI, rendered inside a shadow root so host-page CSS never leaks
 * in (and ours never leaks out). Pure DOM, no framework.
 */

import { formatPhoneBR } from "../lib/phone";
import { ACTIVITY_LABELS, STRINGS } from "../lib/strings";
import type { ActivityOut, ContactOut, DealOut, MessageTemplateOut, UnitOut } from "../lib/types";

export interface LeadView {
  contact: ContactOut;
  deal: DealOut | null; // most recent deal (open preferred); null = none at all
  stageName: string | null;
  ownerLabel: string;
  activities: ActivityOut[];
  templates: { template: MessageTemplateOut; rendered: string }[];
  crmUrl: string | null;
}

export interface CreateView {
  name: string;
  phone: string | null; // E.164 or null (manual input shown)
  units: UnitOut[];
}

export type PanelState =
  | { kind: "loggedOut" }
  | { kind: "noConversation" }
  | { kind: "group" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "lead"; view: LeadView }
  | { kind: "create"; view: CreateView };

export interface PanelHandlers {
  onQuickLog(kind: string, visitDateIso?: string): void;
  onScheduleNext(dateIso: string): void;
  onFirstContact(): void;
  onCreateLead(data: { name: string; phone: string; course: string; unitId: string | null }): void;
  onCreateDealForContact(): void;
  onManualPhone(rawPhone: string): void;
}

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
.panel {
  position: fixed; top: 0; right: 0; height: 100vh; width: 340px;
  background: #FFFFFF; color: #1F2937; z-index: 2147483000;
  display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.18);
  transition: transform 0.2s ease; font-size: 13px; line-height: 1.45;
}
.panel.collapsed { transform: translateX(100%); }
.toggle {
  position: fixed; top: 50%; right: 340px; transform: translateY(-50%);
  z-index: 2147483001; background: #F9A11B; color: #1F2937;
  border: none; border-radius: 8px 0 0 8px; padding: 10px 6px;
  cursor: pointer; font-weight: 700; font-size: 12px;
  box-shadow: -2px 2px 8px rgba(0,0,0,0.25); writing-mode: vertical-rl;
  transition: right 0.2s ease;
}
.toggle.collapsed { right: 0; }
.header {
  background: #F9A11B; color: #1F2937; padding: 12px 16px;
  font-weight: 700; font-size: 15px; display: flex; align-items: center;
  justify-content: space-between; flex-shrink: 0;
}
.header .badge { font-size: 11px; font-weight: 600; background: rgba(255,255,255,0.55); border-radius: 999px; padding: 2px 8px; }
.body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.center { text-align: center; color: #6B7280; padding: 32px 8px; }
.center strong { color: #1F2937; display: block; margin-bottom: 6px; }
.section { margin-bottom: 16px; }
.section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9CA3AF; margin-bottom: 6px; }
.card { background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 10px; padding: 12px; }
.lead-name { font-weight: 700; font-size: 15px; }
.lead-phone { color: #6B7280; font-size: 12px; margin-top: 2px; }
.kv { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; }
.kv .k { color: #9CA3AF; }
.kv .v { font-weight: 600; text-align: right; }
.pill { display: inline-block; background: #FEF3C7; color: #92400E; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
.pill.warn { background: #FEE2E2; color: #991B1B; }
.btn {
  display: block; width: 100%; border: none; border-radius: 8px;
  padding: 9px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
  margin-top: 8px; text-align: center; text-decoration: none;
}
.btn.primary { background: #F9A11B; color: #1F2937; }
.btn.primary:hover { background: #E08F0F; }
.btn.secondary { background: #F5F5F4; color: #1F2937; border: 1px solid #E7E5E4; }
.btn.secondary:hover { background: #E7E5E4; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn-row .btn { margin-top: 0; }
.quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick-grid .btn { margin-top: 0; padding: 8px 6px; font-size: 12px; }
.field { margin-top: 8px; }
.field label { display: block; font-size: 11px; font-weight: 600; color: #6B7280; margin-bottom: 3px; }
.field input, .field select {
  width: 100%; border: 1px solid #D6D3D1; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; background: #fff; color: #1F2937;
}
.field input:focus, .field select:focus { outline: 2px solid #F9A11B; outline-offset: 0; border-color: #F9A11B; }
.activity { padding: 6px 0; border-bottom: 1px solid #F0EFED; font-size: 12px; }
.activity:last-child { border-bottom: none; }
.activity .when { color: #9CA3AF; font-size: 11px; }
.template { border: 1px solid #E7E5E4; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: #fff; }
.template .t-name { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
.template .t-body { color: #4B5563; font-size: 12px; white-space: pre-wrap; max-height: 72px; overflow: hidden; }
.template .t-copy { margin-top: 6px; background: #F5F5F4; border: 1px solid #E7E5E4; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }
.template .t-copy:hover { background: #E7E5E4; }
.toast {
  position: absolute; bottom: 14px; left: 16px; right: 16px;
  background: #1F2937; color: #fff; border-radius: 8px; padding: 9px 12px;
  font-size: 12px; text-align: center; opacity: 0; transition: opacity 0.2s;
  pointer-events: none;
}
.toast.show { opacity: 1; }
.error-text { color: #B91C1C; font-size: 12px; margin-top: 6px; }
.muted { color: #9CA3AF; font-size: 12px; }
.inline-form { margin-top: 8px; display: none; }
.inline-form.open { display: block; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

/** datetime-local value -> ISO string (local timezone preserved). */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export class Panel {
  private readonly shadow: ShadowRoot;
  private readonly bodyEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private collapsed = false;

  constructor(private readonly handlers: PanelHandlers) {
    const host = document.createElement("div");
    host.id = "crm-lead-capture-root";
    this.shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    this.shadow.appendChild(style);

    this.toggleEl = el("button", "toggle");
    this.toggleEl.textContent = STRINGS.panelTitle;
    this.toggleEl.title = STRINGS.panelCollapse;
    this.toggleEl.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    this.shadow.appendChild(this.toggleEl);

    this.panelEl = el("div", "panel");
    const header = el("div", "header");
    header.appendChild(el("span", undefined, STRINGS.appName));
    this.panelEl.appendChild(header);

    this.bodyEl = el("div", "body");
    this.panelEl.appendChild(this.bodyEl);

    this.toastEl = el("div", "toast");
    this.panelEl.appendChild(this.toastEl);

    this.shadow.appendChild(this.panelEl);
    document.documentElement.appendChild(host);
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.panelEl.classList.toggle("collapsed", collapsed);
    this.toggleEl.classList.toggle("collapsed", collapsed);
    this.toggleEl.title = collapsed ? STRINGS.panelExpand : STRINGS.panelCollapse;
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    window.setTimeout(() => this.toastEl.classList.remove("show"), 2500);
  }

  render(state: PanelState): void {
    this.bodyEl.replaceChildren();
    switch (state.kind) {
      case "loggedOut":
        this.renderCenter(STRINGS.notLoggedIn, STRINGS.notLoggedInHint);
        break;
      case "noConversation":
        this.renderCenter(STRINGS.noConversation);
        break;
      case "group":
        this.renderCenter(STRINGS.groupConversation);
        break;
      case "loading":
        this.renderCenter(STRINGS.searching);
        break;
      case "error":
        this.renderCenter(STRINGS.errorGeneric, state.message);
        break;
      case "lead":
        this.renderLead(state.view);
        break;
      case "create":
        this.renderCreate(state.view);
        break;
    }
  }

  private renderCenter(title: string, hint?: string): void {
    const box = el("div", "center");
    box.appendChild(el("strong", undefined, title));
    if (hint) box.appendChild(el("div", "muted", hint));
    this.bodyEl.appendChild(box);
  }

  // --- Lead card --------------------------------------------------------------

  private renderLead(view: LeadView): void {
    const card = el("div", "card");
    card.appendChild(el("div", "lead-name", view.contact.name));
    card.appendChild(el("div", "lead-phone", formatPhoneBR(view.contact.phone_whatsapp)));

    const deal = view.deal;
    if (deal) {
      this.appendKv(card, STRINGS.stageLabel, view.stageName ?? "");
      this.appendKv(card, STRINGS.ownerLabel, view.ownerLabel);
      const nextValue = deal.next_contact_at
        ? formatDateTime(deal.next_contact_at)
        : STRINGS.nextContactNone;
      this.appendKv(card, STRINGS.nextContactLabel, nextValue);
      if (deal.status === "won") card.appendChild(el("div", "pill", STRINGS.dealClosedWon));
      if (deal.status === "lost") card.appendChild(el("div", "pill warn", STRINGS.dealClosedLost));
    } else {
      card.appendChild(el("div", "muted", STRINGS.contactNoOpenDeal));
      const createBtn = el("button", "btn primary", STRINGS.createDealForContact);
      createBtn.addEventListener("click", () => this.handlers.onCreateDealForContact());
      card.appendChild(createBtn);
    }
    if (view.crmUrl) {
      const link = el("a", "btn secondary", STRINGS.openInCrm);
      link.setAttribute("href", view.crmUrl);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      card.appendChild(link);
    }
    this.bodyEl.appendChild(card);

    if (deal && deal.status === "open") {
      this.renderQuickLog(deal);
      this.renderSchedule();
      this.renderFirstContact(deal);
    }
    this.renderActivities(view.activities);
    this.renderTemplates(view.templates);
  }

  private appendKv(parent: HTMLElement, key: string, value: string): void {
    const row = el("div", "kv");
    row.appendChild(el("span", "k", key));
    row.appendChild(el("span", "v", value));
    parent.appendChild(row);
  }

  private renderQuickLog(deal: DealOut): void {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", STRINGS.quickLogTitle));
    const grid = el("div", "quick-grid");

    const simpleKinds: [string, string][] = [
      ["attempt_no_answer", STRINGS.quickLogAttempt],
      ["talked_advance", STRINGS.quickLogAdvance],
      ["talked_objection", STRINGS.quickLogObjection],
    ];
    for (const [kind, label] of simpleKinds) {
      const btn = el("button", "btn secondary", label);
      btn.addEventListener("click", () => this.handlers.onQuickLog(kind));
      grid.appendChild(btn);
    }

    // visit_scheduled requires the visit date (backend 422 without it).
    const visitBtn = el("button", "btn secondary", STRINGS.quickLogVisit);
    grid.appendChild(visitBtn);
    section.appendChild(grid);

    const visitForm = el("div", "inline-form");
    const field = el("div", "field");
    const label = el("label", undefined, STRINGS.visitDateLabel);
    const input = el("input");
    input.type = "datetime-local";
    field.appendChild(label);
    field.appendChild(input);
    visitForm.appendChild(field);
    const confirm = el("button", "btn primary", STRINGS.quickLogVisit);
    confirm.addEventListener("click", () => {
      const iso = localInputToIso(input.value);
      if (!iso) {
        this.toast(STRINGS.quickLogVisitNeedsDate);
        return;
      }
      this.handlers.onQuickLog("visit_scheduled", iso);
    });
    visitForm.appendChild(confirm);
    section.appendChild(visitForm);
    visitBtn.addEventListener("click", () => visitForm.classList.toggle("open"));

    this.bodyEl.appendChild(section);
  }

  private renderSchedule(): void {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", STRINGS.scheduleNextTitle));
    const field = el("div", "field");
    const label = el("label", undefined, STRINGS.scheduleDateLabel);
    const input = el("input");
    input.type = "datetime-local";
    field.appendChild(label);
    field.appendChild(input);
    section.appendChild(field);
    const btn = el("button", "btn primary", STRINGS.scheduleNextButton);
    btn.addEventListener("click", () => {
      const iso = localInputToIso(input.value);
      if (!iso) {
        this.toast(STRINGS.scheduleNeedsDate);
        return;
      }
      this.handlers.onScheduleNext(iso);
    });
    section.appendChild(btn);
    this.bodyEl.appendChild(section);
  }

  private renderFirstContact(deal: DealOut): void {
    const section = el("div", "section");
    if (deal.first_whatsapp_contact_at) {
      const done = el("div", "muted");
      done.textContent = `${STRINGS.firstContactDone}: ${formatDateTime(deal.first_whatsapp_contact_at)}`;
      section.appendChild(done);
    } else {
      const btn = el("button", "btn primary", STRINGS.firstContactButton);
      btn.addEventListener("click", () => this.handlers.onFirstContact());
      section.appendChild(btn);
    }
    this.bodyEl.appendChild(section);
  }

  private renderActivities(activities: ActivityOut[]): void {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", STRINGS.lastActivitiesLabel));
    const card = el("div", "card");
    if (activities.length === 0) {
      card.appendChild(el("div", "muted", STRINGS.noActivities));
    } else {
      for (const activity of activities) {
        const row = el("div", "activity");
        const label = ACTIVITY_LABELS[activity.type] ?? activity.type;
        row.appendChild(el("div", undefined, activity.body ? `${label}: ${activity.body}` : label));
        row.appendChild(el("div", "when", formatDateTime(activity.created_at)));
        card.appendChild(row);
      }
    }
    section.appendChild(card);
    this.bodyEl.appendChild(section);
  }

  private renderTemplates(templates: LeadView["templates"]): void {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", STRINGS.templatesTitle));
    if (templates.length === 0) {
      section.appendChild(el("div", "muted", STRINGS.templatesEmpty));
    }
    for (const { template, rendered } of templates) {
      const box = el("div", "template");
      box.appendChild(el("div", "t-name", template.name));
      box.appendChild(el("div", "t-body", rendered));
      const copyBtn = el("button", "t-copy", STRINGS.copy);
      copyBtn.addEventListener("click", () => {
        navigator.clipboard
          .writeText(rendered)
          .then(() => this.toast(STRINGS.copied))
          .catch(() => this.toast(STRINGS.errorGeneric));
      });
      box.appendChild(copyBtn);
      section.appendChild(box);
    }
    this.bodyEl.appendChild(section);
  }

  // --- Create lead form -------------------------------------------------------

  private renderCreate(view: CreateView): void {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", STRINGS.createLeadTitle));
    const card = el("div", "card");

    if (!view.phone) {
      card.appendChild(el("div", "muted", STRINGS.noPhoneDetected));
      card.appendChild(el("div", "muted", STRINGS.noPhoneHint));
    }

    const nameField = el("div", "field");
    nameField.appendChild(el("label", undefined, STRINGS.nameLabel));
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.value = view.name;
    nameField.appendChild(nameInput);
    card.appendChild(nameField);

    let phoneInput: HTMLInputElement | null = null;
    if (view.phone) {
      const phoneRow = el("div", "lead-phone", formatPhoneBR(view.phone));
      card.appendChild(phoneRow);
    } else {
      const phoneField = el("div", "field");
      phoneField.appendChild(el("label", undefined, STRINGS.phoneManualLabel));
      phoneInput = el("input");
      phoneInput.type = "tel";
      phoneInput.placeholder = "63 99999 0001";
      phoneField.appendChild(phoneInput);
      card.appendChild(phoneField);
    }

    const courseField = el("div", "field");
    courseField.appendChild(el("label", undefined, STRINGS.courseLabel));
    const courseInput = el("input");
    courseInput.type = "text";
    courseField.appendChild(courseInput);
    card.appendChild(courseField);

    const unitField = el("div", "field");
    unitField.appendChild(el("label", undefined, STRINGS.unitLabel));
    const unitSelect = el("select");
    const noneOption = el("option", undefined, STRINGS.unitNone);
    noneOption.value = "";
    unitSelect.appendChild(noneOption);
    for (const unit of view.units.filter((u) => u.is_active)) {
      const option = el("option", undefined, unit.name);
      option.value = unit.id;
      unitSelect.appendChild(option);
    }
    unitField.appendChild(unitSelect);
    card.appendChild(unitField);

    const errorText = el("div", "error-text");
    card.appendChild(errorText);

    const submit = el("button", "btn primary", STRINGS.createLeadSubmit);
    submit.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorText.textContent = STRINGS.nameRequired;
        return;
      }
      const phone = view.phone ?? phoneInput?.value.trim() ?? "";
      if (!phone) {
        errorText.textContent = STRINGS.phoneInvalid;
        return;
      }
      errorText.textContent = "";
      submit.textContent = STRINGS.creating;
      (submit as HTMLButtonElement).disabled = true;
      this.handlers.onCreateLead({
        name,
        phone,
        course: courseInput.value.trim(),
        unitId: unitSelect.value || null,
      });
    });
    card.appendChild(submit);

    section.appendChild(card);
    this.bodyEl.appendChild(section);
  }
}
