import { api, ApiError } from "./client";
import type {
  Activity,
  AppSettings,
  CacReport,
  CampaignSpend,
  Contact,
  ConversationsReport,
  CoolingReport,
  Cycle,
  Deal,
  DealFieldDef,
  FunnelReport,
  Goal,
  GoalProgressResponse,
  KanbanResponse,
  LeadSource,
  LostReason,
  LostReasonsReport,
  MessageTemplate,
  MyDayResponse,
  MyTasksResponse,
  Objection,
  Paginated,
  Pipeline,
  QuickLogKind,
  QuickLogResponse,
  RecoverableDealsResponse,
  Unit,
  ReportFilters,
  ReportSummary,
  ResponseTimeReport,
  SalesReport,
  Stage,
  TaskItem,
  User,
} from "./types";

// ---------- Auth ----------

/** POST /auth/login — the user profile comes from a follow-up GET /auth/me. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export const authApi = {
  login: (email: string, password: string) =>
    api<TokenResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      anonymous: true,
    }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  me: () => api<User>("/auth/me"),
};

// ---------- Catalogs ----------

export const unitsApi = {
  list: () => api<Unit[]>("/units"),
  create: (body: { name: string }) =>
    api<Unit>("/units", { method: "POST", body }),
  update: (id: string, body: Partial<Pick<Unit, "name" | "is_active">>) =>
    api<Unit>(`/units/${id}`, { method: "PATCH", body }),
};

export const pipelinesApi = {
  list: () => api<Pipeline[]>("/pipelines"),
  /** Backend requires an explicit unique sort_order (appended after the last). */
  createStage: (
    pipelineId: string,
    body: { name: string; sort_order: number },
  ) => api<Stage>(`/pipelines/${pipelineId}/stages`, { method: "POST", body }),
  updateStage: (
    stageId: string,
    body: {
      name?: string;
      sort_order?: number;
      required_fields?: string[];
      /** null explicitly clears the playbook. */
      playbook?: string | null;
    },
  ) => api<Stage>(`/stages/${stageId}`, { method: "PATCH", body }),
  deleteStage: (stageId: string) =>
    api<void>(`/stages/${stageId}`, { method: "DELETE" }),
};

export const lostReasonsApi = {
  list: () => api<LostReason[]>("/lost-reasons"),
  create: (body: { label: string; is_recoverable?: boolean }) =>
    api<LostReason>("/lost-reasons", { method: "POST", body }),
  update: (
    id: string,
    body: { label?: string; is_active?: boolean; is_recoverable?: boolean },
  ) => api<LostReason>(`/lost-reasons/${id}`, { method: "PATCH", body }),
};

// ---------- Cycles (wave 2) ----------

export const cyclesApi = {
  list: () => api<Cycle[]>("/cycles"),
  /** 404 no_active_cycle when none is active — callers treat it as null. */
  active: () => api<Cycle>("/cycles/active"),
  create: (body: {
    name: string;
    starts_on: string;
    deadline_on?: string | null;
    is_active?: boolean;
  }) => api<Cycle>("/cycles", { method: "POST", body }),
  update: (
    id: string,
    body: {
      name?: string;
      starts_on?: string;
      /** null explicitly clears the deadline. */
      deadline_on?: string | null;
    },
  ) => api<Cycle>(`/cycles/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/cycles/${id}`, { method: "DELETE" }),
  activate: (id: string) =>
    api<Cycle>(`/cycles/${id}/activate`, { method: "POST" }),
  /** Moves the OPEN deals of cycle {id} into the active cycle. */
  rollover: (id: string) =>
    api<{ from_cycle_id: string; to_cycle_id: string; moved_count: number }>(
      `/cycles/${id}/rollover`,
      { method: "POST" },
    ),
};

// ---------- Campaign spend (wave 2, admin) ----------

export const campaignSpendApi = {
  list: (params?: { month_from?: string; month_to?: string }) =>
    api<CampaignSpend[]>("/campaign-spend", {
      query: { month_from: params?.month_from, month_to: params?.month_to },
    }),
  create: (body: {
    month: string;
    source: string;
    campaign?: string | null;
    unit_id?: string | null;
    amount: number;
  }) => api<CampaignSpend>("/campaign-spend", { method: "POST", body }),
  /** Only the amount is editable; identity changes are delete + recreate. */
  update: (id: string, amount: number) =>
    api<CampaignSpend>(`/campaign-spend/${id}`, {
      method: "PATCH",
      body: { amount },
    }),
  remove: (id: string) =>
    api<void>(`/campaign-spend/${id}`, { method: "DELETE" }),
};

