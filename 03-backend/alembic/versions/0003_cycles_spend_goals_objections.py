"""Wave 2: sales cycles, campaign spend (CAC), goals, win-back, objections.

Additive migration on top of 0002 (spec 10 blocks 1-4 + spec 12 block 2):

- ``cycles`` table (spec 10.1) — enrollment/sales cycles; at most ONE active
  (partial unique index). The migration itself creates "Ciclo 1" (active) and
  backfills every existing deal into it so ``deals.cycle_id`` can be NOT NULL.
- ``deals.cycle_id`` (FK, NOT NULL after backfill) + index.
- ``campaign_spend`` table (spec 10.2) — monthly ad spend input; uniqueness on
  (month, source, campaign, unit_id) with NULLS NOT DISTINCT (PG15+).
- ``goals`` table (spec 10.3) — per-cycle enrollment targets, scope
  consultant XOR unit; one goal per target per cycle.
- ``lost_reasons.is_recoverable`` (spec 10.4) — win-back flag; seeded
  recoverable: "Sem resposta/sumiu", "Preço/mensalidade",
  "Sem ENEM/documentação" (admin edits via PATCH).
- ``objections`` table (spec 12.2) — objection catalog with suggested
  rebuttal + optional linked WhatsApp template.
- ``deals.objection_id`` (nullable FK) — main objection from the catalog
  (``enrollment_data.main_objection`` stays as free-text legacy).
- ``activity_type`` gains ``cycle_changed`` (rollover audit trail) and
  ``reopened_in_cycle`` (win-back link on the old lost deal).

Revision ID: 0003_cycles_spend_goals_objections
Revises: 0002_followup_and_stage_gates
Create Date: 2026-08-28
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0003_cycles_spend_goals_objections"
down_revision: str | None = "0002_followup_and_stage_gates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Stable UUID for the backfill cycle (mirrors the seeds constant).
DEFAULT_CYCLE_ID = "018f0000-0000-7000-8000-0000000000c1"

UPGRADE_STATEMENTS: list[str] = [
    # --- cycles (spec 10.1) ---------------------------------------------------
    """
    CREATE TABLE cycles (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
        starts_on   date        NOT NULL,
        deadline_on date        NULL CHECK (deadline_on IS NULL OR deadline_on >= starts_on),
        is_active   boolean     NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX ux_cycles_one_active ON cycles (is_active) WHERE is_active",
    """
    CREATE TRIGGER trg_cycles_updated_at BEFORE UPDATE ON cycles
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
    # Backfill cycle so existing deals can get a NOT NULL cycle_id.
    f"""
    INSERT INTO cycles (id, name, starts_on, is_active)
    VALUES ('{DEFAULT_CYCLE_ID}', 'Ciclo 1', CURRENT_DATE, true)
    """,
    # --- deals.cycle_id (FK NOT NULL after backfill) --------------------------
    """
    ALTER TABLE deals
        ADD COLUMN cycle_id uuid REFERENCES cycles(id) ON DELETE RESTRICT
    """,
    f"UPDATE deals SET cycle_id = '{DEFAULT_CYCLE_ID}'",
    "ALTER TABLE deals ALTER COLUMN cycle_id SET NOT NULL",
    "CREATE INDEX ix_deals_cycle ON deals (cycle_id)",
    # --- campaign_spend (spec 10.2) -------------------------------------------
    """
    CREATE TABLE campaign_spend (
        id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        month       date          NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
        source      text          NOT NULL CHECK (char_length(source) BETWEEN 1 AND 120),
        campaign    text          NULL
            CHECK (campaign IS NULL OR char_length(campaign) BETWEEN 1 AND 120),
        unit_id     uuid          NULL REFERENCES units(id) ON DELETE RESTRICT,
        amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
        created_at  timestamptz   NOT NULL DEFAULT now(),
        updated_at  timestamptz   NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE UNIQUE INDEX ux_campaign_spend_combo
        ON campaign_spend (month, source, campaign, unit_id) NULLS NOT DISTINCT
    """,
    """
    CREATE TRIGGER trg_campaign_spend_updated_at BEFORE UPDATE ON campaign_spend
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
    # --- goals (spec 10.3) ----------------------------------------------------
    """
    CREATE TABLE goals (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        cycle_id       uuid        NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
        scope          text        NOT NULL CHECK (scope IN ('consultant', 'unit')),
        target_user_id uuid        NULL REFERENCES users(id) ON DELETE RESTRICT,
        unit_id        uuid        NULL REFERENCES units(id) ON DELETE RESTRICT,
        target_count   integer     NOT NULL CHECK (target_count > 0),
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_goals_scope_target CHECK (
            (scope = 'consultant' AND target_user_id IS NOT NULL AND unit_id IS NULL)
            OR (scope = 'unit' AND unit_id IS NOT NULL AND target_user_id IS NULL)
        )
    )
    """,
    """
    CREATE UNIQUE INDEX ux_goals_target_per_cycle
        ON goals (cycle_id, target_user_id, unit_id) NULLS NOT DISTINCT
    """,
    """
    CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON goals
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
    # --- win-back flag (spec 10.4) --------------------------------------------
    "ALTER TABLE lost_reasons ADD COLUMN is_recoverable boolean NOT NULL DEFAULT false",
    """
    UPDATE lost_reasons SET is_recoverable = true
    WHERE label IN ('Sem resposta/sumiu', 'Preço/mensalidade', 'Sem ENEM/documentação')
    """,
    # --- objections (spec 12.2) -----------------------------------------------
    """
    CREATE TABLE objections (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
        rebuttal    text        NOT NULL CHECK (char_length(rebuttal) BETWEEN 1 AND 2000),
        template_id uuid        NULL REFERENCES message_templates(id) ON DELETE SET NULL,
        sort_order  integer     NOT NULL DEFAULT 0,
        is_active   boolean     NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TRIGGER trg_objections_updated_at BEFORE UPDATE ON objections
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
    """
    ALTER TABLE deals
        ADD COLUMN objection_id uuid REFERENCES objections(id) ON DELETE RESTRICT
    """,
    """
    CREATE INDEX ix_deals_objection ON deals (objection_id)
        WHERE objection_id IS NOT NULL
    """,
    # --- new activity types (PG16: fine in a txn as long as unused here) ------
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'cycle_changed'",
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'reopened_in_cycle'",
]

DOWNGRADE_STATEMENTS: list[str] = [
    "DROP INDEX IF EXISTS ix_deals_objection",
    "ALTER TABLE deals DROP COLUMN IF EXISTS objection_id",
    "DROP TABLE IF EXISTS objections",
    "ALTER TABLE lost_reasons DROP COLUMN IF EXISTS is_recoverable",
    "DROP TABLE IF EXISTS goals",
    "DROP TABLE IF EXISTS campaign_spend",
    "DROP INDEX IF EXISTS ix_deals_cycle",
    "ALTER TABLE deals DROP COLUMN IF EXISTS cycle_id",
    "DROP TABLE IF EXISTS cycles",
    # PostgreSQL cannot remove enum values; the extra activity_type values stay.
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement.strip())


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement.strip())
