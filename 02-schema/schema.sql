-- ============================================================================
-- Sales CRM — HISTORICAL SNAPSHOT of revision 0001. NOT the source of truth.
-- Author: dev-database-architect (Dev Squad), 2026-08-28
--
-- >>> DO NOT PROVISION A DATABASE FROM THIS FILE. <<<
-- The source of truth is the Alembic migration chain in
-- 03-backend/alembic/versions (run `alembic upgrade head`). This file only
-- documents the shape of the schema at revision 0001, kept because it reads
-- better than the migration code and carries the design comments.
--
-- What the file does NOT contain (everything added after 0001):
--   0002_wave1_followup
--     - stages.required_fields, stages.playbook (per-stage gate + script)
--     - deals.next_contact_at (+ index), message_templates table
--     - activity_type: attempt_no_answer, talked_advance, talked_objection,
--       visit_scheduled
--   0003_wave2_business_model
--     - cycles (one active, partial unique index) and deals.cycle_id (NOT NULL)
--     - campaign_spend (monthly ad spend, CAC input), goals (per-cycle targets)
--     - lost_reasons.is_recoverable (win-back), objections + deals.objection_id
--     - activity_type: cycle_changed, reopened_in_cycle
--   0004_post_review_hardening
--     - users.password_changed_at (access-token revocation cut-off)
--     - ix_deals_awaiting_first_contact, ix_deals_recoverable,
--       ix_activities_deal_type
--
-- The Python mapping in 02-schema/models.py is a copy of the same 0001
-- snapshot; the live models live in 03-backend/app/db/models.py.
--
-- Naming: snake_case, plural table names. All comments in English (repo rule).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
-- gen_random_uuid() is built into PG13+ (pgcrypto core). App generates UUIDv7
-- (time-ordered) via Python `uuid6.uuid7()`; gen_random_uuid() is the DB-side
-- fallback default so ad-hoc inserts never fail.

-- ----------------------------------------------------------------------------
-- ENUM types (mirrored 1:1 by Python enums in models.py)
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('ADMIN', 'CONSULTOR');
CREATE TYPE deal_status AS ENUM ('open', 'won', 'lost');
CREATE TYPE activity_type AS ENUM (
    'note',                       -- manual note by a user
    'deal_created',               -- system event
    'stage_changed',              -- system event, payload: {from_stage_id, to_stage_id}
    'status_changed',             -- system event, payload: {from, to, lost_reason_id?}
    'first_contact_registered',   -- system event
    'first_contact_corrected',    -- system event (admin-only correction, audited)
    'task_created',               -- system event, payload: {task_id}
    'task_completed',             -- system event, payload: {task_id}
    'owner_changed'               -- system event, payload: {from_owner_id, to_owner_id}
);
CREATE TYPE webhook_delivery_result AS ENUM ('accepted', 'rejected', 'duplicate_contact');

