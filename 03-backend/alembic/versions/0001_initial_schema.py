"""Initial schema — canonical DDL from 02-schema/schema.sql (PG16).

The DDL is embedded verbatim (enums, tables, CHECKs, partial unique indexes,
triggers) so the trigger-enforced invariants — stage history, write-once first
contact, last_activity_at — are guaranteed regardless of what SQLAlchemy
metadata could express. Seeds are NOT here: run ``python -m app.db.seeds``.

Backend addition on top of the canonical schema: ``refresh_tokens`` (ADR-002).

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-28
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DDL = r"""
-- ----------------------------------------------------------------------------
-- ENUM types (mirrored 1:1 by Python enums in app/db/models.py)
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('ADMIN', 'CONSULTOR');
CREATE TYPE deal_status AS ENUM ('open', 'won', 'lost');
CREATE TYPE activity_type AS ENUM (
    'note',
    'deal_created',
    'stage_changed',
    'status_changed',
    'first_contact_registered',
    'first_contact_corrected',
    'task_created',
    'task_completed',
    'owner_changed'
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
-- units
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
-- users
-- ============================================================================
CREATE TABLE users (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL CHECK (char_length(email) <= 254),
    password_hash  text        NOT NULL,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    role           user_role   NOT NULL DEFAULT 'CONSULTOR',
    is_active      boolean     NOT NULL DEFAULT true,
    unit_id        uuid        REFERENCES units (id) ON DELETE RESTRICT,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (LOWER(email));
CREATE INDEX ix_users_unit_id ON users (unit_id);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- refresh_tokens (backend addition, ADR-002: rotated refresh tokens)
-- ============================================================================
CREATE TABLE refresh_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_refresh_tokens_user_id ON refresh_tokens (user_id);

-- ============================================================================
-- pipelines & stages
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
    CONSTRAINT ux_stages_pipeline_sort UNIQUE (pipeline_id, sort_order)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT ux_stages_id_pipeline UNIQUE (id, pipeline_id)
);
CREATE UNIQUE INDEX ux_stages_single_won_per_pipeline
    ON stages (pipeline_id) WHERE is_won_stage;
CREATE INDEX ix_stages_pipeline_id ON stages (pipeline_id);
CREATE TRIGGER trg_stages_updated_at BEFORE UPDATE ON stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- contacts
-- ============================================================================
CREATE TABLE contacts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    phone_whatsapp  text        NOT NULL CHECK (phone_whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
    email           text        CHECK (char_length(email) <= 254),
    city            text        CHECK (char_length(city) <= 120),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE UNIQUE INDEX ux_contacts_phone_active
    ON contacts (phone_whatsapp) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- lost_reasons
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
-- deals
-- ============================================================================
CREATE TABLE deals (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    status         deal_status NOT NULL DEFAULT 'open',
    pipeline_id    uuid        NOT NULL REFERENCES pipelines (id) ON DELETE RESTRICT,
    stage_id       uuid        NOT NULL,
    owner_id       uuid        REFERENCES users (id) ON DELETE RESTRICT,
    unit_id        uuid        REFERENCES units (id) ON DELETE RESTRICT,
    contact_id     uuid        NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    value          numeric(12,2) CHECK (value IS NULL OR value >= 0),
    qualification  smallint    CHECK (qualification BETWEEN 1 AND 5),
    expected_close_date date,
    source         text        CHECK (char_length(source) <= 120),
    campaign       text        CHECK (char_length(campaign) <= 120),
    lost_reason_id uuid        REFERENCES lost_reasons (id) ON DELETE RESTRICT,
    lost_notes     text,
    first_whatsapp_contact_at timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    won_at         timestamptz,
    lost_at        timestamptz,
    enrollment_data jsonb      NOT NULL DEFAULT '{}'::jsonb
                               CHECK (jsonb_typeof(enrollment_data) = 'object'),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,

    CONSTRAINT fk_deals_stage_in_pipeline
        FOREIGN KEY (stage_id, pipeline_id)
        REFERENCES stages (id, pipeline_id) ON DELETE RESTRICT,

    CONSTRAINT ck_deals_lost_requires_reason
        CHECK (status <> 'lost' OR (lost_reason_id IS NOT NULL AND lost_at IS NOT NULL)),
    CONSTRAINT ck_deals_won_requires_won_at
        CHECK (status <> 'won' OR won_at IS NOT NULL),
    CONSTRAINT ck_deals_open_has_no_outcome
        CHECK (status <> 'open' OR (won_at IS NULL AND lost_at IS NULL AND lost_reason_id IS NULL))
);

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
-- deal_stage_history (trigger-maintained)
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
-- activities
-- ============================================================================
CREATE TABLE activities (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     uuid          NOT NULL REFERENCES deals (id) ON DELETE RESTRICT,
    type        activity_type NOT NULL,
    body        text,
    payload     jsonb         NOT NULL DEFAULT '{}'::jsonb
                              CHECK (jsonb_typeof(payload) = 'object'),
    user_id     uuid          REFERENCES users (id) ON DELETE RESTRICT,
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
-- tasks
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
-- lead_sources
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
-- webhook_deliveries
-- ============================================================================
CREATE TABLE webhook_deliveries (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_source_id  uuid        NOT NULL REFERENCES lead_sources (id) ON DELETE RESTRICT,
    raw_payload     jsonb       NOT NULL,
    result          webhook_delivery_result NOT NULL,
    error_detail    text,
    deal_id         uuid        REFERENCES deals (id) ON DELETE SET NULL,
    ip              inet,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wd_source_created ON webhook_deliveries (lead_source_id, created_at DESC);
CREATE INDEX ix_wd_deal_id ON webhook_deliveries (deal_id);

-- ============================================================================
-- app_settings
-- ============================================================================
CREATE TABLE app_settings (
    key         text        PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
    value       jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
"""

DROP_DDL = """
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS lead_sources;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS deal_stage_history;
DROP TABLE IF EXISTS deals;
DROP TABLE IF EXISTS lost_reasons;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS stages;
DROP TABLE IF EXISTS pipelines;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS units;
DROP FUNCTION IF EXISTS touch_deal_last_activity();
DROP FUNCTION IF EXISTS record_deal_stage_history();
DROP FUNCTION IF EXISTS protect_first_whatsapp_contact();
DROP FUNCTION IF EXISTS set_updated_at();
DROP TYPE IF EXISTS webhook_delivery_result;
DROP TYPE IF EXISTS activity_type;
DROP TYPE IF EXISTS deal_status;
DROP TYPE IF EXISTS user_role;
"""


def _split_statements(sql: str) -> list[str]:
    """Split a DDL script into single statements (asyncpg cannot run
    multi-statement strings through prepared statements). Respects ``$$``
    dollar-quoted function bodies."""
    statements: list[str] = []
    buffer: list[str] = []
    in_dollar = False
    for line in sql.splitlines():
        stripped = line.strip()
        if not buffer and (not stripped or stripped.startswith("--")):
            continue
        buffer.append(line)
        if line.count("$$") % 2 == 1:
            in_dollar = not in_dollar
        if not in_dollar and stripped.endswith(";"):
            statements.append("\n".join(buffer).strip())
            buffer = []
    if buffer:
        statements.append("\n".join(buffer).strip())
    return statements


def upgrade() -> None:
    for statement in _split_statements(DDL):
        op.execute(statement)


def downgrade() -> None:
    for statement in _split_statements(DROP_DDL):
        op.execute(statement)
