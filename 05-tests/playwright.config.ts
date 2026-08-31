import { defineConfig } from "@playwright/test";

/**
 * E2E suite for the Sales CRM.
 *
 * Prerequisites (started OUTSIDE this suite — see README.md):
 *  - Postgres 16:  docker compose up -d          (03-backend, container sales-crm-postgres)
 *  - Backend:      uvicorn app.main:app :8000    (03-backend/.venv)
 *  - Frontend:     npm run dev :3000             (04-frontend)
 *
 * global-setup.ts recreates the `sales_crm` database (drop/create + alembic +
 * seeds) before every run, so the suite always starts from a clean state.
 *
 * Execution model: workers = 1 and fullyParallel = false. Specs run in
 * filename order (01..08) but each spec is SELF-CONTAINED: it creates its own
 * data through the API. Inside each spec, tests run in `serial` mode (a retry
 * re-runs the whole spec from the start).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./global-setup",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
});
