# Sales CRM: Backend API

REST API for a **multi-unit sales CRM**: leads arrive through a public capture
webhook, consultants work their deals on a kanban pipeline over WhatsApp, and
management gets reports that answer *"why aren't we selling?"*: funnel
conversion, response time, loss-reason analytics, sales. Users are managed by
an admin (no open signup) with two roles: **ADMIN** and **CONSULTANT**.

**Stack:** Python 3.12 · FastAPI · SQLAlchemy 2.0 (async, asyncpg) · Alembic ·
Pydantic v2 · PostgreSQL 16 · argon2id + JWT (rotating refresh cookie).

## What it does today (waves 1 to 3)

- **6-stage funnel with gates.** Each stage declares `required_fields`
  (deal columns, `contact.*` or `enrollment.*`); entering it without them
  answers 422 with the missing list. The rule holds on the kanban drag, on the
  explicit "mark won", and on creating a deal straight into a middle stage.
  Each stage also carries a `playbook` script for the consultant.
- **Cadence and follow-up.** `next_contact_at` per deal, one-click quick log
  of every contact attempt or conversation, WhatsApp message templates, and an
  optional "make first contact" task created automatically for webhook leads.
- **My Day.** A single work queue: respond now, due today, overdue, cooling
  with no next step, plus pending tasks.
- **Business model.** Sales cycles with rollover, monthly campaign spend, CAC
  with prorated budgets, enrollment goals per consultant or unit, win-back of
  recoverable losses, and an objection catalog with rebuttals.
- **WhatsApp Chrome extension.** Its own login flow (`?client=extension`)
  issuing a single 12h access token, revocable by a password change.

## Architecture highlights

- **DB-enforced invariants**: stage history (`deal_stage_history`), the
  write-once first-contact timestamp, and `last_activity_at` are maintained by
  PostgreSQL triggers, so no code path can corrupt the funnel metrics. The
  backend sets `app.user_id` per request (transaction-scoped) so triggers can
  attribute changes.
- **Scope in the query, not the UI**: consultants only ever query their own
  deals plus the unassigned queue; admins see everything. Enforced in every
  SELECT (ADR-008).
- **Typed boundaries everywhere**: every request/response body is a Pydantic
  v2 model, including the `enrollment_data` JSONB shape (`extra="forbid"`).
- **Debuggable capture**: every webhook hit on a valid token is logged raw in
  `webhook_deliveries`, accepted or rejected, so silent landing-page breakage
  is diagnosable.
- **Consistent errors**: every error body is `{"detail", "code", ...}`; the
  frontend translates stable `code`s to the UI language.

## Local setup

Prerequisites: Python 3.12+, Docker (for PostgreSQL).

```bash
# 1. Start PostgreSQL 16
docker compose up -d

# 2. Create a virtualenv and install dependencies
python -m venv .venv
.venv\Scripts\activate            # Windows (Linux/macOS: source .venv/bin/activate)
pip install -e ".[dev]"

# 3. Configure environment
copy .env.example .env             # then edit JWT_SECRET and ADMIN_PASSWORD

# 4. Apply migrations (schema + triggers)
alembic upgrade head

# 5. Seed initial data (idempotent: safe to re-run)
python -m app.db.seeds

# 6. Run the API
uvicorn app.main:app --reload
```

The API is at `http://localhost:8000`; interactive docs at
`http://localhost:8000/docs`.

### Environment variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Async SQLAlchemy URL (asyncpg) | `postgresql+asyncpg://crm:crm@localhost:5432/sales_crm` |
| `JWT_SECRET` | HMAC secret for access tokens (**change it**) | dev placeholder |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL | `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL (rotating, httpOnly cookie) | `7` |
| `COOKIE_SECURE` | `true` behind HTTPS (Secure flag on the cookie) | `false` |
| `CORS_ORIGINS` | Comma-separated allowlist of frontend origins | `http://localhost:3000` |
| `EXTENSION_ORIGINS` | Comma-separated allowlist of `chrome-extension://` origins (validated prefix) | empty |
| `EXTENSION_ACCESS_TOKEN_EXPIRE_HOURS` | TTL of the WhatsApp extension token (no refresh channel) | `12` |
| `WEBHOOK_MAX_BODY_BYTES` | Payload cap of the public capture webhook | `10240` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Initial admin created by the seeds | none |
| `ENVIRONMENT` | `dev` / `test` / `production` | `dev` |

## Tests

Tests run against a **real PostgreSQL** (`sales_crm_test`, dropped and
recreated per run): the triggers and constraints are part of the system under
test, so the database is never mocked.

```bash
docker compose up -d
pytest
```

## Quality gates

Both must pass before merging / deploying:

```bash
mypy          # static type checking (configured in pyproject.toml, zero errors)
pytest        # full suite against real PostgreSQL
```

`mypy` runs over the whole `app` package with `disallow_untyped_defs`: every
function is annotated and checked. In production (`ENVIRONMENT=production`)
the app additionally **refuses to start** unless `JWT_SECRET` is a real secret
(>= 32 chars, not the dev default) and `COOKIE_SECURE=true`.

