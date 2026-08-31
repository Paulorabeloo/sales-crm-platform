import * as path from "node:path";

export const APP_URL = "http://localhost:3000";
export const API_URL = "http://localhost:8000/api/v1";

/** Seeded master admin (03-backend/.env). Used ONCE in global-setup. */
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "ChangeMe123!";

/**
 * Login is rate limited (5/min per ip+email), so every spec authenticates as
 * its OWN admin user (created in global-setup) — rate-limit keys never
 * collide between specs or retries.
 */
export const E2E_ADMIN_PASSWORD = "AdminE2E123!";
export const E2E_ADMINS = {
  auth: "e2e-admin-01@example.com",
  rbac: "e2e-admin-02@example.com",
  leadFlow: "e2e-admin-03@example.com",
  won: "e2e-admin-04@example.com",
  webhook: "e2e-admin-05@example.com",
  tasks: "e2e-admin-06@example.com",
  reports: "e2e-admin-07@example.com",
  settings: "e2e-admin-08@example.com",
  myDay: "e2e-admin-09@example.com",
  whatsapp: "e2e-admin-10@example.com",
  cycles: "e2e-admin-11@example.com",
  cacGoals: "e2e-admin-12@example.com",
  rescue: "e2e-admin-13@example.com",
  objection: "e2e-admin-14@example.com",
} as const;

export const STATE_DIR = path.resolve(__dirname, "..", "..", ".auth");

/**
 * Unique suffix per worker process. The DB is reset only once per RUN (in
 * global-setup) — a retried spec re-creates its fixtures in a fresh worker,
 * so names/emails must not collide with the failed attempt's leftovers.
 */
export const RUN_ID = Date.now().toString(36);

/** Unique-ish Brazilian mobile phone for contact dedupe-by-phone isolation. */
export function uniquePhone(): string {
  const suffix = String(Date.now()).slice(-8);
  return `119${suffix}`; // 11 digits -> normalized to +55119........
}
