# Sales CRM: Frontend

Frontend for a **multi-unit sales CRM**: kanban pipeline, contacts, tasks,
loss-reason and response-time reports, and lead-capture webhooks. Users are
managed by an admin (ADMIN / CONSULTANT roles). Built as part of a two-app
monorepo: the backend is a FastAPI + PostgreSQL service that lives alongside
this app (`03-backend`).

> UI is entirely in **pt-BR** (the users are sales consultants); code, docs
> and commits are in **English**. All UI strings live in a single typed module:
> [`src/lib/strings.ts`](src/lib/strings.ts): no i18n framework.

## Stack

- **Next.js 15** (App Router, client-side authenticated SPA: no SSR of
  sensitive data)
- **TypeScript strict**: no `any`
- **Tailwind CSS v4** with custom design tokens (own neutral identity, indigo
  primary, light + dark themes)
- **shadcn/ui-style components** (Radix primitives, locally owned in
  `src/components/ui`)
- **TanStack Query** for all server state (caching, invalidation, optimistic
  kanban drag with rollback)
- **React Hook Form + Zod** on every form boundary
- **dnd-kit** for the kanban drag-and-drop
- **Recharts** for report charts
- **next-themes** for the dark mode toggle · **sonner** for toasts

## Features

| Screen | Highlights |
|---|---|
| **Login** | email + password, no signup (admin creates users). Access token kept in memory; refresh via httpOnly cookie with automatic retry-on-401. |
| **My Day** (landing screen) | the consultant's work queue in one place: "respond now" (leads with no first WhatsApp contact), follow-ups due today, overdue ones, cooling deals with no next step, pending tasks, plus tabs for the unassigned queue and for **Rescue** (win-back of recoverable losses from previous cycles, one click to reopen in the active cycle). Quick log of a contact result (no answer / talked / objection / visit scheduled) with a suggested cadence and WhatsApp templates. |
| **Deals kanban** (main) | columns per stage with count + value sum, drag-and-drop between stages (optimistic, rolls back on error), status badges (open/won/lost), amber "cooling for N days" badge, first-WhatsApp-contact chip or one-click register, filters (pipeline, owner: admin only, status, unit, cooling), debounced search, create-deal dialog with contact dedupe, and a queue of unassigned webhook leads with a **Claim** button. Header shows the active cycle countdown and the consultant's goal progress. Moving into a stage that has required fields opens an inline dialog to fill them. On mobile the board becomes a stacked accordion list. |
| **Deal detail** | editable first-class fields, progressive enrollment form in 4 sections (interest / financial / negotiation / documents), activity timeline (notes + system events), per-deal tasks, **Mark won** (value confirmation) / **Mark lost** (reason required) dialogs, WhatsApp button (`wa.me`) that offers to register the first contact (write-once response-time metric). |
| **My tasks** | overdue / today / upcoming groups, one-click complete, jump to deal. |
| **Contacts** | searchable paginated list, create/edit dialog, WhatsApp shortcut. |
| **Reports** (admin) | "why aren't we selling" dashboard: KPI cards (leads, conversion, response time, sales, average CAC), stage-to-stage funnel with conversion, loss-reason ranking + top objections, response time per consultant (median/avg/% within 24h/never contacted), sales by unit/consultant/month, live cooling-leads list, **CAC** by source/campaign/unit/month (spend prorated by the days of the period), **goal** ranking per cycle, and **conversations** (attempts, real conversations, objections). Global period/unit/consultant/cycle filters. |
| **Settings** (admin) | users (create consultant, activate/deactivate, password reset), business units, pipeline stages with required fields and playbook, lost reasons with the recoverable flag, lead sources (webhook URL with copy button), cooling threshold, **sales cycles** (create, activate, rollover), **campaign spend**, **goals** and the **objection** catalog. |

Role-based navigation: consultants never see Reports/Settings (and the routes
redirect them away: real enforcement is server-side, per ADR-008).

## Getting started

```bash
# 1. Install
npm install

# 2. Configure the API origin
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:8000

# 3. Run (expects the FastAPI backend running with CORS allowing this origin
#    and credentials, since the refresh token travels in a cookie)
npm run dev
```

Production build:

```bash
npm run build && npm start
```

## Environment

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend origin (no trailing slash; `/api/v1` is appended by the client) | `http://localhost:8000` |

## Project layout

```
src/
├── app/
│   ├── login/                 # public login page
│   └── (app)/                 # authenticated shell (sidebar + header + guard)
│       ├── meu-dia/           # My Day: work queue, unassigned queue, rescue
│       ├── negociacoes/       # kanban + deal detail ([id])
│       ├── tarefas/           # my tasks
│       ├── contatos/          # contacts
│       ├── relatorios/        # reports (admin)
│       └── configuracoes/     # settings (admin)
├── components/
│   ├── ui/                    # shadcn-style primitives
│   ├── layout/                # sidebar, header, theme toggle
│   ├── kanban/                # board, columns, cards, filters, queue, goals
│   ├── deals/                 # detail cards, enrollment form, timeline, dialogs,
│   │                          # quick log, required-fields dialog
│   ├── cycles/                # active-cycle countdown
│   ├── rescue/                # win-back list
│   ├── reports/               # CAC, goals and conversations sections
│   ├── settings/              # cycles, spend, goals and objections tabs
│   ├── auth/                  # AuthProvider (session restore, login/logout)
│   └── shared/                # loading / empty / error states
├── hooks/                     # TanStack Query hooks (queries + mutations)
└── lib/
    ├── api/                   # typed HTTP client (auto-refresh), resources, models
    ├── schemas.ts             # Zod form schemas (mirror backend Pydantic)
    ├── strings.ts             # ALL pt-BR UI strings (typed)
    └── utils.ts               # formatting helpers (BRL, dates, wa.me links)
```

## API contract

The client implements the REST contract of the backend API. Shapes that were
reconciled during integration are documented in
[`API-ASSUMPTIONS.md`](API-ASSUMPTIONS.md).
