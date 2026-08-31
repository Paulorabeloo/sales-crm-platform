import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { request, type FullConfig } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_URL,
  APP_URL,
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  STATE_DIR,
} from "./tests/helpers/env";

const BACKEND_DIR = path.resolve(__dirname, "..", "03-backend");
const VENV_PYTHON = path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe");
const PG_CONTAINER = "sales-crm-postgres";
const DB_NAME = "sales_crm";

function sh(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, stdio: "inherit", timeout: 120_000 });
}

/** Drop + recreate the database, run Alembic migrations and the app seeds. */
function resetDatabase(): void {
  console.log("[global-setup] Recreating database", DB_NAME);
  // WITH (FORCE) terminates live connections (the running uvicorn holds a
  // pool); asyncpg reconnects on the next request.
  sh(
    `docker exec ${PG_CONTAINER} psql -U crm -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);"`,
  );
  sh(
    `docker exec ${PG_CONTAINER} psql -U crm -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER crm;"`,
  );
  console.log("[global-setup] alembic upgrade head + seeds");
  sh(`"${VENV_PYTHON}" -m alembic upgrade head`, BACKEND_DIR);
  sh(`"${VENV_PYTHON}" -m app.db.seeds`, BACKEND_DIR);
}

async function waitFor(url: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `[global-setup] ${label} is not reachable at ${url} (${lastError}). ` +
      "Start it before running the suite — see 05-tests/README.md.",
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  resetDatabase();

  await waitFor(`${API_URL.replace("/api/v1", "")}/health`, "Backend API", 30_000);
  await waitFor(`${APP_URL}/login`, "Frontend", 120_000);

  // One master-admin login for the whole run (login is rate limited 5/min per
  // ip+email) — used only to create the per-spec E2E admin users below. Each
  // spec then authenticates as its own user, so rate-limit keys never collide.
  // NOTE: absolute-path requests would drop the /api/v1 prefix of a baseURL,
  // so full URLs are used everywhere.
  const api = await request.newContext();
  const loginRes = await api.post(`${API_URL}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!loginRes.ok()) {
    throw new Error(
      `[global-setup] Master admin login failed (${loginRes.status()}): ${await loginRes.text()}`,
    );
  }
  const { access_token } = (await loginRes.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${access_token}` };

  for (const email of Object.values(E2E_ADMINS)) {
    const res = await api.post(`${API_URL}/users`, {
      headers: auth,
      data: {
        email,
        name: `Admin E2E ${email.split("@")[0].slice(-2)}`,
        password: E2E_ADMIN_PASSWORD,
        role: "ADMIN",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `[global-setup] Failed to create ${email} (${res.status()}): ${await res.text()}`,
      );
    }
  }
  await api.dispose();

  fs.mkdirSync(STATE_DIR, { recursive: true });
  console.log("[global-setup] Done — database clean, E2E admin users created.");
}
