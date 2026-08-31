"""Campaign spend + CAC report (spec 10.2) and goals + progress (spec 10.3).

Monthly budgets are prorated by the days each month contributes to the report
period (M5), so every CAC assertion here pins an explicit window instead of
relying on the rolling 30-day default (which straddles two months).
"""

from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from httpx import AsyncClient

from tests.conftest import auth
from tests.test_cycles import create_cycle
from tests.test_deals import create_deal, fill_won_requirements
from tests.test_followup import make_contact

THIS_MONTH = datetime.now(UTC).date().replace(day=1)
DAYS_THIS_MONTH = monthrange(THIS_MONTH.year, THIS_MONTH.month)[1]
LAST_DAY_THIS_MONTH = THIS_MONTH + timedelta(days=DAYS_THIS_MONTH - 1)
NEXT_MONTH = LAST_DAY_THIS_MONTH + timedelta(days=1)
# Whole-month window: every registered month is covered end to end, so
# proration is a no-op and the numbers are exact.
FULL_MONTH_PERIOD = f"from={THIS_MONTH.isoformat()}&to={NEXT_MONTH.isoformat()}"


async def win_deal(client: AsyncClient, token: str, deal_id: str) -> None:
    await fill_won_requirements(client, token, deal_id)
    response = await client.post(
        f"/api/v1/deals/{deal_id}/won", headers=auth(token), json={"value": "500.00"}
    )
    assert response.status_code == 200, response.text


# --- Campaign spend CRUD ------------------------------------------------------


