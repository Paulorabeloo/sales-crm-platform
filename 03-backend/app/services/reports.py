"""Management reports — aggregate SQL answering "why aren't we selling?".

All queries are parameterized (period + optional unit/owner) and exclude
soft-deleted deals. Funnel figures come from ``deal_stage_history`` (the
trigger-maintained, tamper-proof stage log).
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Cycle
from app.schemas.report import (
    CacReport,
    CacRow,
    CatalogObjectionRow,
    ConversationRow,
    ConversationsReport,
    CoolingDealRow,
    CoolingOwnerGroup,
    CoolingReport,
    FunnelReport,
    FunnelStageRow,
    LostReasonRow,
    LostReasonsReport,
    NoNextStepRow,
    ObjectionRow,
    ResponseTimeReport,
    ResponseTimeRow,
    SalesReport,
    SalesRow,
    SummaryReport,
)
from app.services.settings import get_cooling_days

_CENT = Decimal("0.01")


def _deal_filters(
    unit_id: uuid.UUID | None,
    owner_id: uuid.UUID | None,
    cycle_id: uuid.UUID | None = None,
) -> tuple[str, dict]:
    """Optional unit/owner/cycle filter fragment on alias ``d`` + bound params."""
    clauses = []
    params: dict[str, Any] = {}
    if unit_id is not None:
        clauses.append("AND d.unit_id = :unit_id")
        params["unit_id"] = str(unit_id)
    if owner_id is not None:
        clauses.append("AND d.owner_id = :owner_id")
        params["owner_id"] = str(owner_id)
    if cycle_id is not None:
        clauses.append("AND d.cycle_id = :cycle_id")
        params["cycle_id"] = str(cycle_id)
    return " ".join(clauses), params


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _prorated_spend(alias: str = "cs") -> str:
    """SQL expression for the share of one monthly spend row that belongs to
    the report period: ``amount * overlap_days / days_in_month`` (M5).

    ``campaign_spend.month`` is always day 1 (DB CHECK), so a month row is
    either fully inside the period or clipped at one of its edges. Counting
    the whole month for a partial period inflated the CAC by up to 2x on the
    default 30-day window, which straddles two months.

    Bound params: ``range_start`` (inclusive date) and ``range_end``
    (exclusive date). Pair it with the ``month >= :month_from AND month <
    :month_to`` filter, which keeps the scan bounded.
    """
    month = f"{alias}.month"
    month_end = f"({month} + INTERVAL '1 month')::date"
    return (
        f"{alias}.amount"
        f" * GREATEST(0, LEAST({month_end}, CAST(:range_end AS date))"
        f" - GREATEST({month}, CAST(:range_start AS date)))::numeric"
        f" / ({month_end} - {month})::numeric"
    )


async def summary_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> SummaryReport:
    """KPI cards: leads in period, cohort conversion, median first-contact
    delay, sales (won in the period) and the average CAC."""
    extra, params = _deal_filters(unit_id, owner_id, cycle_id)
    params |= {"date_from": date_from, "date_to": date_to}

    cohort = (
        await db.execute(
            text(
                f"""
                SELECT COUNT(*) AS leads_count,
                       COUNT(*) FILTER (WHERE d.status = 'won') AS cohort_won,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY
                           EXTRACT(EPOCH FROM d.first_whatsapp_contact_at - d.created_at)
                       ) / 60 AS median_minutes
                FROM deals d
                WHERE d.created_at >= :date_from AND d.created_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                """
            ),
            params,
        )
    ).mappings().one()

    sales = (
        await db.execute(
            text(
                f"""
                SELECT COUNT(*) AS sales_count,
                       COALESCE(SUM(d.value), 0) AS sales_value
                FROM deals d
                WHERE d.status = 'won'
                  AND d.won_at >= :date_from AND d.won_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                """
            ),
            params,
        )
    ).mappings().one()

    # Follow-up discipline: % of OPEN deals without a future
    # next_contact_at, per consultant. Current-state metric — the period
    # filter does not apply; unit/owner filters do.
    nns_params = {k: v for k, v in params.items() if k not in ("date_from", "date_to")}
    no_next_step_rows = (
        await db.execute(
            text(
                f"""
                SELECT d.owner_id,
                       u.name AS owner_name,
                       COUNT(*) AS open_deals,
                       COUNT(*) FILTER (
                           WHERE d.next_contact_at IS NULL
                              OR d.next_contact_at <= now()
                       ) AS without_next_step
                FROM deals d
                LEFT JOIN users u ON u.id = d.owner_id
                WHERE d.status = 'open' AND d.deleted_at IS NULL {extra}
                GROUP BY d.owner_id, u.name
                ORDER BY u.name NULLS FIRST
                """
            ),
            nns_params,
        )
    ).mappings().all()

    # Average CAC: registered spend whose month falls in the
    # period vs enrollments won in the period. Monthly budgets are prorated by
    # the days each month contributes to the period (M5). Spend has no owner
    # dimension, so an owner filter makes the KPI meaningless -> None (never
    # fabricate).
    sales_count = int(sales["sales_count"])
    cac_average: Decimal | None = None
    if owner_id is None and sales_count > 0:
        spend_clause = "AND cs.unit_id = :unit_id" if unit_id is not None else ""
        spend_params: dict[str, Any] = {
            "month_from": _month_floor(date_from.date()),
            "month_to": date_to.date(),
            "range_start": date_from.date(),
            "range_end": date_to.date(),
        }
        if unit_id is not None:
            spend_params["unit_id"] = str(unit_id)
        total_spend = await db.scalar(
            text(
                f"""
                SELECT SUM({_prorated_spend()}) FROM campaign_spend cs
                WHERE cs.month >= :month_from AND cs.month < :month_to {spend_clause}
                """
            ),
            spend_params,
        )
        if total_spend is not None:
            cac_average = (Decimal(total_spend) / sales_count).quantize(
                _CENT, rounding=ROUND_HALF_UP
            )

    leads_count = int(cohort["leads_count"])
    cohort_won = int(cohort["cohort_won"])
    return SummaryReport(
        leads_count=leads_count,
        conversion_rate=round(cohort_won / leads_count, 4) if leads_count else 0.0,
        median_response_minutes=round(float(cohort["median_minutes"]), 1)
        if cohort["median_minutes"] is not None
        else None,
        sales_count=sales_count,
        sales_value=Decimal(sales["sales_value"]),
        cac_average=cac_average,
        no_next_step=[
            NoNextStepRow(
                owner_id=r["owner_id"],
                owner_name=r["owner_name"],
                open_deals=int(r["open_deals"]),
                without_next_step=int(r["without_next_step"]),
                pct=round(100.0 * int(r["without_next_step"]) / int(r["open_deals"]), 1)
                if int(r["open_deals"])
                else 0.0,
            )
            for r in no_next_step_rows
        ],
    )


async def funnel_report(
    db: AsyncSession,
    *,
    pipeline_id: uuid.UUID,
    date_from: datetime,
    date_to: datetime,
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> FunnelReport:
    extra, params = _deal_filters(unit_id, owner_id, cycle_id)
    params |= {
        "pipeline_id": str(pipeline_id),
        "date_from": date_from,
        "date_to": date_to,
    }

    rows = (
        await db.execute(
            text(
                f"""
                SELECT s.id AS stage_id, s.name AS stage_name, s.sort_order,
                       COUNT(DISTINCT h.deal_id) AS deals_entered
                FROM stages s
                LEFT JOIN (
                    SELECT h.stage_id, h.deal_id
                    FROM deal_stage_history h
                    JOIN deals d ON d.id = h.deal_id AND d.deleted_at IS NULL {extra}
                    WHERE h.entered_at >= :date_from AND h.entered_at < :date_to
                ) h ON h.stage_id = s.id
                WHERE s.pipeline_id = :pipeline_id
                GROUP BY s.id, s.name, s.sort_order
                ORDER BY s.sort_order
                """
            ),
            params,
        )
    ).mappings().all()

    stage_rows: list[FunnelStageRow] = []
    previous: int | None = None
    for row in rows:
        entered = int(row["deals_entered"])
        conversion = None
        if previous is not None:
            conversion = round(entered / previous, 4) if previous > 0 else 0.0
        stage_rows.append(
            FunnelStageRow(
                stage_id=row["stage_id"],
                stage_name=row["stage_name"],
                sort_order=row["sort_order"],
                deals_entered=entered,
                conversion_from_previous=conversion,
            )
        )
        previous = entered

    outcome = (
        await db.execute(
            text(
                f"""
                SELECT
                  COUNT(*) FILTER (WHERE d.status = 'won'
                       AND d.won_at  >= :date_from AND d.won_at  < :date_to) AS total_won,
                  COUNT(*) FILTER (WHERE d.status = 'lost'
                       AND d.lost_at >= :date_from AND d.lost_at < :date_to) AS total_lost
                FROM deals d
                WHERE d.pipeline_id = :pipeline_id AND d.deleted_at IS NULL {extra}
                """
            ),
            params,
        )
    ).mappings().one()

    return FunnelReport(
        stages=stage_rows,
        total_entered=stage_rows[0].deals_entered if stage_rows else 0,
        total_won=int(outcome["total_won"]),
        total_lost=int(outcome["total_lost"]),
    )


async def lost_reasons_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    cycle_id: uuid.UUID | None = None,
) -> LostReasonsReport:
    extra, params = _deal_filters(unit_id, owner_id, cycle_id)
    params |= {"date_from": date_from, "date_to": date_to}

    rows = (
        await db.execute(
            text(
                f"""
                SELECT lr.id AS lost_reason_id,
                       lr.label,
                       COUNT(*) AS lost_count,
                       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct,
                       COALESCE(SUM(d.value), 0) AS total_value
                FROM deals d
                JOIN lost_reasons lr ON lr.id = d.lost_reason_id
                WHERE d.status = 'lost'
                  AND d.lost_at >= :date_from AND d.lost_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                GROUP BY lr.id, lr.label
                ORDER BY lost_count DESC
                """
            ),
            params,
        )
    ).mappings().all()

    objections = (
        await db.execute(
            text(
                f"""
                SELECT d.enrollment_data->>'main_objection' AS objection,
                       COUNT(*) AS obj_count
                FROM deals d
                WHERE d.status = 'lost'
                  AND d.lost_at >= :date_from AND d.lost_at < :date_to
                  AND d.deleted_at IS NULL
                  AND COALESCE(d.enrollment_data->>'main_objection', '') <> '' {extra}
                GROUP BY 1
                ORDER BY obj_count DESC
                LIMIT 10
                """
            ),
            params,
        )
    ).mappings().all()

    # Catalog objection grouping: lost deals by deals.objection_id.
    catalog_rows = (
        await db.execute(
            text(
                f"""
                SELECT o.id AS objection_id, o.name, COUNT(*) AS obj_count
                FROM deals d
                JOIN objections o ON o.id = d.objection_id
                WHERE d.status = 'lost'
                  AND d.lost_at >= :date_from AND d.lost_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                GROUP BY o.id, o.name
                ORDER BY obj_count DESC
                """
            ),
            params,
        )
    ).mappings().all()

    return LostReasonsReport(
        total_lost=sum(int(r["lost_count"]) for r in rows),
        reasons=[
            LostReasonRow(
                lost_reason_id=r["lost_reason_id"],
                label=r["label"],
                count=int(r["lost_count"]),
                pct=float(r["pct"]),
                total_value=Decimal(r["total_value"]),
            )
            for r in rows
        ],
        top_objections=[
            ObjectionRow(objection=r["objection"], count=int(r["obj_count"]))
            for r in objections
        ],
        objection_breakdown=[
            CatalogObjectionRow(
                objection_id=r["objection_id"], name=r["name"], count=int(r["obj_count"])
            )
            for r in catalog_rows
        ],
    )


async def response_time_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    cycle_id: uuid.UUID | None = None,
) -> ResponseTimeReport:
    extra, cycle_params = _deal_filters(None, None, cycle_id)
    rows = (
        await db.execute(
            text(
                f"""
                SELECT d.owner_id,
                       u.name AS owner_name,
                       COUNT(*) AS deals,
                       COUNT(*) FILTER (WHERE d.first_whatsapp_contact_at IS NOT NULL)
                           AS contacted,
                       COUNT(*) FILTER (WHERE d.first_whatsapp_contact_at IS NULL)
                           AS never_contacted,
                       AVG(EXTRACT(EPOCH FROM d.first_whatsapp_contact_at - d.created_at))
                           / 60 AS avg_minutes,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY
                           EXTRACT(EPOCH FROM d.first_whatsapp_contact_at - d.created_at)
                       ) / 60 AS median_minutes,
                       percentile_cont(0.9) WITHIN GROUP (ORDER BY
                           EXTRACT(EPOCH FROM d.first_whatsapp_contact_at - d.created_at)
                       ) / 60 AS p90_minutes,
                       ROUND(100.0 * COUNT(*) FILTER (
                           WHERE d.first_whatsapp_contact_at IS NULL
                              OR d.first_whatsapp_contact_at - d.created_at
                                 > interval '24 hours'
                       ) / COUNT(*), 1) AS pct_no_contact_in_24h
                FROM deals d
                LEFT JOIN users u ON u.id = d.owner_id
                WHERE d.created_at >= :date_from AND d.created_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                GROUP BY d.owner_id, u.name
                ORDER BY median_minutes NULLS LAST
                """
            ),
            {"date_from": date_from, "date_to": date_to} | cycle_params,
        )
    ).mappings().all()

    return ResponseTimeReport(
        rows=[
            ResponseTimeRow(
                owner_id=r["owner_id"],
                owner_name=r["owner_name"],
                deals=int(r["deals"]),
                contacted=int(r["contacted"]),
                never_contacted=int(r["never_contacted"]),
                avg_minutes=round(float(r["avg_minutes"]), 1)
                if r["avg_minutes"] is not None else None,
                median_minutes=round(float(r["median_minutes"]), 1)
                if r["median_minutes"] is not None else None,
                p90_minutes=round(float(r["p90_minutes"]), 1)
                if r["p90_minutes"] is not None else None,
                pct_no_contact_in_24h=float(r["pct_no_contact_in_24h"]),
            )
            for r in rows
        ]
    )


async def sales_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    group_by: str,  # "unit" | "owner" | "month"
    cycle_id: uuid.UUID | None = None,
) -> SalesReport:
    extra, cycle_params = _deal_filters(None, None, cycle_id)
    if group_by == "unit":
        key_expr = "COALESCE(p.name, '(sem unit)')"
        id_expr = "d.unit_id"
        joins = "LEFT JOIN units p ON p.id = d.unit_id"
    elif group_by == "owner":
        key_expr = "COALESCE(u.name, '(sem dono)')"
        id_expr = "d.owner_id"
        joins = "LEFT JOIN users u ON u.id = d.owner_id"
    else:  # month
        key_expr = "to_char(date_trunc('month', d.won_at), 'YYYY-MM')"
        id_expr = "NULL::uuid"
        joins = ""

    rows = (
        await db.execute(
            text(
                f"""
                SELECT {key_expr} AS group_key,
                       {id_expr}  AS group_id,
                       COUNT(*)   AS enrollments,
                       COALESCE(SUM(d.value), 0) AS total_value,
                       COALESCE(AVG(d.value), 0) AS avg_ticket
                FROM deals d
                {joins}
                WHERE d.status = 'won'
                  AND d.won_at >= :date_from AND d.won_at < :date_to
                  AND d.deleted_at IS NULL {extra}
                GROUP BY 1, 2
                ORDER BY 1
                """
            ),
            {"date_from": date_from, "date_to": date_to} | cycle_params,
        )
    ).mappings().all()

    total_enrollments = sum(int(r["enrollments"]) for r in rows)
    total_value = sum((Decimal(r["total_value"]) for r in rows), Decimal("0"))
    return SalesReport(
        group_by=group_by,
        rows=[
            SalesRow(
                group_key=r["group_key"],
                group_id=r["group_id"],
                enrollments=int(r["enrollments"]),
                total_value=Decimal(r["total_value"]),
                avg_ticket=Decimal(r["avg_ticket"]).quantize(Decimal("0.01")),
            )
            for r in rows
        ],
        total_enrollments=total_enrollments,
        total_value=total_value,
    )


async def cooling_report(
    db: AsyncSession, *, cycle_id: uuid.UUID | None = None
) -> CoolingReport:
    cooling_days = await get_cooling_days(db)
    cutoff = datetime.now(UTC) - timedelta(days=cooling_days)
    extra, cycle_params = _deal_filters(None, None, cycle_id)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT d.id AS deal_id,
                       d.title,
                       d.owner_id,
                       u.name AS owner_name,
                       s.name AS stage_name,
                       d.last_activity_at,
                       EXTRACT(DAY FROM now() - d.last_activity_at)::int AS days_idle
                FROM deals d
                LEFT JOIN users u ON u.id = d.owner_id
                JOIN stages s ON s.id = d.stage_id
                WHERE d.status = 'open'
                  AND d.deleted_at IS NULL
                  AND d.last_activity_at < :cutoff {extra}
                ORDER BY u.name NULLS FIRST, d.last_activity_at
                """
            ),
            {"cutoff": cutoff} | cycle_params,
        )
    ).mappings().all()

    groups: dict[uuid.UUID | None, CoolingOwnerGroup] = {}
    for r in rows:
        key = r["owner_id"]
        if key not in groups:
            groups[key] = CoolingOwnerGroup(
                owner_id=key, owner_name=r["owner_name"], count=0, deals=[]
            )
        groups[key].deals.append(
            CoolingDealRow(
                deal_id=r["deal_id"],
                title=r["title"],
                stage_name=r["stage_name"],
                last_activity_at=r["last_activity_at"].isoformat(),
                days_idle=int(r["days_idle"]),
            )
        )
        groups[key].count += 1

    return CoolingReport(
        cooling_days=cooling_days,
        total=len(rows),
        groups=list(groups.values()),
    )


