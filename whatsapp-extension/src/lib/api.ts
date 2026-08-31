/**
 * Typed API client for content scripts and the popup. Every call is proxied
 * through the background service worker (see messages.ts).
 */

import { sendToBackground, type AuthState, type BgResponse, type ExtensionConfig } from "./messages";
import type {
  ActivityOut,
  ContactOut,
  DealOut,
  MessageTemplateOut,
  Page,
  PipelineOut,
  QuickLogKind,
  QuickLogOut,
  UnitOut,
} from "./types";

function get<T>(path: string): Promise<BgResponse<T>> {
  return sendToBackground<T>({ type: "apiFetch", method: "GET", path });
}

function post<T>(path: string, body?: unknown): Promise<BgResponse<T>> {
  return sendToBackground<T>({ type: "apiFetch", method: "POST", path, body });
}

function patch<T>(path: string, body: unknown): Promise<BgResponse<T>> {
  return sendToBackground<T>({ type: "apiFetch", method: "PATCH", path, body });
}

export const api = {
  // Auth / config
  login: (email: string, password: string) =>
    sendToBackground<AuthState>({ type: "login", email, password }),
  logout: () => sendToBackground<null>({ type: "logout" }),
  getAuthState: () => sendToBackground<AuthState>({ type: "getAuthState" }),
  getConfig: () => sendToBackground<ExtensionConfig>({ type: "getConfig" }),
  setConfig: (config: ExtensionConfig) => sendToBackground<null>({ type: "setConfig", config }),

  // Contacts
  searchContactsByPhone: (phone: string) =>
    get<Page<ContactOut>>(`/api/v1/contacts?q=${encodeURIComponent(phone)}&page_size=5`),
  createContact: (body: { name: string; phone_whatsapp: string }) =>
    post<ContactOut>("/api/v1/contacts", body),
  getContact: (id: string) => get<ContactOut>(`/api/v1/contacts/${id}`),

  // Deals
  listDealsByContact: (contactId: string) =>
    get<Page<DealOut>>(
      `/api/v1/deals?contact_id=${contactId}&sort=-created_at&page_size=10`,
    ),
  createDeal: (body: {
    title: string;
    contact_id: string;
    unit_id?: string;
    owner_id?: string;
    source?: string;
    enrollment_data?: Record<string, unknown>;
  }) => post<DealOut>("/api/v1/deals", body),
  quickLog: (dealId: string, kind: QuickLogKind, nextContactAt?: string) =>
    post<QuickLogOut>(`/api/v1/deals/${dealId}/log`, {
      kind,
      ...(nextContactAt ? { next_contact_at: nextContactAt } : {}),
    }),
  registerFirstContact: (dealId: string) =>
    post<DealOut>(`/api/v1/deals/${dealId}/first-contact`, {}),
  scheduleNextContact: (dealId: string, nextContactAt: string) =>
    patch<DealOut>(`/api/v1/deals/${dealId}`, { next_contact_at: nextContactAt }),
  listActivities: (dealId: string, pageSize = 3) =>
    get<Page<ActivityOut>>(`/api/v1/deals/${dealId}/activities?page_size=${pageSize}`),

  // Catalogs
  listUnits: () => get<UnitOut[]>("/api/v1/units"),
  listPipelines: () => get<PipelineOut[]>("/api/v1/pipelines"),
  listTemplates: () => get<MessageTemplateOut[]>("/api/v1/message-templates"),
};
