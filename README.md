**English** | [Português](README.pt-BR.md)

# Sales CRM

A multi-unit sales CRM for teams that sell over WhatsApp. Leads arrive through
a public capture webhook, consultants work them on a kanban pipeline with
per-stage gates and a follow-up cadence, and management gets the reports that
answer the only question that matters: why are we not selling?

Two applications and one browser extension:

- **API** (`03-backend`): FastAPI + PostgreSQL, with the funnel invariants
  enforced by the database itself.
- **Web app** (`04-frontend`): Next.js 15 App Router, TypeScript strict.
- **Chrome extension** (`whatsapp-extension`): Manifest V3 side panel that
  turns an open WhatsApp Web conversation into a CRM lead.
- **E2E suite** (`05-tests`): Playwright against the real stack.

Code, commits and documentation are in English. The product UI is in pt-BR,
because the users are sales consultants; every string lives in one typed
module, with no i18n framework.

## Stack

| Layer | Choices |
|---|---|
| API | Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), Alembic, Pydantic v2 |
| Database | PostgreSQL 16, with triggers, CHECK constraints and partial unique indexes |
| Auth | argon2id hashing, JWT access token, rotating httpOnly refresh cookie, RBAC |
| Web | Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui-style components on Radix, TanStack Query, React Hook Form + Zod, dnd-kit, Recharts |
| Extension | Chrome Manifest V3, TypeScript, esbuild, shadow-DOM panel, no framework |
| Testing | pytest + httpx against a real PostgreSQL, Playwright for E2E, Vitest for extension units |

## Architecture

- **The database is the source of truth for invariants.** Stage history,
  `last_activity_at` and the write-once first-contact timestamp are maintained
  by PostgreSQL triggers, so no code path can corrupt funnel metrics. The API
  sets `app.user_id` per transaction so triggers can attribute changes.
- **Migrations are the schema.** Alembic owns the DDL, triggers included.
  `02-schema/schema.sql` is a readable historical snapshot of revision 0001,
  never a provisioning source.
- **Typed boundaries everywhere.** Every request and response body is a
  Pydantic v2 model on the server and a Zod schema plus a typed client on the
  web app. The variable enrollment payload is JSONB validated with
  `extra="forbid"`.
- **Scope is applied in the query.** Consultants only ever select their own
  deals plus the unassigned queue; admins see everything. The UI hides what a
  role cannot use, but the enforcement is server-side in every SELECT.
- **Thin routers, real services.** Routers validate and wire; transitions,
  webhook ingestion, reports and auth live in `app/services`.
- **Consistent error envelope.** Every failure is
  `{"detail", "code", ...extras}`; the web app maps stable codes to UI copy.
- **Client-side authenticated SPA.** No SSR of sensitive data. The access
  token stays in memory, the refresh token in an httpOnly cookie, and a
  single-flight retry re-authenticates on 401.

## Features

### Pipeline and gates

Six-stage funnel. Each stage declares `required_fields` (deal columns,
`contact.*` or `enrollment.*`) and a `playbook` script. Entering a stage
without its fields answers 422 with the missing list, and the rule holds on
the kanban drag, on the explicit "mark won" and on creating a deal straight
into a middle stage. The board does optimistic drag with rollback, shows count
and value sums per column, and flags cooling deals.

### Follow-up and cadence

A `next_contact_at` per deal, one-click quick logging of every contact attempt
or conversation (no answer, talked and advanced, talked and hit an objection,
visit scheduled), WhatsApp message templates with `{{placeholders}}`, and an
optional "make first contact" task created automatically for webhook leads.
**My Day** collapses all of it into one work queue: respond now, due today,
overdue, cooling with no next step, plus pending tasks.

### Lead capture

`POST /webhooks/leads/{token}` is unauthenticated with a token per lead
source. It validates name and phone, dedupes the contact by E.164 phone,
creates the deal unowned in the first stage of the active sales cycle, and
routes it to a business unit by name. An invalid token and an invalid payload
are the only rejection reasons, because no configuration gap of ours should
cost a captured lead. Every hit is logged raw in `webhook_deliveries`, so
silent landing-page breakage is diagnosable.

### Chrome extension

A collapsible side panel on `web.whatsapp.com`. With a conversation open it
extracts the peer phone, looks it up in the CRM and shows the lead card
(stage, owner, next contact, recent activity, quick-log actions, message
templates) or a one-click create-lead form. It has its own login flow
(`?client=extension`) issuing a single 12h access token with no refresh
channel, revocable by a password change. A second adapter ships as a
configured-off stub so the panel can be pointed at any other web inbox.

### Analytics

