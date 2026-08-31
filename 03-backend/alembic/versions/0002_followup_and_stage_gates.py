"""Wave 1: stage gates, follow-up system, quick-log infra, message templates.

Additive migration on top of 0001 (never edit history that already ran):

- ``stages.required_fields`` (JSONB array of field keys, default ``[]``) —
  per-stage entry gate (spec 08).
- ``stages.playbook`` (nullable text) — per-stage sales guide (spec 12.1).
- ``deals.next_contact_at`` (nullable timestamptz) + partial index on open
  deals — the "next step" rule (spec 09.2).
- ``activity_type`` gains the 4 quick-log values (spec 12.3).
- ``tasks.assigned_to`` / ``tasks.created_by`` become nullable — the webhook
  auto-creates a "Make first contact" task with no assignee and no creator
  (NULL = system); claiming the deal assigns its open unassigned tasks.
- ``message_templates`` table (spec 09.4) — WhatsApp template catalog.

The new default 6-stage funnel (spec 11) is a SEED change, not schema: seeds
were updated and the dev database is recreated (drop/create + alembic + seeds),
which is acceptable in dev per the wave-1 plan.

Revision ID: 0002_followup_and_stage_gates
Revises: 0001_initial_schema
Create Date: 2026-08-28
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0002_followup_and_stage_gates"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_STATEMENTS: list[str] = [
    # --- stages: required-fields gate + playbook -----------------------------
    """
    ALTER TABLE stages
        ADD COLUMN required_fields jsonb NOT NULL DEFAULT '[]'::jsonb
            CHECK (jsonb_typeof(required_fields) = 'array')
    """,
    "ALTER TABLE stages ADD COLUMN playbook text",
    # --- deals: next contact (follow-up next step) ---------------------------
    "ALTER TABLE deals ADD COLUMN next_contact_at timestamptz",
    """
    CREATE INDEX ix_deals_next_contact ON deals (next_contact_at)
        WHERE status = 'open' AND deleted_at IS NULL
    """,
    # --- quick-log activity types (PG16: allowed in a txn, just not usable
    #     inside this same transaction — we never insert them here) -----------
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'attempt_no_answer'",
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'talked_advance'",
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'talked_objection'",
    "ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'visit_scheduled'",
    # --- tasks: allow system-created, unassigned tasks (webhook cadence) -----
    "ALTER TABLE tasks ALTER COLUMN assigned_to DROP NOT NULL",
    "ALTER TABLE tasks ALTER COLUMN created_by DROP NOT NULL",
    # --- message_templates ----------------------------------------------------
    """
    CREATE TABLE message_templates (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
        body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
        sort_order  integer     NOT NULL DEFAULT 0,
        is_active   boolean     NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TRIGGER trg_message_templates_updated_at BEFORE UPDATE ON message_templates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
]

DOWNGRADE_STATEMENTS: list[str] = [
    "DROP TABLE IF EXISTS message_templates",
    # tasks columns back to NOT NULL is unsafe if NULLs exist; leave nullable.
    "DROP INDEX IF EXISTS ix_deals_next_contact",
    "ALTER TABLE deals DROP COLUMN IF EXISTS next_contact_at",
    "ALTER TABLE stages DROP COLUMN IF EXISTS playbook",
    "ALTER TABLE stages DROP COLUMN IF EXISTS required_fields",
    # PostgreSQL cannot remove enum values; the extra activity_type values stay.
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement.strip())


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement.strip())
