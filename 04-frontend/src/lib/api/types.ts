/**
 * TypeScript models mirroring the FastAPI backend contract (verified against
 * 03-backend/app/schemas/*.py — see API-ASSUMPTIONS.md for the reconciliation).
 */

export type Role = "ADMIN" | "CONSULTOR";
export type DealStatus = "open" | "won" | "lost";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  unit_id: string | null;
  /** Present on /users responses; absent on /auth/me. */
  created_at?: string;
  updated_at?: string;
}

export interface Unit {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  is_won_stage: boolean;
  /** Field keys (from GET /deal-fields) required to ENTER this stage. */
  required_fields: string[];
  /** Stage playbook (plain text with line breaks), null when unset. */
  playbook: string | null;
}

/** Catalog entry from GET /deal-fields (labels live in strings.ts). */
export interface DealFieldDef {
  key: string;
  type: "string" | "number" | "boolean" | "date" | "datetime" | "uuid";
}

export interface Pipeline {
  id: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  stages: Stage[];
}

export interface LostReason {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  /** Lost deals with a recoverable reason feed the win-back (rescue) list. */
  is_recoverable: boolean;
}

// ---------- Cycles (phase ) ----------

export interface Cycle {
  id: string;
  name: string;
  starts_on: string;
  deadline_on: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  name: string;
  token: string;
  default_unit_id: string | null;
  default_pipeline_id: string | null;
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  name: string;
  phone_whatsapp: string;
  email: string | null;
  city: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

/** Compact deal used on kanban cards (backend DealCard — flat projection). */
export interface DealCard {
  id: string;
  title: string;
  status: DealStatus;
  stage_id: string;
  owner_id: string | null;
  unit_id: string | null;
  value: string | number | null;
  qualification: number | null;
  source: string | null;
  last_activity_at: string;
  created_at: string;
  contact_name: string;
  contact_phone: string;
  /** Computed server-side from cooling_days. */
  is_cooling: boolean;
  /** Denormalized from enrollment_data for the card. */
  interest_course: string | null;
  first_whatsapp_contact_at: string | null;
  next_contact_at: string | null;
}

export interface EnrollmentData {
  interest_area?: string | null;
  interest_course?: string | null;
  entry_method?:
    | "vestibular"
    | "enem"
    | "transferencia"
    | "segunda_graduacao"
    | "outro"
    | null;
  modality?: "presencial" | "semipresencial" | "ead" | null;
  enrollment_semester?: string | null;
  how_found_us?: string | null;
  budget_range?: string | null;
  needs_scholarship_or_financing?: boolean | null;
  monthly_fee_value?: string | number | null;
  scholarship_offered?: string | null;
  negotiated_final_condition?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  payment_date?: string | null;
  decision_deadline?: string | null;
  main_objection?: string | null;
  scheduling_status?: string | null;
  finished_high_school?: boolean | null;
  cpf?: string | null;
  rg?: string | null;
  birth_date?: string | null;
  address?: string | null;
  contract_signed?: boolean | null;
  contract_accepted_at?: string | null;
  contract_link?: string | null;
  ra_number?: string | null;
}

/** Full deal (backend DealOut). GET /deals/{id} additionally embeds `contact`. */
export interface Deal {
  id: string;
  title: string;
  status: DealStatus;
  pipeline_id: string;
  stage_id: string;
  owner_id: string | null;
  unit_id: string | null;
  contact_id: string;
  value: string | number | null;
  qualification: number | null;
  expected_close_date: string | null;
  source: string | null;
  campaign: string | null;
  lost_reason_id: string | null;
  lost_notes: string | null;
  first_whatsapp_contact_at: string | null;
  next_contact_at: string | null;
  last_activity_at: string;
  won_at: string | null;
  lost_at: string | null;
  enrollment_data: EnrollmentData;
  /** Sales cycle the deal belongs to (phase , always set). */
  cycle_id: string;
  /** Catalog objection (phase ); free-text main_objection stays as legacy. */
  objection_id: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded on GET /deals/{id} (DealDetailOut). */
  contact: Contact;
}

/** Backend KanbanStage: stage metadata + aggregates + cards. */
export interface KanbanStageColumn {
  stage_id: string;
  name: string;
  sort_order: number;
  is_won_stage: boolean;
  count: number;
  sum_value: string | number;
  deals: DealCard[];
}

export interface KanbanResponse {
  pipeline_id: string;
  cooling_days: number;
  stages: KanbanStageColumn[];
}

export type ActivityType =
  | "note"
  | "deal_created"
  | "stage_changed"
  | "status_changed"
  | "first_contact_registered"
  | "first_contact_corrected"
  | "task_created"
  | "task_completed"
  | "owner_changed"
  | "attempt_no_answer"
  | "talked_advance"
  | "talked_objection"
  | "visit_scheduled"
  | "cycle_changed"
  | "reopened_in_cycle";

export interface Activity {
  id: string;
  deal_id: string;
  type: ActivityType;
  body: string | null;
  payload: Record<string, unknown>;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
}

export interface TaskItem {
  id: string;
  deal_id: string;
  title: string;
  due_date: string;
  is_done: boolean;
  done_at: string | null;
  /** null = unassigned (queue task waiting for a claim). */
  assigned_to: string | null;
  /** null = created by the system (webhook automation). */
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /tasks/my — pending tasks pre-bucketed by the backend. */
export interface MyTasksResponse {
  overdue: TaskItem[];
  today: TaskItem[];
  upcoming: TaskItem[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AppSettings {
  cooling_days: number;
  auto_first_contact_task: boolean;
  /** Follow-up cadence in days for no-answer attempts (e.g. [1, 3, 7]). */
  followup_cadence: number[];
}

// ---------- My Day ----------

/** Deal row inside GET /my-day sections. */
export interface MyDayDealRow {
  deal_id: string;
  title: string;
  contact_name: string;
  contact_phone: string;
  stage_id: string;
  stage_name: string;
  owner_id: string | null;
  created_at: string;
  first_whatsapp_contact_at: string | null;
  next_contact_at: string | null;
  last_activity_at: string;
  is_cooling: boolean;
  interest_course: string | null;
}

export interface MyDayTaskRow {
  task_id: string;
  deal_id: string;
  deal_title: string;
  title: string;
  due_date: string;
  assigned_to: string | null;
}

export interface MyDayResponse {
  respond_now: MyDayDealRow[];
  today: { tasks: MyDayTaskRow[]; followups: MyDayDealRow[] };
  overdue: { tasks: MyDayTaskRow[]; followups: MyDayDealRow[] };
  cooling_no_next_step: MyDayDealRow[];
  cooling_days: number;
}

// ---------- Quick log ----------

export type QuickLogKind =
  | "attempt_no_answer"
  | "talked_advance"
  | "talked_objection"
  | "visit_scheduled";

export interface QuickLogResponse {
  deal: Deal;
  /** Total attempt_no_answer count for the deal (drives cadence presets). */
  attempts_count: number;
}

// ---------- Message templates ----------

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------- Objections (phase ) ----------

export interface Objection {
  id: string;
  name: string;
  rebuttal: string;
  template_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------- Campaign spend (phase ) ----------

export interface CampaignSpend {
  id: string;
  /** Always the 1st of the month (YYYY-MM-01). */
  month: string;
  source: string;
  campaign: string | null;
  unit_id: string | null;
  amount: string | number;
  created_at: string;
  updated_at: string;
}

// ---------- Goals (phase ) ----------

export type GoalScope = "consultant" | "unit";

export interface Goal {
  id: string;
  cycle_id: string;
  scope: GoalScope;
  target_user_id: string | null;
  unit_id: string | null;
  target_count: number;
  created_at: string;
  updated_at: string;
}

export interface GoalProgressRow {
  goal_id: string;
  cycle_id: string;
  scope: GoalScope;
  target_user_id: string | null;
  target_user_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  target_count: number;
  won_count: number;
  /** Already 0-100. */
  pct: number;
}

export interface GoalProgressResponse {
  cycle_id: string;
  rows: GoalProgressRow[];
}

// ---------- Rescue / win-back (phase ) ----------

export interface RecoverableDealItem {
  deal_id: string;
  title: string;
  contact_name: string;
  contact_phone: string;
  owner_id: string | null;
  owner_name: string | null;
  cycle_id: string;
  cycle_name: string;
  lost_reason_id: string;
  lost_reason_label: string;
  lost_at: string;
  interest_course: string | null;
}

export interface RecoverableDealsResponse {
  active_cycle_id: string;
  total: number;
  items: RecoverableDealItem[];
}

// ---------- Reports ----------

export interface ReportFilters {
  from?: string;
  to?: string;
  unit_id?: string;
  owner_id?: string;
  /** phase : restrict to one sales cycle (ANDed with the other filters). */
  cycle_id?: string;
}

/** Current-state "no next step" ratio per consultant (not period-filtered). */
export interface NoNextStepRow {
  owner_id: string | null;
  /** null = unassigned queue. */
  owner_name: string | null;
  open_deals: number;
  without_next_step: number;
  /** Already 0–100. */
  pct: number;
}

export interface ReportSummary {
  leads_count: number;
  /** 0–1 fraction of leads created in the period that became `won`. */
  conversion_rate: number;
  median_response_minutes: number | null;
  sales_count: number;
  sales_value: string | number;
  no_next_step: NoNextStepRow[];
  /** null = no spend registered, no won deals, or owner filter (never 0-faked). */
  cac_average: string | null;
}

export interface FunnelStageRow {
  stage_id: string;
  stage_name: string;
  sort_order: number;
  deals_entered: number;
  /** 0–1 vs previous stage; null on the first stage. */
  conversion_from_previous: number | null;
}

export interface FunnelReport {
  stages: FunnelStageRow[];
  total_entered: number;
  total_won: number;
  total_lost: number;
}

export interface LostReasonRow {
  lost_reason_id: string;
  label: string;
  count: number;
  /** 0–100 */
  pct: number;
  total_value: string | number;
}

export interface LostReasonsReport {
  total_lost: number;
  reasons: LostReasonRow[];
  top_objections: { objection: string; count: number }[];
  /** phase : grouping by the objections catalog (deals.objection_id). */
  objection_breakdown: { objection_id: string; name: string; count: number }[];
}

// ---------- CAC report (phase ) ----------

export interface CacRow {
  /** Unit name / "YYYY-MM" / source / campaign; null = no attribution. */
  group_key: string | null;
  group_id: string | null;
  /** null = no spend registered for this group (render as blank, never 0). */
  spend: string | null;
  leads_count: number;
  enrollments: number;
  cost_per_lead: string | null;
  cost_per_enrollment: string | null;
  lead_to_enrollment_rate: number | null;
}

export interface CacReport {
  group_by: "source" | "campaign" | "unit" | "month";
  rows: CacRow[];
  total_spend: string | null;
  total_leads: number;
  total_enrollments: number;
  cac_average: string | null;
}

// ---------- Conversations report (phase ) ----------

export interface ConversationRow {
  user_id: string | null;
  user_name: string | null;
  attempts: number;
  conversations: number;
  /** 0-1; null without contacts. */
  contact_to_conversation_rate: number | null;
  visits_scheduled: number;
  objections_registered: number;
  objection_deals: number;
  objection_deals_won: number;
  /** 0-100; null without objection deals. */
  objections_overcome_pct: number | null;
}

export interface ConversationsReport {
  rows: ConversationRow[];
}

export interface ResponseTimeRow {
  owner_id: string | null;
  /** null = unassigned queue */
  owner_name: string | null;
  deals: number;
  contacted: number;
  never_contacted: number;
  avg_minutes: number | null;
  median_minutes: number | null;
  p90_minutes: number | null;
  /** 0–100 — % WITHOUT first contact within 24h. */
  pct_no_contact_in_24h: number;
}

export interface ResponseTimeReport {
  rows: ResponseTimeRow[];
}

export interface SalesRow {
  /** Unit name / owner name / "YYYY-MM" depending on group_by. */
  group_key: string;
  group_id: string | null;
  enrollments: number;
  total_value: string | number;
  avg_ticket: string | number;
}

export interface SalesReport {
  group_by: string;
  rows: SalesRow[];
  total_enrollments: number;
  total_value: string | number;
}

export interface CoolingDealRow {
  deal_id: string;
  title: string;
  stage_name: string;
  last_activity_at: string;
  days_idle: number;
}

export interface CoolingOwnerGroup {
  owner_id: string | null;
  owner_name: string | null;
  count: number;
  deals: CoolingDealRow[];
}

export interface CoolingReport {
  cooling_days: number;
  total: number;
  groups: CoolingOwnerGroup[];
}