Funnel conversion stage to stage (read from `deal_stage_history`, not from the
current state), loss-reason ranking with top objections, first-contact
response time per consultant (average, median, p90, share contacted within
24h), sales by unit, consultant or month, live cooling list, per-consultant
conversation outcomes, and the acquisition block: sales cycles with rollover,
monthly campaign spend, **CAC** per source, campaign, unit or month, and
enrollment **goals** per cycle. Monthly budgets are prorated by the days each
month contributes to the requested period, and costs come back `null` when
there is no registered spend, because the report never fabricates a number.

### Administration

Admin-managed users with no open signup (ADMIN and CONSULTANT), business
units, pipelines and stages, lost reasons with a recoverable flag, lead
sources with token rotation and revocation, objection catalog, message
templates and the cooling threshold. Losses marked recoverable feed a
**win-back** list: one click reopens the contact as a new deal in the active
cycle, cross-linked to the old one, idempotently.

## Quality gates

Everything below is green on the committed tree.

| Gate | Result |
|---|---|
| `pytest` (API, real PostgreSQL, no mocked database) | 82 passing |
| `playwright test` (E2E, full stack) | 30 passing, no flakes across consecutive runs |
| `mypy` over the whole `app` package (`disallow_untyped_defs`) | 0 errors |
| `tsc --noEmit` (web app and extension, strict) | 0 errors |
| `eslint` (web app) | 0 errors, 0 warnings |
| `vitest` (extension units) | 25 passing |

The API test suite runs against a real PostgreSQL instance that is dropped and
recreated per run: triggers and constraints are part of the system under test,
so the database is never mocked.

## Local setup

Prerequisites: Python 3.12+, Node.js 18+, Docker.

```bash
# 1. Database
cd 03-backend
docker compose up -d

# 2. API
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env               # then set JWT_SECRET and ADMIN_PASSWORD
alembic upgrade head               # schema + triggers
python -m app.db.seeds             # idempotent seed data + initial admin
uvicorn app.main:app --reload      # http://localhost:8000 (docs at /docs)

# 3. Web app (new terminal)
cd 04-frontend
npm install
cp .env.example .env.local         # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                        # http://localhost:3000

# 4. Chrome extension (optional)
cd whatsapp-extension
npm install && npm run build
# load whatsapp-extension/dist as an unpacked extension at chrome://extensions,
# then add its chrome-extension:// id to EXTENSION_ORIGINS in the API .env

# 5. E2E suite (optional, with the stack from steps 1 to 3 running)
cd 05-tests
npm install && npx playwright install chromium
npx playwright test
```

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` pair from the API `.env`.

## Repository layout

```
02-schema/            historical snapshot of revision 0001 (DDL + models), docs only
03-backend/           FastAPI service
  app/
    core/             settings, security, deps, errors, rate limiting, logging
    db/               async session, SQLAlchemy models, idempotent seeds
    api/              one thin router per module
    schemas/          Pydantic v2 models for every boundary
    services/         business rules: transitions, webhook, reports, auth
  alembic/versions/   migrations, the real schema source of truth
  tests/              pytest against a real PostgreSQL
04-frontend/          Next.js 15 web app
  src/app/            login page + authenticated shell (kanban, My Day, reports, settings)
  src/components/     ui primitives, kanban, deals, reports, settings, auth
  src/hooks/          TanStack Query hooks
  src/lib/            typed API client, Zod schemas, UI strings, formatters
05-tests/             Playwright E2E suite + global setup
whatsapp-extension/   Chrome MV3 extension (background, content adapters, panel, popup)
```

## Design decisions

**Invariants belong in the database, not in a service layer.** Stage history,
`last_activity_at` and first-contact write-once are triggers and constraints.
A future importer, an admin fixing data by hand, or a second service writing
to the same schema all inherit the guarantees for free, and funnel reports can
trust `deal_stage_history` rather than recomputing from the current state.

**JSONB for the variable part, columns for the stable part.** Deal identity,
money, ownership and dates are real columns with real indexes. The enrollment
payload, which changes shape per business, lives in a JSONB column validated
by a Pydantic model with `extra="forbid"`. Flexibility without a migration per
custom field, and without an entity-attribute-value table.

**Stage gates are validated on the server, in every path.** The required
fields of a stage are data, not code, and the check runs on the kanban drag,
on "mark won" and on direct creation into a middle stage. The dialog the UI
opens is a convenience; the 422 with the missing field list is the contract.

**RBAC is applied in the query.** Role checks in the router are cheap and easy
to forget. Scope is a predicate composed into every SELECT, so a consultant
cannot read another consultant's deal even through a filter, a report or an
id typed by hand. The frontend redirect is cosmetic.

**The first contact timestamp is write-once.** Response time is the metric a
sales team is most tempted to improve by editing history. The timestamp can be
set once by any path (WhatsApp button, quick log, extension); afterwards only
an admin can correct it, and the correction is an audited activity.

## License

MIT. See [LICENSE](LICENSE).
