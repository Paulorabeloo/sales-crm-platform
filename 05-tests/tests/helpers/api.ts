import { request, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./env";

/**
 * Thin authenticated API client used by specs to CREATE FIXTURE DATA fast
 * (contacts, deals, users, lead sources). Anything under test is exercised
 * through the UI — this client only prepares state.
 */
export class ApiClient {
  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly token: string,
  ) {}

  static async login(email: string, password: string): Promise<ApiClient> {
    // No baseURL: Playwright would drop the /api/v1 prefix on absolute paths,
    // so every call goes through full URLs (see url()).
    const ctx = await request.newContext();
    const res = await ctx.post(`${API_URL}/auth/login`, {
      data: { email, password },
    });
    if (!res.ok()) {
      throw new Error(`API login failed for ${email} (${res.status()}): ${await res.text()}`);
    }
    const { access_token } = (await res.json()) as { access_token: string };
    return new ApiClient(ctx, access_token);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  get raw(): APIRequestContext {
    return this.ctx;
  }

  private get auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async json<T>(resPromise: Promise<import("@playwright/test").APIResponse>): Promise<T> {
    const res = await resPromise;
    if (!res.ok()) {
      throw new Error(`API ${res.url()} -> ${res.status()}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  private url(path: string): string {
    return `${API_URL}${path}`;
  }

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.json<T>(this.ctx.get(this.url(path), { headers: this.auth, params }));
  }

  post<T>(path: string, data?: unknown): Promise<T> {
    return this.json<T>(this.ctx.post(this.url(path), { headers: this.auth, data }));
  }

  /** POST returning the raw response (for asserting error statuses). */
  postRaw(path: string, data?: unknown): Promise<import("@playwright/test").APIResponse> {
    return this.ctx.post(this.url(path), { headers: this.auth, data });
  }

  // ---- fixture builders ----------------------------------------------------

  async me(): Promise<{ id: string; email: string; role: string }> {
    return this.get("/auth/me");
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    role: "ADMIN" | "CONSULTOR";
  }): Promise<{ id: string; email: string }> {
    return this.post("/users", input);
  }

  async createContact(name: string, phone: string): Promise<{ id: string }> {
    return this.post("/contacts", { name, phone_whatsapp: phone });
  }

  /** Contact + deal owned by the given user (or unassigned when ownerId null). */
  async createDeal(input: {
    title: string;
    phone: string;
    ownerId: string | null;
    value?: number;
    interestCourse?: string;
    source?: string;
  }): Promise<{ id: string; contact_id: string }> {
    const contact = await this.createContact(input.title, input.phone);
    return this.post("/deals", {
      title: input.title,
      contact_id: contact.id,
      owner_id: input.ownerId,
      value: input.value ?? null,
      source: input.source ?? null,
      enrollment_data: input.interestCourse
        ? { interest_course: input.interestCourse }
        : null,
    });
  }

  async getDeal(dealId: string): Promise<{
    id: string;
    status: string;
    owner_id: string | null;
    stage_id: string;
    cycle_id: string;
    value: string | null;
    next_contact_at: string | null;
    first_whatsapp_contact_at: string | null;
    objection_id: string | null;
    enrollment_data: Record<string, unknown> | null;
  }> {
    return this.get(`/deals/${dealId}`);
  }

  /** Merge fields into the deal's enrollment_data (JSONB is replaced whole). */
  async mergeEnrollment(
    dealId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const deal = await this.getDeal(dealId);
    await this.patch(`/deals/${dealId}`, {
      enrollment_data: { ...(deal.enrollment_data ?? {}), ...patch },
    });
  }

  patch<T>(path: string, data?: unknown): Promise<T> {
    return this.json<T>(this.ctx.patch(this.url(path), { headers: this.auth, data }));
  }

  async delete(path: string): Promise<void> {
    const res = await this.ctx.delete(this.url(path), { headers: this.auth });
    if (!res.ok()) {
      throw new Error(`API DELETE ${path} -> ${res.status()}: ${await res.text()}`);
    }
  }

  /** Sorted stages of the default pipeline, keyed by name. */
  async getStages(): Promise<Record<string, { id: string; sort_order: number }>> {
    const pipelines = await this.get<
      Array<{ stages: Array<{ id: string; name: string; sort_order: number }> }>
    >("/pipelines");
    const map: Record<string, { id: string; sort_order: number }> = {};
    for (const s of pipelines[0].stages) map[s.name] = s;
    return map;
  }

  /** Move a deal to a stage (the gate must already be satisfied). */
  async moveStage(dealId: string, stageId: string): Promise<void> {
    await this.patch(`/deals/${dealId}/stage`, { stage_id: stageId });
  }

  // ---- cycles ----------------------------------------------------------------

  async getActiveCycle(): Promise<{ id: string; name: string }> {
    return this.get("/cycles/active");
  }

  async createCycle(input: {
    name: string;
    startsOn: string;
    deadlineOn?: string | null;
    activate?: boolean;
  }): Promise<{ id: string; name: string; is_active: boolean }> {
    return this.post("/cycles", {
      name: input.name,
      starts_on: input.startsOn,
      deadline_on: input.deadlineOn ?? null,
      is_active: input.activate ?? false,
    });
  }

  async recoverable(): Promise<{
    total: number;
    items: Array<{ deal_id: string }>;
  }> {
    return this.get("/deals/recoverable");
  }

  async listLostReasons(): Promise<Array<{ id: string; label: string }>> {
    return this.get("/lost-reasons");
  }

  async registerFirstContact(dealId: string): Promise<void> {
    await this.post(`/deals/${dealId}/first-contact`);
  }

  async markLost(dealId: string, lostReasonId: string): Promise<void> {
    await this.post(`/deals/${dealId}/lost`, { lost_reason_id: lostReasonId });
  }

  async markWon(dealId: string, value: number): Promise<void> {
    await this.post(`/deals/${dealId}/won`, { value });
  }

  /**
   * Wins a deal as a FIXTURE: first satisfies the won-stage gate
   * (contract_signed + ra_number in the default funnel), then POSTs the won.
   */
  async markWonWithGate(dealId: string, value: number): Promise<void> {
    await this.mergeEnrollment(dealId, {
      contract_signed: true,
      ra_number: `RA-${Date.now()}`,
    });
    await this.markWon(dealId, value);
  }

  async createLeadSource(name: string): Promise<{ id: string; token: string }> {
    return this.post("/lead-sources", { name });
  }
}
