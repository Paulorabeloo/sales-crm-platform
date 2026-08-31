"""Post re-review hardening: token cut-off + indexes for the phase -3 queries.

Additive migration on top of 0003 (no table is recreated, no data rewritten):

- ``users.password_changed_at`` (M8) — stateless revocation cut-off. Access
  tokens issued before this instant are refused by ``get_current_user``, which
  is what makes the extension's 12h token revocable without a refresh channel.
  Backfilled with ``created_at`` so every token minted so far stays valid.
- ``ix_deals_awaiting_first_contact`` (Minor 6) — partial index for the "Respond
  now" section of My Day and for the response-time report, both of which look
  for ``first_whatsapp_contact_at IS NULL``.
- ``ix_deals_recoverable`` (Minor 6) — partial index for the win-back list,
  whose main filter is the INEQUALITY ``cycle_id <> active`` (useless for the
  plain ``ix_deals_cycle``).
- ``ix_activities_deal_type`` (Minor 6) — supports the ``NOT EXISTS`` on
  ``reopened_in_cycle`` used by the win-back list and by the M7 idempotency
  check. Deliberately NOT unique: a unique index would fail to build on any
  base that already holds a duplicated rescue, and the service check plus this
  index cover the real-world case.

Revision ID: 0004_post_review_hardening
Revises: 0003_cycles_spend_goals_objections
Create Date: 2026-08-31
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0004_post_review_hardening"
down_revision: str | None = "0003_cycles_spend_goals_objections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_STATEMENTS: list[str] = [
    # --- M8: password change invalidates already-issued access tokens --------
    """
    ALTER TABLE users
        ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now()
    """,
    "UPDATE users SET password_changed_at = created_at",
    # --- Minor 6: indexes for the phase -3 hot queries -----------------------
    """
    CREATE INDEX ix_deals_awaiting_first_contact ON deals (owner_id, created_at)
        WHERE first_whatsapp_contact_at IS NULL AND deleted_at IS NULL
    """,
    """
    CREATE INDEX ix_deals_recoverable ON deals (cycle_id, lost_reason_id)
        WHERE status = 'lost' AND deleted_at IS NULL
    """,
    "CREATE INDEX ix_activities_deal_type ON activities (deal_id, type)",
]

DOWNGRADE_STATEMENTS: list[str] = [
    "DROP INDEX IF EXISTS ix_activities_deal_type",
    "DROP INDEX IF EXISTS ix_deals_recoverable",
    "DROP INDEX IF EXISTS ix_deals_awaiting_first_contact",
    "ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement.strip())


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement.strip())