## API summary (`/api/v1`)

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | JWT access (15 min) + rotating refresh cookie. Rate limited (5/min per IP+email) |
| POST | `/auth/login?client=extension` | Single 12h access token, no refresh cookie (Chrome extension flow) |
| POST | `/auth/refresh` | Rotates the refresh token (old one is single-use) |
| POST | `/auth/logout` | Revokes the refresh token |
| GET | `/auth/me` | Current user profile |
| POST | `/auth/change-password` | Own password change |

**Revoking access.** Changing or resetting a password moves
`users.password_changed_at`, which invalidates every access token already
issued for that user, the extension's 12h one included, on top of revoking the
refresh tokens. Deactivating the user (`PATCH /users/{id}`) cuts access on the
next request too, since every request rechecks `is_active`.

### Users (admin only)
`GET/POST /users` · `GET/PATCH /users/{id}` · `POST /users/{id}/reset-password`.
Create consultants with an initial password, activate/deactivate (never
delete), reset passwords. Deactivation revokes refresh tokens, and a password
reset invalidates the target's live access tokens.

### Catalogs
- `GET/POST /units`, `PATCH /units/{id}` (write admin-only): business units
  used as an informative/filter dimension on users and deals
- `GET/POST /pipelines`, `PATCH /pipelines/{id}`,
  `POST /pipelines/{id}/stages`, `PATCH/DELETE /stages/{id}` (stage deletion
  is blocked while deals/history reference it)
- `GET/POST /lost-reasons`, `PATCH /lost-reasons/{id}` (deactivate, not delete)
- `GET/POST /lead-sources`, `PATCH /lead-sources/{id}`,
  `POST /lead-sources/{id}/revoke`, `POST /lead-sources/{id}/rotate-token`
  (admin only; creating generates the webhook token)
- `GET /deal-fields`: catalog of the keys usable in `stages.required_fields`
  (deal columns, `contact.*`, `enrollment.*`) with their types
- `GET/POST /objections`, `PATCH/DELETE /objections/{id}`: objection catalog
  with a suggested rebuttal and an optional linked WhatsApp template (writes
  admin-only; `include_inactive` is ignored for non-admins)
- `GET/POST /message-templates`, `PATCH/DELETE /message-templates/{id}`:
  WhatsApp message templates with `{{placeholders}}` (writes admin-only)
- `GET/POST /sources`, `PATCH/DELETE /sources/{id}`: lead-origin catalog
  (writes admin-only; `include_inactive` is ignored for non-admins). Its
  `key` is the normalized value stored in `deals.source` and
  `campaign_spend.source`; every write normalizes free text onto it
  ("Meta Ads", "meta", "Facebook" -> `meta_ads`) so the CAC report cannot
  split one channel across spellings. An unknown source is accepted and
  auto-registered as inactive: a lead is never refused over its origin.
  Deleting a referenced key is 409 `source_in_use` (deactivate instead).

### Contacts
`GET /contacts?q=` (name/phone search, paginated) · `POST /contacts` (409 with
`existing_contact_id` on phone conflict) · `GET/PATCH/DELETE /contacts/{id}`.
Phones are normalized to E.164. Write scope: consultants can only PATCH a
contact whose deals are all in their own scope (owned or unassigned): a
contact tied to another consultant's deal is 403; DELETE (soft-delete, LGPD)
is admin-only and blocked while open deals exist.

### Deals
- `GET /deals`: paginated list; filters: `pipeline_id`, `stage_id`,
  `owner_id`, `unassigned`, `status`, `unit_id`, `cooling`; sortable
- `GET /deals/kanban`: columns with `count` + `sum_value` per stage, compact
  cards with contact info and a computed `is_cooling` flag. `cards_per_stage`
  (default 25, max 100) caps the cards per column; `count`/`sum_value` stay
  the real column totals and `has_more`/`remaining` report what was left out.
  Cards are ranked by working priority (open and never contacted, oldest
  first; then open and going cold, oldest activity first; then the rest by
  most recent activity). The unassigned queue comes back capped the same way
  in `unassigned`; `split_unassigned=true` removes it from the columns.
- `POST /deals` · `GET/PATCH/DELETE /deals/{id}` (`PATCH` shallow-merges
  `enrollment_data`: absent keys are preserved, a key sent as `null` is
  cleared; `enrollment_data_mode=replace` restores the full replace)
- `PATCH /deals/{id}/stage`: kanban move (history via DB trigger; moving into
  the won-stage marks the deal won)
- `POST /deals/{id}/won`: sets `won_at` + moves to the won-stage
- `POST /deals/{id}/lost`: **requires** `lost_reason_id` (422 otherwise)
- `POST /deals/{id}/reopen`: admin unlocks a closed deal (audited)
- `POST /deals/{id}/first-contact`: write-once WhatsApp first contact
- `PATCH /deals/{id}/first-contact`: admin-only correction (audited)
- `POST /deals/{id}/claim`: take an unassigned deal from the queue
- `POST /deals/{id}/log`: quick log of a contact attempt or conversation
  (`attempt_no_answer`, `talked_advance`, `talked_objection`,
  `visit_scheduled`), optionally setting `next_contact_at` and the objection.
  Registers the first WhatsApp contact when it is still empty