-- ----------------------------------------------------------------------------
-- Shared trigger functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- units — business units (branches / sales teams). Informative/filter
-- dimension only: NO access gating by unit (gate decision 2026-08-28).
-- Admin manages via settings UI.
-- ============================================================================
CREATE TABLE units (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON units
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- users — no open signup; only ADMIN creates accounts. Deactivate, never
-- delete (deal history must survive). unit_id is informative (home unit).
-- ============================================================================
CREATE TABLE users (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL CHECK (char_length(email) <= 254),
    password_hash  text        NOT NULL,                       -- argon2id (pwdlib)
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    role           user_role   NOT NULL DEFAULT 'CONSULTOR',
    is_active      boolean     NOT NULL DEFAULT true,
    unit_id        uuid        REFERENCES units (id) ON DELETE RESTRICT,  -- nullable (admin)
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (LOWER(email));
CREATE INDEX ix_users_unit_id ON users (unit_id);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- pipelines & stages — kanban structure. One default pipeline enforced by
-- partial unique index. One won-stage per pipeline enforced the same way.
-- ============================================================================
CREATE TABLE pipelines (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
    is_active   boolean     NOT NULL DEFAULT true,
    is_default  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_pipelines_single_default ON pipelines ((true)) WHERE is_default;
CREATE TRIGGER trg_pipelines_updated_at BEFORE UPDATE ON pipelines
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id   uuid        NOT NULL REFERENCES pipelines (id) ON DELETE RESTRICT,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    sort_order    integer     NOT NULL CHECK (sort_order >= 1),
    is_won_stage  boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- DEFERRABLE so a reorder can swap positions inside one transaction:
    CONSTRAINT ux_stages_pipeline_sort UNIQUE (pipeline_id, sort_order)
        DEFERRABLE INITIALLY IMMEDIATE,
    -- composite target so deals can enforce stage ∈ pipeline (see deals FK):
    CONSTRAINT ux_stages_id_pipeline UNIQUE (id, pipeline_id)
);
CREATE UNIQUE INDEX ux_stages_single_won_per_pipeline
    ON stages (pipeline_id) WHERE is_won_stage;
CREATE INDEX ix_stages_pipeline_id ON stages (pipeline_id);
CREATE TRIGGER trg_stages_updated_at BEFORE UPDATE ON stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- contacts — person (LGPD: soft-delete). Phone is the dedupe key (E.164,
-- normalized by the app before insert). Partial unique ignores soft-deleted.
-- ============================================================================
CREATE TABLE contacts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    phone_whatsapp  text        NOT NULL CHECK (phone_whatsapp ~ '^\+[1-9][0-9]{7,14}$'), -- E.164
    email           text        CHECK (char_length(email) <= 254),
    city            text        CHECK (char_length(city) <= 120),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz                                   -- soft-delete (LGPD)
);
CREATE UNIQUE INDEX ux_contacts_phone_active
    ON contacts (phone_whatsapp) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- lost_reasons — admin-managed catalog. Deactivate instead of delete so
-- historical reports keep their labels.
-- ============================================================================
CREATE TABLE lost_reasons (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    label       text        NOT NULL UNIQUE CHECK (char_length(label) BETWEEN 1 AND 120),
    sort_order  integer     NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_lost_reasons_updated_at BEFORE UPDATE ON lost_reasons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- deals — central entity. First-class columns = anything filtered, sorted,
-- aggregated or rule-bound. Everything else lives in enrollment_data JSONB
-- (shape owned by Pydantic `EnrollmentData`, see notes.md).
-- ============================================================================
CREATE TABLE deals (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    status         deal_status NOT NULL DEFAULT 'open',
    pipeline_id    uuid        NOT NULL REFERENCES pipelines (id) ON DELETE RESTRICT,
    stage_id       uuid        NOT NULL,
    owner_id       uuid        REFERENCES users (id) ON DELETE RESTRICT,   -- NULL = unassigned queue
    unit_id        uuid        REFERENCES units (id) ON DELETE RESTRICT,   -- informative dimension
    contact_id     uuid        NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    value          numeric(12,2) CHECK (value IS NULL OR value >= 0),
    qualification  smallint    CHECK (qualification BETWEEN 1 AND 5),      -- 1=very cold .. 5=hot
    expected_close_date date,
    source         text        CHECK (char_length(source) <= 120),
    campaign       text        CHECK (char_length(campaign) <= 120),
    lost_reason_id uuid        REFERENCES lost_reasons (id) ON DELETE RESTRICT,
    lost_notes     text,
    first_whatsapp_contact_at timestamptz,          -- write-once (trigger below)
    last_activity_at timestamptz NOT NULL DEFAULT now(),  -- denormalized, trigger-maintained
    won_at         timestamptz,
    lost_at        timestamptz,
    enrollment_data jsonb      NOT NULL DEFAULT '{}'::jsonb
                               CHECK (jsonb_typeof(enrollment_data) = 'object'),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,                                    -- soft-delete (LGPD)

    -- stage must belong to the deal's pipeline:
    CONSTRAINT fk_deals_stage_in_pipeline
        FOREIGN KEY (stage_id, pipeline_id)
        REFERENCES stages (id, pipeline_id) ON DELETE RESTRICT,

    -- business invariants (mirror of API rules — DB is the last line of defense):
    CONSTRAINT ck_deals_lost_requires_reason
        CHECK (status <> 'lost' OR (lost_reason_id IS NOT NULL AND lost_at IS NOT NULL)),
    CONSTRAINT ck_deals_won_requires_won_at
        CHECK (status <> 'won' OR won_at IS NOT NULL),
    CONSTRAINT ck_deals_open_has_no_outcome
        CHECK (status <> 'open' OR (won_at IS NULL AND lost_at IS NULL AND lost_reason_id IS NULL))
);

-- Hot-query indexes (see notes.md for the query each one serves):
CREATE INDEX ix_deals_kanban       ON deals (pipeline_id, stage_id, owner_id)
    WHERE deleted_at IS NULL;
CREATE INDEX ix_deals_owner_status ON deals (owner_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_deals_unit_status  ON deals (unit_id, status)  WHERE deleted_at IS NULL;
CREATE INDEX ix_deals_cooling      ON deals (last_activity_at)
    WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX ix_deals_unassigned   ON deals (created_at)
    WHERE owner_id IS NULL AND status = 'open' AND deleted_at IS NULL;
CREATE INDEX ix_deals_won_at       ON deals (won_at)  WHERE status = 'won';
CREATE INDEX ix_deals_lost_at      ON deals (lost_at) WHERE status = 'lost';
CREATE INDEX ix_deals_created_at   ON deals (created_at);
CREATE INDEX ix_deals_contact_id   ON deals (contact_id);
CREATE INDEX ix_deals_lost_reason  ON deals (lost_reason_id);

CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- first_whatsapp_contact_at is WRITE-ONCE at the database level.
-- Admin correction path: the backend (admin-only endpoint) runs
--   SET LOCAL app.allow_first_contact_override = 'on';
-- inside the correction transaction and records a 'first_contact_corrected'
-- activity. Any other overwrite attempt is rejected here.
CREATE OR REPLACE FUNCTION protect_first_whatsapp_contact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.first_whatsapp_contact_at IS NOT NULL
       AND NEW.first_whatsapp_contact_at IS DISTINCT FROM OLD.first_whatsapp_contact_at
       AND COALESCE(current_setting('app.allow_first_contact_override', true), 'off') <> 'on'
    THEN
        RAISE EXCEPTION 'first_whatsapp_contact_at is write-once (deal %)', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_deals_first_contact_write_once
    BEFORE UPDATE OF first_whatsapp_contact_at ON deals
    FOR EACH ROW EXECUTE FUNCTION protect_first_whatsapp_contact();

-- ============================================================================
-- deal_stage_history — one row per stay in a stage (entered_at / left_at).
-- left_at IS NULL = current stage. Maintained by DB triggers on deals so the
-- funnel history cannot be skipped by any code path (invariant #6 of the
-- architecture). changed_by comes from the per-request setting app.user_id
-- (SET LOCAL by the backend); NULL = system (e.g. webhook).
-- ============================================================================
CREATE TABLE deal_stage_history (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     uuid        NOT NULL REFERENCES deals (id) ON DELETE RESTRICT,
    stage_id    uuid        NOT NULL REFERENCES stages (id) ON DELETE RESTRICT,
    entered_at  timestamptz NOT NULL DEFAULT now(),
    left_at     timestamptz CHECK (left_at IS NULL OR left_at >= entered_at),
    changed_by  uuid        REFERENCES users (id) ON DELETE RESTRICT
);
CREATE INDEX ix_dsh_deal_entered ON deal_stage_history (deal_id, entered_at);
CREATE INDEX ix_dsh_stage_entered ON deal_stage_history (stage_id, entered_at);
CREATE INDEX ix_dsh_changed_by ON deal_stage_history (changed_by);
-- exactly one open (current) row per deal:
CREATE UNIQUE INDEX ux_dsh_one_open_per_deal ON deal_stage_history (deal_id)
    WHERE left_at IS NULL;

CREATE OR REPLACE FUNCTION record_deal_stage_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        UPDATE deal_stage_history
           SET left_at = now()
         WHERE deal_id = NEW.id AND left_at IS NULL;
    END IF;
    INSERT INTO deal_stage_history (deal_id, stage_id, entered_at, changed_by)
    VALUES (NEW.id, NEW.stage_id, now(), v_user);
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_deals_stage_history_insert
    AFTER INSERT ON deals
    FOR EACH ROW EXECUTE FUNCTION record_deal_stage_history();
CREATE TRIGGER trg_deals_stage_history_update
    AFTER UPDATE OF stage_id ON deals
    FOR EACH ROW WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
    EXECUTE FUNCTION record_deal_stage_history();

-- ============================================================================
-- activities — unified timeline per deal. type='note' is user-written;
-- every other type is emitted by the backend only. Inserting any activity
-- "warms" the deal (trigger keeps deals.last_activity_at fresh).
-- ============================================================================
CREATE TABLE activities (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     uuid          NOT NULL REFERENCES deals (id) ON DELETE RESTRICT,
    type        activity_type NOT NULL,
    body        text,                              -- note text (type='note')
    payload     jsonb         NOT NULL DEFAULT '{}'::jsonb
                              CHECK (jsonb_typeof(payload) = 'object'),
    user_id     uuid          REFERENCES users (id) ON DELETE RESTRICT,  -- NULL = system
    created_at  timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT ck_activities_note_has_body
        CHECK (type <> 'note' OR (body IS NOT NULL AND char_length(body) > 0))
);
CREATE INDEX ix_activities_deal_created ON activities (deal_id, created_at DESC);
CREATE INDEX ix_activities_user_id ON activities (user_id);

CREATE OR REPLACE FUNCTION touch_deal_last_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE deals
       SET last_activity_at = GREATEST(last_activity_at, NEW.created_at)
     WHERE id = NEW.deal_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_activities_touch_deal
    AFTER INSERT ON activities
    FOR EACH ROW EXECUTE FUNCTION touch_deal_last_activity();

-- ============================================================================
-- tasks — per-deal to-dos. due_date is DATE (no time in phase 1, by design).
-- ============================================================================
CREATE TABLE tasks (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id      uuid        NOT NULL REFERENCES deals (id) ON DELETE RESTRICT,
    title        text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    due_date     date        NOT NULL,
    is_done      boolean     NOT NULL DEFAULT false,
    done_at      timestamptz CHECK (done_at IS NULL OR is_done),
    assigned_to  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_by   uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tasks_my_tasks ON tasks (assigned_to, is_done, due_date);
CREATE INDEX ix_tasks_deal_id ON tasks (deal_id);
CREATE INDEX ix_tasks_created_by ON tasks (created_by);
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- lead_sources — one capture source = one webhook token. Token is a random
-- secret (>= 32 url-safe chars, generated by the app with secrets.token_urlsafe).
-- Revoking: set is_active=false + revoked_at (token stops authenticating,
-- delivery log is preserved).
-- ============================================================================
CREATE TABLE lead_sources (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
    token               text        NOT NULL UNIQUE CHECK (char_length(token) >= 32),
    default_unit_id     uuid        REFERENCES units (id) ON DELETE RESTRICT,
    default_pipeline_id uuid        REFERENCES pipelines (id) ON DELETE RESTRICT,
    is_active           boolean     NOT NULL DEFAULT true,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lead_sources_default_unit ON lead_sources (default_unit_id);
CREATE INDEX ix_lead_sources_default_pipeline ON lead_sources (default_pipeline_id);
CREATE TRIGGER trg_lead_sources_updated_at BEFORE UPDATE ON lead_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- webhook_deliveries — raw log of every webhook hit (accepted or not).
-- Exists to debug Apps Script LPs that "break silently". Append-only.
-- ============================================================================
CREATE TABLE webhook_deliveries (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_source_id  uuid        NOT NULL REFERENCES lead_sources (id) ON DELETE RESTRICT,
    raw_payload     jsonb       NOT NULL,
    result          webhook_delivery_result NOT NULL,
    error_detail    text,                                     -- validation errors, etc.
    deal_id         uuid        REFERENCES deals (id) ON DELETE SET NULL,
    ip              inet,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wd_source_created ON webhook_deliveries (lead_source_id, created_at DESC);
CREATE INDEX ix_wd_deal_id ON webhook_deliveries (deal_id);

-- ============================================================================
-- app_settings — global key-value configuration (JSONB values).
-- ============================================================================
CREATE TABLE app_settings (
    key         text        PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
    value       jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- SEEDS (idempotent-ish: run once on a fresh database; the Alembic data
-- migration is the canonical carrier of these inserts)
-- ============================================================================

-- Default pipeline + 4 stages
INSERT INTO pipelines (id, name, is_active, is_default)
VALUES ('018f0000-0000-7000-8000-000000000001', 'Comercial', true, true);

INSERT INTO stages (pipeline_id, name, sort_order, is_won_stage) VALUES
('018f0000-0000-7000-8000-000000000001', 'Lead Recebido',          1, false),
('018f0000-0000-7000-8000-000000000001', 'Negociando',             2, false),
('018f0000-0000-7000-8000-000000000001', 'Finalizando Matrícula',  3, false),
('018f0000-0000-7000-8000-000000000001', 'Matriculado',            4, true);

-- Lost reasons catalog (admin-editable; deactivate instead of delete)
INSERT INTO lost_reasons (label, sort_order) VALUES
('Sem resposta/sumiu',       1),
('Preço/mensalidade',        2),
('Escolheu concorrente',     3),
('Sem ENEM/documentação',    4),
('Desistiu de estudar',      5),
('Outro',                    6);

-- Placeholder units (real names pending — risk item #1 of the architecture;
-- admin renames via settings UI, so reports keep working after the rename)
INSERT INTO units (name) VALUES
('Unidade 1'),
('Unidade 2'),
('Unidade 3'),
('Unidade 4'),
('Unidade 5'),
('Unidade 6'),
('Unidade 7');

-- Global settings
INSERT INTO app_settings (key, value) VALUES
('cooling_days', '3'::jsonb);

COMMIT;
