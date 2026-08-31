# API contract assumptions (frontend → backend): RECONCILED

> **Status (2026-08-28):** every assumption below was checked against the real
> FastAPI implementation (`03-backend/app/api/*.py`, `app/schemas/*.py`) and
> the integration was proven end-to-end.
> Legend: ✅ confirmed as assumed · 🔧 adjusted (where and how) · ⚠️ pending.

All endpoints are under `/api/v1` and require `Authorization: Bearer <access>`
except login/refresh and the public webhook.

## Conventions

- 🔧 **Errors**: the backend returns a FLAT shape ,
  `{"detail": "<msg>", "code": "<stable_code>", ...extras}`, not
  `{detail: {code, message}}`. **Frontend adjusted** (`src/lib/api/client.ts`
  `parseError`): reads top-level `code` and keeps extra keys in
  `ApiError.extras` (e.g. `existing_contact_id`). Codes also differ from the
  assumed list: `duplicate_phone` (not `duplicate_contact`),
  `first_contact_already_set` (not `first_contact_already_registered`),
  `deal_locked` (not `deal_closed`); `lost_reason_required` does not exist
  (missing reason → `validation_error` 422; invalid reason →
  `invalid_lost_reason`). `strings.ts → errors.byCode` updated with the real
  codes.
- ✅ **Decimals**: Pydantic serializes `Decimal` as string, the frontend
  coerces (`num()`).
- ✅ **Dates**: `date` as `YYYY-MM-DD`, timestamps ISO 8601 with tz.
- ✅ **Refresh**: `POST /auth/refresh` (no body) uses the httpOnly cookie and
  returns `{access_token, token_type, expires_in}`. Single-flight retry kept.
- 🔧 **Report periods**: `to` is EXCLUSIVE server-side. The reports page now
  sends tomorrow as the upper bound so today's data is included.

## Auth

| Endpoint | Status |
|---|---|
| `POST /auth/login` | 🔧 returns `{access_token, token_type, expires_in}`, **no `user` embedded**. Frontend now calls `GET /auth/me` right after login (`auth-provider.tsx`). |
| `POST /auth/refresh` | ✅ `200 {access_token, ...}` + rotates the cookie |
| `POST /auth/logout` | ✅ `204`, clears cookie + revokes refresh |
| `GET /auth/me` | 🔧 `User` without `created_at`, field made optional in `types.ts` |

## Kanban: `GET /deals/kanban`

🔧 **Shape is different.** Backend returns:

```json
{
  "pipeline_id": "…",
  "cooling_days": 3,
  "stages": [
    {"stage_id": "…", "name": "…", "sort_order": 1, "is_won_stage": false,
     "count": 2, "sum_value": "35400.00", "deals": [DealCard, …]}
  ]
}
```

- 🔧 No `columns`/`unassigned` split, the **frontend** now splits cards with
  `owner_id == null && status == "open"` into the lead queue client-side
  (`negociacoes/page.tsx`).
- 🔧 No `search` query param, text search (contact name / title / course) is
  applied **client-side** over the returned cards.
- ✅ Query params `pipeline_id`, `owner_id`, `status`, `unit_id`, `cooling`
  exist; `unassigned` (bool) also exists.
- 🔧 `DealCard` is FLAT: `contact_name`/`contact_phone` (no nested refs),
  `owner_id`/`unit_id` (ids only, unit name resolved client-side from the
  cached `/units` catalog), plus `is_cooling` **computed server-side**.
- 🔧 (backend) `interest_course` and `first_whatsapp_contact_at` were **added
  to the backend DealCard** (`app/schemas/deal.py`, `app/api/deals.py`) ,
  functional need: card shows the course and the 1º-contato chip without an
  N+1 per deal.
- ✅ Cooling badge: no longer computed client-side on cards (`is_cooling` +
  `cooling_days` come in the response); the `cooling=true` filter is
  server-side.

## Deals

| Endpoint | Status |
|---|---|
| `GET /deals/{id}` | ✅ full deal; `contact` embedded. 🔧 `owner`/`unit` are ids only, owner name resolved client-side. |
| `POST /deals` | 🔧 backend takes `{title, contact_id, ...}`, **no embedded contact creation**. Frontend now does two steps (`dealsApi.create`): `POST /contacts` (reusing `existing_contact_id` from the 409 `duplicate_phone`) then `POST /deals` with `enrollment_data: {interest_course}`. Owner: consultant = self ✅; admin-created = unowned (goes to the queue) ✅ tolerated. |
| `PATCH /deals/{id}` | ✅ partial update; `enrollment_data` is full-replace. ⚠️ `null` values are ignored by the backend (fields cannot be CLEARED via PATCH, incl. un-assigning owner), UI no longer offers un-assign; see pendências. |
| move stage | 🔧 route is `PATCH /deals/{id}/stage` (not `POST /move`). Closed deal → 409 `deal_locked`. Moving into the won-stage marks won server-side; the UI still blocks it client-side in favor of the explicit dialog ✅. |
| `POST /deals/{id}/won` `{value?}` | ✅ |
| `POST /deals/{id}/lost` | ✅ `{lost_reason_id, lost_notes?}`; 422 `validation_error`/`invalid_lost_reason` (not `lost_reason_required`), dialog validates client-side anyway |
| `POST /deals/{id}/reopen` | ✅ admin only |
| `POST /deals/{id}/first-contact` | ✅ write-once; 409 code is `first_contact_already_set` |
| `POST /deals/{id}/claim` | ✅ |
| `GET /deals/{id}/activities` | 🔧 PAGINATED `{items, total, page, page_size}`, frontend unwraps `.items` with `page_size=200` (open item #5 resolved) |
| `POST /deals/{id}/activities` `{body}` | ✅ creates a note |
| `GET /deals/{id}/tasks` | ✅ `TaskItem[]` |

🔧 `Activity`: flat `user_id`/`user_name` (no `user` ref). Payloads carry IDS,
not names: `stage_changed → {from_stage_id, to_stage_id}`,
`status_changed → {from, to, lost_reason_id?}`. The timeline resolves names
from the cached `/pipelines` and `/lost-reasons` catalogs (`timeline.tsx`).

## Tasks

| Endpoint | Status |
|---|---|
| my tasks | 🔧 route is `GET /tasks/my` returning `{overdue, today, upcoming}` (pre-bucketed, pending only), the page now uses the backend buckets |
| create | 🔧 route is `POST /deals/{deal_id}/tasks` `{title, due_date, assigned_to?}` |
| `PATCH /tasks/{id}` `{is_done?}` | ✅ |

🔧 `TaskItem`: `assigned_to` is a UUID (not a ref) and there is **no embedded
`deal`**, the "my tasks" row links via `deal_id` and no longer shows the deal
title.

## Contacts

- 🔧 search param is `q` (not `search`); default `page_size` is 20 (not 25) ,
  mapped in `contactsApi.list`.
- ✅ `{items, total, page, page_size}` envelope; `POST`, `PATCH`.
- 🔧 duplicate phone → **409 `duplicate_phone`** with `existing_contact_id`
  in the body (used by the create-deal dedupe flow).
- ✅ open item #2: `deals_count` is absent, frontend tolerates it (removed
  from the type).