# --- CAC ------------------------------------------------------------

_CAC_GROUPS: dict[str, tuple[str, str, str]] = {
    # group_by -> (deals key expr for leads, deals key expr for enrollments,
    #              spend key expr). All coerced to text; NULL = "no attribute".
    "source": ("d.source", "d.source", "cs.source"),
    "campaign": ("d.campaign", "d.campaign", "cs.campaign"),
    "unit": ("d.unit_id::text", "d.unit_id::text", "cs.unit_id::text"),
    "month": (
        "to_char(date_trunc('month', d.created_at), 'YYYY-MM')",
        "to_char(date_trunc('month', d.won_at), 'YYYY-MM')",
        "to_char(cs.month, 'YYYY-MM')",
    ),
}


def _safe_div(spend: Decimal | None, count: int) -> Decimal | None:
    if spend is None or count <= 0:
        return None
    return (spend / count).quantize(_CENT, rounding=ROUND_HALF_UP)


async def cac_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    cycle: Cycle | None,
    group_by: str,  # source | campaign | unit | month
) -> CacReport:
    """Spend x results. Two period modes:

    - ``from``/``to``: leads by ``created_at``, enrollments by ``won_at``,
      spend by the months intersecting the period.
    - ``cycle``: leads/enrollments are the cycle's deals (no date bound);
      spend covers the months from the cycle start to its deadline (or today).

    In both modes a month that the period only touches partially contributes
    its budget PRORATED by days (M5): a 15-day slice of a 30-day month is half
    of that month's spend, never the whole of it.

    Cost fields are None whenever there is no registered spend for the group
    (the report never fabricates a cost)."""
    leads_key, won_key, spend_key = _CAC_GROUPS[group_by]

    if cycle is not None:
        deal_where = "d.deleted_at IS NULL AND d.cycle_id = :cycle_id"
        won_where = deal_where + " AND d.status = 'won'"
        deal_params: dict[str, Any] = {"cycle_id": str(cycle.id)}
        range_start = cycle.starts_on
        range_end = (cycle.deadline_on or datetime.now(UTC).date()) + timedelta(days=1)
        month_from = _month_floor(range_start)
        month_to = range_end
    else:
        deal_where = (
            "d.deleted_at IS NULL"
            " AND d.created_at >= :date_from AND d.created_at < :date_to"
        )
        won_where = (
            "d.deleted_at IS NULL AND d.status = 'won'"
            " AND d.won_at >= :date_from AND d.won_at < :date_to"
        )
        deal_params = {"date_from": date_from, "date_to": date_to}
        range_start = date_from.date()
        range_end = date_to.date()
        month_from = _month_floor(range_start)
        month_to = range_end

    leads_rows = (
        await db.execute(
            text(
                f"SELECT {leads_key} AS gkey, COUNT(*) AS n FROM deals d "
                f"WHERE {deal_where} GROUP BY 1"
            ),
            deal_params,
        )
    ).mappings().all()
    won_rows = (
        await db.execute(
            text(
                f"SELECT {won_key} AS gkey, COUNT(*) AS n FROM deals d "
                f"WHERE {won_where} GROUP BY 1"
            ),
            deal_params,
        )
    ).mappings().all()
    spend_rows = (
        await db.execute(
            text(
                f"SELECT {spend_key} AS gkey, SUM({_prorated_spend()}) AS total "
                "FROM campaign_spend cs "
                "WHERE cs.month >= :month_from AND cs.month < :month_to GROUP BY 1"
            ),
            {
                "month_from": month_from,
                "month_to": month_to,
                "range_start": range_start,
                "range_end": range_end,
            },
        )
    ).mappings().all()

    leads_by_key: dict[str | None, int] = {r["gkey"]: int(r["n"]) for r in leads_rows}
    won_by_key: dict[str | None, int] = {r["gkey"]: int(r["n"]) for r in won_rows}
    # Proration yields fractions of a cent; money is rounded once, here.
    spend_by_key: dict[str | None, Decimal] = {
        r["gkey"]: Decimal(r["total"]).quantize(_CENT, rounding=ROUND_HALF_UP)
        for r in spend_rows
        if r["total"] is not None
    }

    unit_names: dict[str, str] = {}
    if group_by == "unit":
        unit_rows = (
            await db.execute(text("SELECT id::text AS uid, name FROM units"))
        ).mappings().all()
        unit_names = {r["uid"]: r["name"] for r in unit_rows}

    all_keys = set(leads_by_key) | set(won_by_key) | set(spend_by_key)
    rows: list[CacRow] = []
    for key in sorted(all_keys, key=lambda k: (k is None, k or "")):
        spend = spend_by_key.get(key)
        leads = leads_by_key.get(key, 0)
        enrollments = won_by_key.get(key, 0)
        group_id: uuid.UUID | None = None
        group_key: str | None = key
        if group_by == "unit" and key is not None:
            group_id = uuid.UUID(key)
            group_key = unit_names.get(key, key)
        rows.append(
            CacRow(
                group_key=group_key,
                group_id=group_id,
                spend=spend,
                leads_count=leads,
                enrollments=enrollments,
                cost_per_lead=_safe_div(spend, leads),
                cost_per_enrollment=_safe_div(spend, enrollments),
                lead_to_enrollment_rate=round(enrollments / leads, 4) if leads else None,
            )
        )

    total_spend = sum(spend_by_key.values(), Decimal("0")) if spend_by_key else None
    total_leads = sum(leads_by_key.values())
    total_enrollments = sum(won_by_key.values())
    return CacReport(
        group_by=group_by,
        rows=rows,
        total_spend=total_spend,
        total_leads=total_leads,
        total_enrollments=total_enrollments,
        cac_average=_safe_div(total_spend, total_enrollments),
    )


