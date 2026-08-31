"""Source catalog + normalization of the existing source text (feedback item 5).

Additive migration on top of 0004 (no table is recreated, no row is deleted):

- new table ``sources`` (normalized ``key``, pt-BR ``label``, ``is_active``,
  ``sort_order``) seeded with the 8 default channels;
- ``deals.source`` and ``campaign_spend.source`` STAY plain TEXT (no FK, no
  type change), so nothing that reads them breaks. What changes is the value:
  every non-empty source is rewritten through the same normalization the write
  path now uses (``app/services/sources.canonical_source_key``): trim,
  lowercase, drop accents, collapse separators into ``_``, then map the
  well-known spellings of a channel onto one catalog key ("meta", "Facebook",
  "ig" -> ``meta_ads``). Values with no obvious catalog match are only
  normalized, never remapped, and any value already normalized is left alone.
  The rewrite is reported per table in the migration log.
- ``ix_deals_source`` supports the CAC grouping, and ``ix_deals_stage_board``
  supports the capped kanban columns (feedback item 3), whose ranking runs per
  stage over the non-deleted deals.

Revision ID: 0005_sources_catalog
Revises: 0004_post_review_hardening
Create Date: 2026-08-31
"""
import logging
import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.services.sources import SOURCE_SEEDS, canonical_source_key

revision: str = "0005_sources_catalog"
down_revision: str | None = "0004_post_review_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.0005_sources_catalog")

KEY_RE = re.compile(r"^[a-z0-9_]{1,120}$")  # mirrors the CHECK on sources.key

CREATE_STATEMENTS: list[str] = [
    """
    CREATE TABLE sources (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        key        text        NOT NULL UNIQUE
                               CHECK (key ~ '^[a-z0-9_]{1,120}$'),
        label      text        NOT NULL
                               CHECK (char_length(label) BETWEEN 1 AND 120),
        is_active  boolean     NOT NULL DEFAULT true,
        sort_order integer     NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TRIGGER trg_sources_updated_at BEFORE UPDATE ON sources
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    """,
    # CAC groups deals by source; the board ranks cards per stage.
    "CREATE INDEX ix_deals_source ON deals (source) WHERE deleted_at IS NULL",
    """
    CREATE INDEX ix_deals_stage_board ON deals (stage_id, status, last_activity_at)
        WHERE deleted_at IS NULL
    """,
]

DROP_STATEMENTS: list[str] = [
    "DROP INDEX IF EXISTS ix_deals_stage_board",
    "DROP INDEX IF EXISTS ix_deals_source",
    "DROP TABLE IF EXISTS sources",
]


def _seed_sources(bind: sa.Connection) -> None:
    for key, label, sort_order in SOURCE_SEEDS:
        bind.execute(
            sa.text(
                "INSERT INTO sources (key, label, sort_order) "
                "VALUES (:key, :label, :sort_order) ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "label": label, "sort_order": sort_order},
        )


def _normalize_table(bind: sa.Connection, table: str) -> tuple[int, int]:
    """Rewrite ``<table>.source`` with the canonical key.

    Returns ``(rows_changed, distinct_values_changed)``."""
    rows = bind.execute(
        sa.text(
            f"SELECT source, count(*) AS n FROM {table} "  # noqa: S608 - fixed names
            "WHERE source IS NOT NULL GROUP BY source"
        )
    ).all()
    rows_changed = 0
    values_changed = 0
    for raw, count in rows:
        canonical = canonical_source_key(raw)
        if canonical is None:
            # Blank/garbage source ("", "   "): NULL says "unknown" honestly.
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET source = NULL WHERE source = :old"  # noqa: S608
                ),
                {"old": raw},
            )
            rows_changed += count
            values_changed += 1
            logger.info("%s.source: %r -> NULL (%s rows)", table, raw, count)
            continue
        if canonical == raw:
            continue
        bind.execute(
            sa.text(
                f"UPDATE {table} SET source = :new WHERE source = :old"  # noqa: S608
            ),
            {"new": canonical, "old": raw},
        )
        rows_changed += count
        values_changed += 1
        logger.info("%s.source: %r -> %r (%s rows)", table, raw, canonical, count)
    return rows_changed, values_changed


def _register_leftovers(bind: sa.Connection) -> int:
    """Register every source key still in use that is not in the catalog.

    They come in INACTIVE (they stay out of the frontend selects) with the key
    itself as a provisional label, so the admin can see, rename or merge what
    the base actually holds instead of discovering it in a broken CAC report."""
    registered = 0
    keys = bind.execute(
        sa.text(
            """
            SELECT DISTINCT source FROM (
                SELECT source FROM deals WHERE source IS NOT NULL
                UNION
                SELECT source FROM campaign_spend WHERE source IS NOT NULL
            ) used
            """
        )
    ).scalars().all()
    for key in keys:
        if not KEY_RE.match(key):  # defensive: normalization already ran
            continue
        result = bind.execute(
            sa.text(
                "INSERT INTO sources (key, label, is_active, sort_order) "
                "VALUES (:key, :label, false, 999) ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "label": key[:120]},
        )
        registered += result.rowcount or 0
    return registered


def upgrade() -> None:
    for statement in CREATE_STATEMENTS:
        op.execute(statement.strip())
    bind = op.get_bind()
    _seed_sources(bind)
    total_rows = 0
    for table in ("deals", "campaign_spend"):
        rows_changed, values_changed = _normalize_table(bind, table)
        total_rows += rows_changed
        logger.info(
            "Normalized %s.source: %s rows, %s distinct values",
            table,
            rows_changed,
            values_changed,
        )
    registered = _register_leftovers(bind)
    logger.info(
        "Source catalog ready: %s rows normalized, %s unknown keys registered "
        "as inactive",
        total_rows,
        registered,
    )


def downgrade() -> None:
    for statement in DROP_STATEMENTS:
        op.execute(statement.strip())
