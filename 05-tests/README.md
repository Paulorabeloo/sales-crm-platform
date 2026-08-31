# E2E suite (Playwright)

End-to-end tests for the Sales CRM, exercising the real stack:
Next.js frontend (`:3000`) → FastAPI backend (`:8000`) → Postgres 16 (Docker).

Updated for the **6-stage funnel** (Novo lead → Tentando contato → Conversa
qualificada → Proposta apresentada → Fechamento em andamento → Concluído) and
the phase /2 features: stage gates, Meu Dia + quick log + cadence, WhatsApp
templates, cycles/CAC/goals, rescue, objections and the closing checklist.

## Prerequisites (started outside the suite)

```powershell
# 1. Postgres
cd ..\03-backend
docker compose up -d

# 2. Backend API (:8000)
.venv\Scripts\python -m uvicorn app.main:app --port 8000

# 3. Frontend (:3000)
cd ..\04-frontend
npm run dev
```

## Running

```powershell
cd 05-tests
npm install            # first time only
npx playwright install chromium   # first time only
npx playwright test
npx playwright show-report        # HTML report
```

## Clean state (global-setup)

`global-setup.ts` runs before every suite execution and:

1. **Recreates the database**: `DROP DATABASE sales_crm WITH (FORCE)` +
   `CREATE DATABASE` (via `docker exec sales-crm-postgres psql`), then
   `alembic upgrade head` and `python -m app.db.seeds` using the backend venv.
   The running uvicorn survives this (asyncpg reconnects).
2. Waits for the API (`/health`) and the frontend (`/login`).
3. Logs in **once** as the seeded master admin (`admin@example.com`) and
   creates one dedicated `ADMIN` user per spec (`e2e-admin-01..14@example.com`).
   Rationale: login is rate limited at 5/min per ip+email, so each spec
   authenticates with its own account and rate-limit keys never collide
   between specs or retries.

## Execution model

- `workers: 1`, `fullyParallel: false`, so specs run in filename order
  (`01-auth` → … → `14-objecao-checklist`), but **every spec is
  self-contained**: it creates its own fixture data through the API
  (`tests/helpers/api.ts`) and exercises the behavior under test through the
  UI. The only intentional cross-spec effect is `11-cycles`, which activates a
  new cycle, so later specs read the ACTIVE cycle from the API instead of
  assuming a name.
- Inside each spec, tests run in `serial` mode: on a retry the whole spec is
  re-run from the beginning, so intra-spec state (shared page, created deal)
  is always rebuilt. Retry-sensitive fixtures use per-attempt unique names
  (`RUN_ID` changes per worker) or clean up via the API first.
- Selectors follow the pt-BR strings of `04-frontend/src/lib/strings.ts`
  (getByRole/getByLabel); no fixed sleeps, Playwright auto-wait only.
- Chained "Próximo contato" prompts are resolved with the
  `resolveNextContactPrompt` helper; `wa.me` links are asserted by stubbing
  `window.open` (`stubWindowOpen`/`openedUrls`).

## Specs

| Spec | Covers |
|---|---|
| `01-auth` | protected-route redirect, wrong password error, admin login, logout |
| `02-rbac` | admin creates consultant; consultant sees Meu Dia + kanban (funil novo) and no admin menus; direct URLs redirect |
| `03-lead-flow` | create deal → queue → claim → Novo lead → **stage gate** (drag without 1st contact → "Faltam campos para mover" → inline fill → move) → chained next-contact prompt (cadence D+1) → write-once detail → lost blocked without reason → lost with reason → badge via status filter |
| `04-won` | **B1 regression**: R$ 500 prefill confirmed untouched stays 500 (never 50.000); won-stage gate (contract + RA) → Concluído column, green badge, aggregate |
| `05-webhook-claim` | lead source in Settings, webhook POST 202, auto task "Make first contact", claim assigns deal + task to consultant |
| `06-tasks` | create task on deal (due today) → Minhas tarefas (Hoje) → complete |
| `07-reports` | KPIs (incl. CAC rendered as a dash without spend), 6-stage funnel with diagnostic legends, lost reasons, sales, "Sem próximo passo por consultor" |
| `08-settings` | rename unit → reflected in the kanban unit filter |
| `09-meu-dia` | new lead in "Responder agora" (age chip) → quick log "Sem resposta" → prompt with cadence suggestion (Amanhã) → lead leaves the section |
| `10-whatsapp-template` | template dropdown renders `{{first_name}}/{{course}}/...` into the `wa.me` href (window.open intercepted); "Sem mensagem" keeps the plain link |
| `11-cycles` | create cycle with deadline → activate (warning dialog) → kanban countdown chip; rollover moves open deals to the active cycle (+ `cycle_changed` timeline label) |
| `12-cac-metas` | CAC never fabricated (blank without spend) → spend entry → cost per lead/enrollment; consultant goal → kanban progress bar → reports ranking |
| `13-resgate` | recoverable loss from a previous cycle in the Resgate tab → reopen in active cycle → new linked deal, old stays lost, item leaves the list (backend fix) |
| `14-objecao-checklist` | quick log with catalog objection → inline rebuttal coaching → deal objection card; closing checklist N of M on the pre-won stage → complete → won passes the gate without dialog |

## Known bugs found

See `BUGS.md`.