## Catalogs / admin

- ✅ `GET/POST/PATCH /units`
- ✅ `GET /pipelines` with embedded `stages`
- 🔧 `POST /pipelines/{id}/stages` requires `{name, sort_order}` (unique,
  ≥1), the settings page sends `max(sort_order)+1` (appends after the
  won-stage). `DELETE /stages/{id}` → 409 `stage_has_deals` /
  `stage_has_history` (409, not 422).
- ✅ `GET/POST/PATCH /lost-reasons` (incl. inactive; dialog filters)
- 🔧 lead sources: `PATCH` accepts only `name`/defaults, **no
  `is_active` toggle**. Deactivation is `POST /lead-sources/{id}/revoke`
  (permanent) and there is `POST .../rotate-token`. Settings UI now shows a
  "Revogar" button + "Revogada" badge instead of a switch.
- ✅ `GET/POST/PATCH /users`, `POST /users/{id}/reset-password`
  `{new_password}`. 🔧 clearing a user's unit uses `clear_unit: true`
  (mapped in `usersApi.update`).
- 🔧 `GET /settings` was admin-only in the backend, **backend changed** to
  allow any authenticated user (the kanban/deal detail need `cooling_days`);
  `PATCH /settings` remains admin-only. RBAC test updated.

## Reports (admin)

`from`/`to` accepted (`to` EXCLUSIVE), defaults = last 30 days.

| Endpoint | Status |
|---|---|
| `GET /reports/summary` | 🔧 (backend) did not exist, **added** (`app/api/reports.py`, `app/services/reports.py::summary_report`): `{leads_count, conversion_rate (0–1, cohort), median_response_minutes, sales_count, sales_value}`; accepts `unit_id`/`owner_id`. |
| `GET /reports/funnel` | 🔧 rows use `stage_name` (not `name`) + report totals (`total_entered/total_won/total_lost`), types/page adjusted |
| `GET /reports/lost-reasons` | 🔧 `{total_lost, reasons: [{lost_reason_id, label, count, pct, total_value}], top_objections: [{objection, count}]}`, page adjusted |
| `GET /reports/response-time` | 🔧 `{rows: [...]}` per owner (owner_id null = queue) with `pct_no_contact_in_24h` (inverted client-side to "% em 24h"); no `overall` row and **no unit/owner filters** |
| `GET /reports/sales` | 🔧 grouped by ONE dimension via `group_by=month\|unit\|owner` → `{group_by, rows: [{group_key, group_id, enrollments, total_value, avg_ticket}], ...}`, the page got a group-by selector; no unit/owner filters |
| `GET /reports/cooling` | 🔧 `{cooling_days, total, groups: [{owner_id, owner_name, count, deals: [{deal_id, title, stage_name, last_activity_at, days_idle}]}]}`, rendered as grouped tables; no filters |

## Open items: resolution

1. `interest_course` on the card → 🔧 resolved by ADDING it to the backend
   DealCard (plus `first_whatsapp_contact_at`).
2. `deals_count` on `Contact` → ✅ absent, tolerated (type cleaned).
3. Task due-date timezone → ✅ backend buckets by its own local date
   (`/tasks/my`); no reconciliation needed at this volume.
4. `POST /deals` owner semantics → ✅ consultant = self, admin = unowned
   (queue); both handled by the UI.
5. Activities pagination → 🔧 backend paginates; frontend unwraps `items`
   (`page_size=200`).

## Pendências (⚠️)

- ⚠️ `PATCH /deals/{id}` ignores `null`s, so clearing `value`,
  `expected_close_date`, `unit_id` or un-assigning the owner via the edit form
  silently no-ops. Low impact in phase 1; needs explicit `clear_*` flags (like
  `clear_unit` on users) if clearing becomes a requirement.
- ⚠️ `reports/response-time`, `reports/sales` and `reports/cooling` do not
  accept `unit_id`/`owner_id`, the page's global unit/consultor filters apply
  only to summary, funnel and lost-reasons.
- ⚠️ Kanban search is client-side; fine at phase-1 volume (board already
  returns all matching deals), revisit if boards grow past a few hundred cards.