// ---------- Goals (wave 2) ----------

export const goalsApi = {
  list: (cycleId?: string) =>
    api<Goal[]>("/goals", { query: { cycle_id: cycleId } }),
  create: (body: {
    cycle_id: string;
    scope: "consultant" | "unit";
    target_user_id?: string;
    unit_id?: string;
    target_count: number;
  }) => api<Goal>("/goals", { method: "POST", body }),
  update: (id: string, targetCount: number) =>
    api<Goal>(`/goals/${id}`, {
      method: "PATCH",
      body: { target_count: targetCount },
    }),
  remove: (id: string) => api<void>(`/goals/${id}`, { method: "DELETE" }),
  /** Admin ranking (default: active cycle). */
  progress: (cycleId?: string) =>
    api<GoalProgressResponse>("/goals/progress", {
      query: { cycle_id: cycleId },
    }),
  /** Consultant-scoped goals of the logged-in user only. */
  myProgress: (cycleId?: string) =>
    api<GoalProgressResponse>("/goals/my-progress", {
      query: { cycle_id: cycleId },
    }),
};

// ---------- Objections (wave 2) ----------

export const objectionsApi = {
  list: (includeInactive = false) =>
    api<Objection[]>("/objections", {
      query: { include_inactive: includeInactive ? true : undefined },
    }),
  create: (body: {
    name: string;
    rebuttal: string;
    template_id?: string | null;
    sort_order?: number;
  }) => api<Objection>("/objections", { method: "POST", body }),
  update: (
    id: string,
    body: {
      name?: string;
      rebuttal?: string;
      /** null explicitly unlinks the template. */
      template_id?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ) => api<Objection>(`/objections/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/objections/${id}`, { method: "DELETE" }),
};

export const leadSourcesApi = {
  list: () => api<LeadSource[]>("/lead-sources"),
  create: (body: { name: string; default_unit_id?: string | null }) =>
    api<LeadSource>("/lead-sources", { method: "POST", body }),
  update: (id: string, body: { name?: string }) =>
    api<LeadSource>(`/lead-sources/${id}`, { method: "PATCH", body }),
  /** Permanently revokes the webhook token (no reactivation). */
  revoke: (id: string) =>
    api<LeadSource>(`/lead-sources/${id}/revoke`, { method: "POST" }),
  rotateToken: (id: string) =>
    api<LeadSource>(`/lead-sources/${id}/rotate-token`, { method: "POST" }),
};

export const settingsApi = {
  get: () => api<AppSettings>("/settings"),
  update: (body: Partial<AppSettings>) =>
    api<AppSettings>("/settings", { method: "PATCH", body }),
};

/** GET /deal-fields — catalog of required-field keys (labels in strings.ts). */
export const dealFieldsApi = {
  list: () => api<DealFieldDef[]>("/deal-fields"),
};

export const myDayApi = {
  /** Admin may pass owner_id to see one consultant's view. */
  get: (ownerId?: string) =>
    api<MyDayResponse>("/my-day", { query: { owner_id: ownerId } }),
};

export const messageTemplatesApi = {
  /** Active templates; include_inactive=true (admin) for the settings CRUD. */
  list: (includeInactive = false) =>
    api<MessageTemplate[]>("/message-templates", {
      query: { include_inactive: includeInactive ? true : undefined },
    }),
  create: (body: { name: string; body: string; sort_order?: number }) =>
    api<MessageTemplate>("/message-templates", { method: "POST", body }),
  update: (
    id: string,
    body: {
      name?: string;
      body?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) => api<MessageTemplate>(`/message-templates/${id}`, { method: "PATCH", body }),
  remove: (id: string) =>
    api<void>(`/message-templates/${id}`, { method: "DELETE" }),
};

// ---------- Users ----------

export const usersApi = {
  list: () => api<User[]>("/users"),
  create: (body: {
    name: string;
    email: string;
    password: string;
    role: string;
    unit_id?: string | null;
  }) => api<User>("/users", { method: "POST", body }),
  update: (
    id: string,
    body: {
      name?: string;
      role?: string;
      is_active?: boolean;
      unit_id?: string | null;
    },
  ) => {
    // Backend PATCH semantics: unit_id=null is ambiguous — use clear_unit.
    const { unit_id, ...rest } = body;
    const payload: Record<string, unknown> = { ...rest };
    if (unit_id === null) payload.clear_unit = true;
    else if (unit_id !== undefined) payload.unit_id = unit_id;
    return api<User>(`/users/${id}`, { method: "PATCH", body: payload });
  },
  resetPassword: (id: string, newPassword: string) =>
    api<void>(`/users/${id}/reset-password`, {
      method: "POST",
      body: { new_password: newPassword },
    }),
};

// ---------- Contacts ----------

export const contactsApi = {
  list: (params: { search?: string; page?: number; page_size?: number }) =>
    api<Paginated<Contact>>("/contacts", {
      query: {
        q: params.search,
        page: params.page,
        page_size: params.page_size,
      },
    }),
  create: (body: {
    name: string;
    phone_whatsapp: string;
    email?: string | null;
    city?: string | null;
    notes?: string | null;
  }) => api<Contact>("/contacts", { method: "POST", body }),
  update: (id: string, body: Partial<Omit<Contact, "id" | "created_at">>) =>
    api<Contact>(`/contacts/${id}`, { method: "PATCH", body }),
};

// ---------- Deals ----------

export interface KanbanFilters {
  pipeline_id?: string;
  owner_id?: string;
  status?: string;
  unit_id?: string;
  cooling?: boolean;
  /** Open deals with no FUTURE next_contact_at (backend filter). */
  no_next_step?: boolean;
  /** Wave 2: restrict the board to one sales cycle. */
  cycle_id?: string;
  /** Applied client-side — the backend kanban has no search param. */
  search?: string;
}

export interface CreateDealInput {
  contact: { name: string; phone_whatsapp: string };
  pipeline_id: string;
  unit_id?: string | null;
  value?: number | null;
  interest_course?: string | null;
  source?: string | null;
}

export const dealsApi = {
  // `search` is applied client-side (the backend kanban has no search param).
  kanban: (filters: KanbanFilters) =>
    api<KanbanResponse>("/deals/kanban", {
      query: {
        pipeline_id: filters.pipeline_id,
        owner_id: filters.owner_id,
        status: filters.status,
        unit_id: filters.unit_id,
        cooling: filters.cooling ? true : undefined,
        no_next_step: filters.no_next_step ? true : undefined,
        cycle_id: filters.cycle_id,
      },
    }),
  get: (id: string) => api<Deal>(`/deals/${id}`),
  /**
   * The backend has no combined contact+deal endpoint: create (or reuse on
   * duplicate_phone 409) the contact, then create the deal referencing it.
   */
  create: async (input: CreateDealInput): Promise<Deal> => {
    let contactId: string;
    try {
      const contact = await api<Contact>("/contacts", {
        method: "POST",
        body: {
          name: input.contact.name,
          phone_whatsapp: input.contact.phone_whatsapp,
        },
      });
      contactId = contact.id;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "duplicate_phone" &&
        typeof err.extras.existing_contact_id === "string"
      ) {
        contactId = err.extras.existing_contact_id;
      } else {
        throw err;
      }
    }
    return api<Deal>("/deals", {
      method: "POST",
      body: {
        title: input.contact.name,
        contact_id: contactId,
        pipeline_id: input.pipeline_id,
        unit_id: input.unit_id ?? null,
        value: input.value ?? null,
        source: input.source ?? null,
        enrollment_data: input.interest_course
          ? { interest_course: input.interest_course }
          : null,
      },
    });
  },
  update: (id: string, body: Record<string, unknown>) =>
    api<Deal>(`/deals/${id}`, { method: "PATCH", body }),
  move: (id: string, stageId: string, nextContactAt?: string) =>
    api<Deal>(`/deals/${id}/stage`, {
      method: "PATCH",
      body: {
        stage_id: stageId,
        ...(nextContactAt ? { next_contact_at: nextContactAt } : {}),
      },
    }),
  /** POST /deals/{id}/log — one-click contact outcome (quick log).
   * objection_id is only accepted with kind=talked_objection (wave 2). */
  log: (
    id: string,
    body: {
      kind: QuickLogKind;
      note?: string;
      next_contact_at?: string;
      objection_id?: string;
    },
  ) => api<QuickLogResponse>(`/deals/${id}/log`, { method: "POST", body }),
  /** Lost deals with a recoverable reason from non-active cycles (wave 2). */
  recoverable: (cycleIdBefore?: string) =>
    api<RecoverableDealsResponse>("/deals/recoverable", {
      query: { cycle_id_before: cycleIdBefore },
    }),
  /** Creates a NEW deal in the active cycle from a lost one (201 DealOut). */
  reopenInCycle: (id: string) =>
    api<Deal>(`/deals/${id}/reopen-in-cycle`, { method: "POST" }),
  /** Count of OPEN deals in a cycle (rollover confirmation dialog). */
  countOpenInCycle: async (cycleId: string): Promise<number> => {
    const page = await api<Paginated<Deal>>("/deals", {
      query: { cycle_id: cycleId, status: "open", page_size: 1 },
    });
    return page.total;
  },
  markWon: (id: string, value?: number | null) =>
    api<Deal>(`/deals/${id}/won`, {
      method: "POST",
      body: value !== undefined && value !== null ? { value } : {},
    }),
  markLost: (id: string, lostReasonId: string, lostNotes?: string) =>
    api<Deal>(`/deals/${id}/lost`, {
      method: "POST",
      body: { lost_reason_id: lostReasonId, lost_notes: lostNotes || undefined },
    }),
  reopen: (id: string) => api<Deal>(`/deals/${id}/reopen`, { method: "POST" }),
  registerFirstContact: (id: string, nextContactAt?: string) =>
    api<Deal>(`/deals/${id}/first-contact`, {
      method: "POST",
      body: nextContactAt ? { next_contact_at: nextContactAt } : {},
    }),
  claim: (id: string) => api<Deal>(`/deals/${id}/claim`, { method: "POST" }),
  /** Backend paginates the timeline — first 200 entries cover phase-1 volume. */
  activities: (id: string) =>
    api<Paginated<Activity>>(`/deals/${id}/activities`, {
      query: { page_size: 200 },
    }).then((page) => page.items),
  addNote: (id: string, body: string) =>
    api<Activity>(`/deals/${id}/activities`, {
      method: "POST",
      body: { body },
    }),
  tasks: (id: string) => api<TaskItem[]>(`/deals/${id}/tasks`),
};

// ---------- Tasks ----------

export const tasksApi = {
  /** GET /tasks/my — pending tasks pre-bucketed (overdue/today/upcoming). */
  mine: () => api<MyTasksResponse>("/tasks/my"),
  create: (body: { deal_id: string; title: string; due_date: string }) =>
    api<TaskItem>(`/deals/${body.deal_id}/tasks`, {
      method: "POST",
      body: { title: body.title, due_date: body.due_date },
    }),
  update: (
    id: string,
    body: { is_done?: boolean; title?: string; due_date?: string },
  ) => api<TaskItem>(`/tasks/${id}`, { method: "PATCH", body }),
};

// ---------- Reports ----------

export const reportsApi = {
  summary: (f: ReportFilters) =>
    api<ReportSummary>("/reports/summary", { query: { ...f } }),
  funnel: (f: ReportFilters) =>
    api<FunnelReport>("/reports/funnel", { query: { ...f } }),
  lostReasons: (f: ReportFilters) =>
    api<LostReasonsReport>("/reports/lost-reasons", { query: { ...f } }),
  /** Backend supports period + cycle here (no unit/owner filter). */
  responseTime: (f: Pick<ReportFilters, "from" | "to" | "cycle_id">) =>
    api<ResponseTimeReport>("/reports/response-time", {
      query: { from: f.from, to: f.to, cycle_id: f.cycle_id },
    }),
  sales: (
    f: Pick<ReportFilters, "from" | "to" | "cycle_id"> & { group_by?: string },
  ) =>
    api<SalesReport>("/reports/sales", {
      query: {
        from: f.from,
        to: f.to,
        cycle_id: f.cycle_id,
        group_by: f.group_by ?? "month",
      },
    }),
  cooling: () => api<CoolingReport>("/reports/cooling"),
  /**
   * CAC (wave 2). Two exclusive modes: cycle_id (leads/wins of the cycle,
   * spend across its months) OR from/to (leads by created_at, wins by won_at).
   */
  cac: (
    f: { from?: string; to?: string; cycle_id?: string },
    groupBy: "source" | "campaign" | "unit" | "month",
  ) =>
    api<CacReport>("/reports/cac", {
      query: f.cycle_id
        ? { cycle_id: f.cycle_id, group_by: groupBy }
        : { from: f.from, to: f.to, group_by: groupBy },
    }),
  /** Conversation metrics per consultant (wave 2). */
  conversations: (f: Pick<ReportFilters, "from" | "to" | "cycle_id">) =>
    api<ConversationsReport>("/reports/conversations", {
      query: { from: f.from, to: f.to, cycle_id: f.cycle_id },
    }),
};