async def test_campaign_spend_crud_admin_only(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    response = await client.get("/api/v1/campaign-spend", headers=auth(consultor_token))
    assert response.status_code == 403

    # Month gets normalized to the first day.
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={
            "month": THIS_MONTH.replace(day=1).isoformat(),
            "source": "meta",
            "campaign": "leads-2026",
            "amount": "1000.00",
        },
    )
    assert response.status_code == 201, response.text
    spend = response.json()
    assert spend["month"] == THIS_MONTH.isoformat()

    # Same combination again -> 409.
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={
            "month": THIS_MONTH.isoformat(),
            "source": "meta",
            "campaign": "leads-2026",
            "amount": "1.00",
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_spend"

    # Different campaign (or null campaign) is a different row.
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": THIS_MONTH.isoformat(), "source": "meta", "amount": "300.00"},
    )
    assert response.status_code == 201

    # PATCH edits the amount; DELETE removes the row.
    response = await client.patch(
        f"/api/v1/campaign-spend/{spend['id']}",
        headers=auth(admin_token),
        json={"amount": "1200.00"},
    )
    assert response.status_code == 200
    assert response.json()["amount"] == "1200.00"
    response = await client.delete(
        f"/api/v1/campaign-spend/{spend['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204
    rows = (
        await client.get("/api/v1/campaign-spend", headers=auth(admin_token))
    ).json()
    assert len(rows) == 1


# --- CAC report ---------------------------------------------------------------


async def test_cac_report_never_fabricates_costs(
    client: AsyncClient, admin_token: str, contact_id: str
):
    # One won deal from source "meta", no spend registered at all. The catalog
    # normalizes "meta" to the key "meta_ads" on the way in (feedback item 5).
    deal = await create_deal(client, admin_token, contact_id, source="meta")
    await win_deal(client, admin_token, deal["id"])

    response = await client.get(
        "/api/v1/reports/cac?group_by=source", headers=auth(admin_token)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    row = next(r for r in body["rows"] if r["group_key"] == "meta_ads")
    assert row["leads_count"] == 1
    assert row["enrollments"] == 1
    assert row["spend"] is None
    assert row["cost_per_lead"] is None
    assert row["cost_per_enrollment"] is None
    assert row["lead_to_enrollment_rate"] == 1.0
    assert body["total_spend"] is None
    assert body["cac_average"] is None


async def test_cac_report_with_spend_and_summary_kpi(
    client: AsyncClient, admin_token: str, contact_id: str
):
    # A cycle spanning the whole month, so cycle mode also sees full budgets.
    cycle = await create_cycle(
        client,
        admin_token,
        "Mes cheio",
        activate=True,
        starts_on=THIS_MONTH.isoformat(),
        deadline_on=LAST_DAY_THIS_MONTH.isoformat(),
    )

    # 2 leads from "meta", 1 won; R$ 1000 spend on "meta" this month (both
    # normalized to the catalog key "meta_ads").
    deal1 = await create_deal(client, admin_token, contact_id, source="meta")
    await win_deal(client, admin_token, deal1["id"])
    contact2 = await make_contact(client, admin_token, "+5563999870002", "Lead 2")
    await create_deal(client, admin_token, contact2, title="Open lead", source="meta")

    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": THIS_MONTH.isoformat(), "source": "meta", "amount": "1000.00"},
    )
    assert response.status_code == 201

    body = (
        await client.get(
            f"/api/v1/reports/cac?group_by=source&{FULL_MONTH_PERIOD}",
            headers=auth(admin_token),
        )
    ).json()
    row = next(r for r in body["rows"] if r["group_key"] == "meta_ads")
    assert row["spend"] == "1000.00"
    assert row["leads_count"] == 2
    assert row["enrollments"] == 1
    assert row["cost_per_lead"] == "500.00"
    assert row["cost_per_enrollment"] == "1000.00"
    assert row["lead_to_enrollment_rate"] == 0.5
    assert body["cac_average"] == "1000.00"

    # Cycle mode: the active cycle holds both deals and covers the whole
    # month -> same numbers.
    body = (
        await client.get(
            f"/api/v1/reports/cac?cycle_id={cycle['id']}&group_by=source",
            headers=auth(admin_token),
        )
    ).json()
    row = next(r for r in body["rows"] if r["group_key"] == "meta_ads")
    assert row["enrollments"] == 1
    assert row["cost_per_enrollment"] == "1000.00"

    # Summary KPI: cac_average = spend / won.
    summary = (
        await client.get(
            f"/api/v1/reports/summary?{FULL_MONTH_PERIOD}", headers=auth(admin_token)
        )
    ).json()
    assert summary["cac_average"] == "1000.00"


async def test_cac_prorates_budget_of_a_partially_covered_month(
    client: AsyncClient, admin_token: str
):
    """M5: a period that covers a month only partially gets that month's
    budget PRORATED by days, never the whole of it.

    June 2026 has 30 days and carries R$ 3.000. A 15-day window must charge
    R$ 1.500 (half), and the full month must still charge R$ 3.000."""
    june = date(2026, 6, 1)
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": june.isoformat(), "source": "google", "amount": "3000.00"},
    )
    assert response.status_code == 201, response.text

    half = (
        await client.get(
            "/api/v1/reports/cac?group_by=source&from=2026-06-01&to=2026-06-16",
            headers=auth(admin_token),
        )
    ).json()
    row = next(r for r in half["rows"] if r["group_key"] == "google_ads")
    assert row["spend"] == "1500.00"
    assert half["total_spend"] == "1500.00"
    # No lead or enrollment in that window: costs stay None, never fabricated.
    assert row["leads_count"] == 0
    assert row["cost_per_lead"] is None
    assert half["cac_average"] is None

    full = (
        await client.get(
            "/api/v1/reports/cac?group_by=source&from=2026-06-01&to=2026-07-01",
            headers=auth(admin_token),
        )
    ).json()
    assert full["total_spend"] == "3000.00"

    # A window touching two months only takes each month's covered slice:
    # 10 of June's 30 days (1.000) + 0 days of July (no row) = 1.000.
    edge = (
        await client.get(
            "/api/v1/reports/cac?group_by=source&from=2026-06-21&to=2026-07-11",
            headers=auth(admin_token),
        )
    ).json()
    assert edge["total_spend"] == "1000.00"

    # Same rule on the summary KPI: no enrollment -> no fabricated CAC.
    summary = (
        await client.get(
            "/api/v1/reports/summary?from=2026-06-01&to=2026-06-16",
            headers=auth(admin_token),
        )
    ).json()
    assert summary["cac_average"] is None