- `GET /deals/recoverable`: win-back list: lost deals with a recoverable
  reason from a cycle other than the active one. Already rescued deals leave
  the list
- `POST /deals/{id}/reopen-in-cycle`: rescue: creates a NEW deal in the
  active cycle for the same contact, cross-linked with the old one, which
  stays lost. Idempotent: a second call answers 409 `already_reopened`
  carrying the `new_deal_id`

### Tasks
`POST/GET /deals/{id}/tasks` · `PATCH/DELETE /tasks/{id}` ·
`GET /tasks/my`: pending tasks bucketed as overdue / today / upcoming.
Creating, editing, completing, or deleting a task requires deal **edit** scope
(owner or admin): queue deals are read-only + claim.

### My Day
`GET /my-day?owner_id=`: the consultant's work queue in four sections:
"respond now" (leads with no first WhatsApp contact, own plus the unassigned
queue), follow-ups due today, overdue follow-ups, and cooling deals with no
next step, plus the pending tasks. `owner_id` is admin-only: a consultant
always gets their own view.

### Sales cycles, spend, goals
- `GET /cycles`, `GET /cycles/active`, `POST /cycles`, `PATCH/DELETE
  /cycles/{id}`, `POST /cycles/{id}/activate`, `POST /cycles/{id}/rollover`
  (writes admin-only). At most one active cycle (partial unique index);
  rollover moves the OPEN deals of a closed cycle into the active one and
  leaves won/lost history where it is
- `GET/POST /campaign-spend`, `PATCH/DELETE /campaign-spend/{id}` (admin only):
  monthly ad spend per source/campaign/unit, the input of the CAC report
- `GET/POST /goals`, `PATCH/DELETE /goals/{id}`, `GET /goals/progress`
  (admin) and `GET /goals/my-progress` (own goals): enrollment targets per
  cycle, scoped to a consultant XOR a unit

### Timeline
`GET /deals/{id}/activities`: notes + automatic events (deal_created,
stage_changed, status_changed, first_contact_registered, task events,
owner_changed), newest first. `POST /deals/{id}/activities`: manual note.

### Public webhook
`POST /webhooks/leads/{token}`: unauthenticated, token-per-source. Validates
`name` + `phone` (required), dedupes the contact by phone, creates the deal in
the first stage with no owner and in the active sales cycle. Optional `unit`
field routes the lead to a business unit by name. Rate limited per IP and per
token; 10KB payload cap; every hit logged in `webhook_deliveries`. Returns 202.

An **invalid token and an invalid payload are the only rejection reasons**: no
configuration gap of ours may cost a captured lead. With no active cycle the
lead falls back to the most recent one (or to a "Sem ciclo" cycle created on
the spot, inactive), and the gap is flagged with a warning log and a
`cycle_fallback` marker on the deal's `deal_created` activity.

### Reports (admin only)
- `GET /reports/funnel?from&to&pipeline_id&unit_id&owner_id`: deals entering
  each stage + stage-to-stage conversion (from `deal_stage_history`)
- `GET /reports/lost-reasons?from&to&unit_id&owner_id`: loss-reason ranking
  (count, %, value) + top cited objections
- `GET /reports/response-time?from&to`: avg/median/p90 first-contact delay
  per consultant + % without contact in 24h (response-time metrics)
- `GET /reports/sales?from&to&group_by=unit|owner|month`: won deals, value,
  average ticket
- `GET /reports/cooling`: idle open deals grouped by owner
- `GET /reports/summary?from&to&unit_id&owner_id&cycle_id`: KPI cards: leads,
  cohort conversion, median first-contact delay, sales and average CAC
- `GET /reports/cac?from&to|cycle_id&group_by=source|campaign|unit|month`:
  spend against leads and enrollments, with cost per lead and per enrollment.
  Monthly budgets are **prorated by the days each month contributes to the
  period**, so a 15-day window over a 30-day month charges half its budget.
  Costs are `null` when there is no registered spend: the report never
  fabricates a number
- `GET /reports/conversations?from&to&cycle_id`: per-consultant quick-log
  outcomes: attempts, real conversations, contact-to-conversation rate,
  scheduled visits and the objection ranking

### Settings (admin only)
`GET/PATCH /settings`: `cooling_days` (default 3), `auto_first_contact_task`.

## Project layout

```
app/
├── main.py          # FastAPI app, CORS, middleware, handlers
├── core/            # config (pydantic-settings), security, deps, errors,
│                    # rate limiting, structured logging, phone normalization
├── db/              # async session, SQLAlchemy models, idempotent seeds
├── api/             # one router per module (thin: validation + wiring)
├── schemas/         # Pydantic v2 models for every boundary
└── services/        # business rules (transitions, webhook, reports, auth)
alembic/             # migrations = the schema's source of truth (0001 embeds
│                    # the base DDL + triggers; 0002-0004 are additive)
tests/               # pytest + httpx against a real PostgreSQL
```

`02-schema/schema.sql` is a readable snapshot of revision 0001 only. Provision
databases with `alembic upgrade head`, never from that file.
