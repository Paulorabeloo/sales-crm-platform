/**
 * API response shapes (subset the extension consumes).
 * Source of truth: 03-backend/app/schemas.
 */

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CONSULTOR";
  is_active: boolean;
  unit_id: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ContactOut {
  id: string;
  name: string;
  phone_whatsapp: string;
  email: string | null;
  city: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealOut {
  id: string;
  title: string;
  status: "open" | "won" | "lost";
  pipeline_id: string;
  stage_id: string;
  owner_id: string | null;
  unit_id: string | null;
  contact_id: string;
  cycle_id: string;
  objection_id: string | null;
  value: string | null;
  qualification: number | null;
  expected_close_date: string | null;
  source: string | null;
  campaign: string | null;
  first_whatsapp_contact_at: string | null;
  next_contact_at: string | null;
  last_activity_at: string;
  won_at: string | null;
  lost_at: string | null;
  enrollment_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ActivityOut {
  id: string;
  deal_id: string;
  type: string;
  user_id: string | null;
  user_name: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface UnitOut {
  id: string;
  name: string;
  is_active: boolean;
}

export interface StageOut {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  is_won_stage: boolean;
  required_fields: string[];
  playbook: string | null;
}

export interface PipelineOut {
  id: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  stages: StageOut[];
}

export interface MessageTemplateOut {
  id: string;
  name: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuickLogOut {
  deal: DealOut;
  attempts_count: number;
}

export type QuickLogKind =
  | "attempt_no_answer"
  | "talked_advance"
  | "talked_objection"
  | "visit_scheduled";

/** Error shape every API error follows: {detail, code, ...extras}. */
export interface ApiErrorBody {
  detail: string;
  code: string;
  existing_contact_id?: string;
  [key: string]: unknown;
}