async def test_summary_cac_prorates_monthly_budget(
    client: AsyncClient, admin_token: str, contact_id: str
):
    """M5 on the summary KPI: half a month of budget over the enrollments of
    that half, instead of the whole month's budget."""
    deal = await create_deal(client, admin_token, contact_id, source="meta")
    await win_deal(client, admin_token, deal["id"])

    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": THIS_MONTH.isoformat(), "source": "meta", "amount": "1000.00"},
    )
    assert response.status_code == 201, response.text

    # Whole month covered -> the whole budget, one enrollment.
    full = (
        await client.get(
            f"/api/v1/reports/summary?{FULL_MONTH_PERIOD}", headers=auth(admin_token)
        )
    ).json()
    assert full["sales_count"] == 1
    assert full["cac_average"] == "1000.00"

    # Previous month, half covered: only its covered days count. The window
    # ends tomorrow so the enrollment (won today) is still inside it, and the
    # current month has no spend row, which isolates the prorated slice.
    prev_month = THIS_MONTH - timedelta(days=1)
    prev_month = prev_month.replace(day=1)
    days_prev = monthrange(prev_month.year, prev_month.month)[1]
    window_start = prev_month + timedelta(days=15)
    covered = days_prev - 15
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={
            "month": prev_month.isoformat(),
            "source": "meta-anterior",
            "amount": "3000.00",
        },
    )
    assert response.status_code == 201, response.text

    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    partial = (
        await client.get(
            f"/api/v1/reports/summary?from={window_start.isoformat()}"
            f"&to={tomorrow.isoformat()}",
            headers=auth(admin_token),
        )
    ).json()
    assert partial["sales_count"] == 1
    # 3000 * covered/days_prev (previous month) + 1000 (current month, fully
    # covered from day 1 to today... only up to today, so prorate it too).
    covered_this_month = (tomorrow - THIS_MONTH).days
    expected = (
        Decimal(3000) * covered / days_prev
        + Decimal(1000) * covered_this_month / DAYS_THIS_MONTH
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    assert Decimal(partial["cac_average"]) == expected


async def test_summary_cac_none_without_spend(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)
    await win_deal(client, admin_token, deal["id"])
    summary = (
        await client.get("/api/v1/reports/summary", headers=auth(admin_token))
    ).json()
    assert summary["sales_count"] == 1
    assert summary["cac_average"] is None


# --- Goals --------------------------------------------------------------------


async def test_goal_crud_validation_and_rbac(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    active = (
        await client.get("/api/v1/cycles/active", headers=auth(admin_token))
    ).json()
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()

    # Consultor cannot manage goals.
    response = await client.post(
        "/api/v1/goals",
        headers=auth(consultor_token),
        json={
            "cycle_id": active["id"],
            "scope": "consultant",
            "target_user_id": me["id"],
            "target_count": 5,
        },
    )
    assert response.status_code == 403

    # XOR: consultant scope with unit_id -> 422 (schema).
    units = (await client.get("/api/v1/units", headers=auth(admin_token))).json()
    response = await client.post(
        "/api/v1/goals",
        headers=auth(admin_token),
        json={
            "cycle_id": active["id"],
            "scope": "consultant",
            "unit_id": units[0]["id"],
            "target_count": 5,
        },
    )
    assert response.status_code == 422

    response = await client.post(
        "/api/v1/goals",
        headers=auth(admin_token),
        json={
            "cycle_id": active["id"],
            "scope": "consultant",
            "target_user_id": me["id"],
            "target_count": 4,
        },
    )
    assert response.status_code == 201, response.text
    goal = response.json()

    # Same target in the same cycle -> 409.
    response = await client.post(
        "/api/v1/goals",
        headers=auth(admin_token),
        json={
            "cycle_id": active["id"],
            "scope": "consultant",
            "target_user_id": me["id"],
            "target_count": 9,
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_goal"

    # PATCH retargets the count; DELETE removes.
    response = await client.patch(
        f"/api/v1/goals/{goal['id']}", headers=auth(admin_token), json={"target_count": 6}
    )
    assert response.status_code == 200
    assert response.json()["target_count"] == 6
    response = await client.delete(
        f"/api/v1/goals/{goal['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204


async def test_goal_progress_and_my_progress(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    active = (
        await client.get("/api/v1/cycles/active", headers=auth(admin_token))
    ).json()
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    units = (await client.get("/api/v1/units", headers=auth(admin_token))).json()
    unit_id = units[0]["id"]

    for payload in (
        {
            "cycle_id": active["id"],
            "scope": "consultant",
            "target_user_id": me["id"],
            "target_count": 2,
        },
        {
            "cycle_id": active["id"],
            "scope": "unit",
            "unit_id": unit_id,
            "target_count": 10,
        },
    ):
        response = await client.post(
            "/api/v1/goals", headers=auth(admin_token), json=payload
        )
        assert response.status_code == 201, response.text

    # One enrollment by the consultant in that unit.
    contact = await make_contact(client, consultor_token, "+5563999870010", "Goal lead")
    deal = await create_deal(
        client, consultor_token, contact, title="Goal deal", unit_id=unit_id
    )
    await win_deal(client, consultor_token, deal["id"])

    # Admin ranking: consultant goal 1/2 (50%), unit goal 1/10 (10%).
    progress = (
        await client.get("/api/v1/goals/progress", headers=auth(admin_token))
    ).json()
    assert progress["cycle_id"] == active["id"]
    by_scope = {r["scope"]: r for r in progress["rows"]}
    assert by_scope["consultant"]["won_count"] == 1
    assert by_scope["consultant"]["pct"] == 50.0
    assert by_scope["consultant"]["target_user_name"] == me["name"]
    assert by_scope["unit"]["won_count"] == 1
    assert by_scope["unit"]["pct"] == 10.0
    # Ranked by pct desc.
    assert progress["rows"][0]["scope"] == "consultant"

    # Progress endpoint is admin-only; my-progress serves the consultant.
    response = await client.get("/api/v1/goals/progress", headers=auth(consultor_token))
    assert response.status_code == 403
    mine = (
        await client.get("/api/v1/goals/my-progress", headers=auth(consultor_token))
    ).json()
    assert len(mine["rows"]) == 1
    assert mine["rows"][0]["target_user_id"] == me["id"]
    assert mine["rows"][0]["won_count"] == 1


async def test_cac_cycle_window_covers_deals_created_before_the_cycle_start(
    client: AsyncClient, admin_token: str, db_session_factory
):
    """The cycle spend window must COVER the deals it measures.

    Deals legitimately predate ``starts_on``: rollover carries open deals over
    from the previous cycle, and a cycle is often created after its leads
    already exist. When the window did not stretch back to them, the report
    divided months of leads by a single day of budget and the cost per
    enrollment came out roughly thirty times too cheap.
    """
    from sqlalchemy import text as sa_text

    today = datetime.now(UTC).date()
    cycle_id = (
        await create_cycle(
            client,
            admin_token,
            name="Janela",
            starts_on=today.isoformat(),
            activate=True,
        )
    )["id"]

    contact = await make_contact(client, admin_token, "+5563999870077", "Lead antigo")
    deal_id = (await create_deal(client, admin_token, contact, source="google"))["id"]

    # The lead entered two months before the cycle was opened.
    old_month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    old_created = datetime(old_month.year, old_month.month, 15, 12, 0, tzinfo=UTC)
    async with db_session_factory() as session:
        await session.execute(
            sa_text("UPDATE deals SET created_at = :ts WHERE id = :id"),
            {"ts": old_created, "id": deal_id},
        )
        await session.commit()

    days_in_old_month = monthrange(old_month.year, old_month.month)[1]
    await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": old_month.isoformat(), "source": "google", "amount": "3100.00"},
    )

    response = await client.get(
        f"/api/v1/reports/cac?group_by=source&cycle_id={cycle_id}",
        headers=auth(admin_token),
    )
    assert response.status_code == 200, response.text
    report = response.json()
    row = next(r for r in report["rows"] if r["group_key"] == "google_ads")

    # The lead is counted, so the budget of its month must be counted with it.
    # The window starts at the oldest deal (day 15), so that month contributes
    # its last 17 of 31 days: budget spent before the cycle's first lead
    # belongs to the previous cycle, not to this one.
    covered = days_in_old_month - old_created.day + 1
    expected = (Decimal("3100.00") * covered / days_in_old_month).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    one_day = (Decimal("3100.00") / days_in_old_month).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    assert row["leads_count"] == 1
    assert row["spend"] == str(expected), (
        "the spend window must reach back to the oldest deal of the cycle; "
        f"got {row['spend']}, expected {expected} "
        f"(the bug charged a single day: {one_day})"
    )
    assert Decimal(row["spend"]) > one_day * 5