# --- Conversation metrics -------------------------------------------

async def conversations_report(
    db: AsyncSession,
    *,
    date_from: datetime,
    date_to: datetime,
    cycle_id: uuid.UUID | None = None,
) -> ConversationsReport:
    """Per-consultant quick-log outcomes: attempts, real conversations
    (talked_*), contact->conversation rate, scheduled visits, registered
    objections and the % of objection-flagged deals that ended up won."""
    extra, cycle_params = _deal_filters(None, None, cycle_id)
    rows = (
        await db.execute(
            text(
                f"""
                SELECT a.user_id,
                       u.name AS user_name,
                       COUNT(*) FILTER (WHERE a.type = 'attempt_no_answer') AS attempts,
                       COUNT(*) FILTER (
                           WHERE a.type IN ('talked_advance', 'talked_objection')
                       ) AS conversations,
                       COUNT(*) FILTER (WHERE a.type = 'visit_scheduled') AS visits,
                       COUNT(*) FILTER (WHERE a.type = 'talked_objection') AS objections,
                       COUNT(DISTINCT a.deal_id) FILTER (
                           WHERE a.type = 'talked_objection'
                       ) AS objection_deals,
                       COUNT(DISTINCT a.deal_id) FILTER (
                           WHERE a.type = 'talked_objection' AND d.status = 'won'
                       ) AS objection_deals_won
                FROM activities a
                JOIN deals d ON d.id = a.deal_id AND d.deleted_at IS NULL {extra}
                LEFT JOIN users u ON u.id = a.user_id
                WHERE a.created_at >= :date_from AND a.created_at < :date_to
                  AND a.type IN ('attempt_no_answer', 'talked_advance',
                                 'talked_objection', 'visit_scheduled')
                GROUP BY a.user_id, u.name
                ORDER BY u.name NULLS FIRST
                """
            ),
            {"date_from": date_from, "date_to": date_to} | cycle_params,
        )
    ).mappings().all()

    out: list[ConversationRow] = []
    for r in rows:
        attempts = int(r["attempts"])
        conversations = int(r["conversations"])
        contacts = attempts + conversations
        objection_deals = int(r["objection_deals"])
        objection_deals_won = int(r["objection_deals_won"])
        out.append(
            ConversationRow(
                user_id=r["user_id"],
                user_name=r["user_name"],
                attempts=attempts,
                conversations=conversations,
                contact_to_conversation_rate=round(conversations / contacts, 4)
                if contacts
                else None,
                visits_scheduled=int(r["visits"]),
                objections_registered=int(r["objections"]),
                objection_deals=objection_deals,
                objection_deals_won=objection_deals_won,
                objections_overcome_pct=round(
                    100.0 * objection_deals_won / objection_deals, 1
                )
                if objection_deals
                else None,
            )
        )
    return ConversationsReport(rows=out)

