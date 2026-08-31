import { z } from "zod";
import { t } from "@/lib/strings";

/**
 * Zod schemas for form boundaries, mirroring the backend Pydantic models
 * (EnrollmentData in 02-schema/notes.md).
 */

const required = t.common.requiredField;

export const loginSchema = z.object({
  email: z.string().min(1, required).email(t.auth.invalidCredentials),
  password: z.string().min(1, required),
});
export type LoginInput = z.infer<typeof loginSchema>;

const phoneSchema = z
  .string()
  .min(1, required)
  .regex(/^[\d\s()+-]{10,20}$/, t.contacts.phoneHint);

export const contactSchema = z.object({
  name: z.string().min(1, required),
  phone_whatsapp: phoneSchema,
  email: z
    .string()
    .email("E-mail inválido")
    .optional()
    .or(z.literal("")),
  city: z.string().optional(),
  notes: z.string().optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const createDealSchema = z.object({
  contact_name: z.string().min(1, required),
  contact_phone: phoneSchema,
  interest_course: z.string().optional(),
  value: z.string().optional(),
  unit_id: z.string().optional(),
  source: z.string().optional(),
});
export type CreateDealFormInput = z.infer<typeof createDealSchema>;

export const taskSchema = z.object({
  title: z.string().min(1, required),
  due_date: z.string().min(1, required),
});
export type TaskInput = z.infer<typeof taskSchema>;

const optionalString = z.string().optional().or(z.literal(""));
const optionalBool = z.enum(["", "yes", "no"]).optional();

/** Form representation of EnrollmentData (strings for inputs; mapped on submit). */
export const enrollmentFormSchema = z.object({
  // Interest
  interest_area: optionalString,
  interest_course: optionalString,
  entry_method: z
    .enum(["", "vestibular", "enem", "transferencia", "segunda_graduacao", "outro"])
    .optional(),
  modality: z.enum(["", "presencial", "semipresencial", "ead"]).optional(),
  enrollment_semester: optionalString,
  how_found_us: optionalString,
  // Financial
  budget_range: optionalString,
  needs_scholarship_or_financing: optionalBool,
  monthly_fee_value: optionalString,
  scholarship_offered: optionalString,
  negotiated_final_condition: optionalString,
  payment_method: optionalString,
  payment_status: optionalString,
  payment_date: optionalString,
  // Qualification / negotiation
  decision_deadline: optionalString,
  main_objection: optionalString,
  scheduling_status: optionalString,
  finished_high_school: optionalBool,
  // Documents / closing
  cpf: optionalString,
  rg: optionalString,
  birth_date: optionalString,
  address: optionalString,
  contract_signed: optionalBool,
  contract_accepted_at: optionalString,
  contract_link: optionalString,
  ra_number: optionalString,
});
export type EnrollmentFormInput = z.infer<typeof enrollmentFormSchema>;

export const userFormSchema = z.object({
  name: z.string().min(1, required),
  email: z.string().min(1, required).email("E-mail inválido"),
  password: z.string().min(8, "Mínimo de 8 caracteres"),
  role: z.enum(["ADMIN", "CONSULTOR"]),
  unit_id: z.string().optional(),
});
export type UserFormInput = z.infer<typeof userFormSchema>;
