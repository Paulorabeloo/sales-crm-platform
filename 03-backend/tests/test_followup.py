"""Follow-up system + quick-log infra + new funnel: next_contact_at handling, My Day aggregate, cadence settings,
webhook auto-task + claim assignment, message templates, summary metric."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import auth
from tests.test_deals import create_deal, get_stages


async def make_contact(client: AsyncClient, token: str, phone: str, name: str) -> str:
    response = await client.post(
        "/api/v1/contacts",
        headers=auth(token),
        json={"name": name, "phone_whatsapp": phone},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# --- next_contact_at ----------------------------------------------------------


async def test_patch_next_contact_at_set_and_clear(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)
    assert deal["next_contact_at"] is None

    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"next_contact_at": when},
    )
    assert response.status_code == 200
    assert response.json()["next_contact_at"] is not None

    # Explicit null clears the next step.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"next_contact_at": None},
    )
    assert response.status_code == 200
    assert response.json()["next_contact_at"] is None


async def test_stage_move_and_first_contact_accept_next_contact(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)

    when = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/first-contact",
        headers=auth(admin_token),
        json={"next_contact_at": when},
    )
    assert response.status_code == 200
    assert response.json()["next_contact_at"] is not None

    later = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Tentando contato"]["id"], "next_contact_at": later},
    )
    assert response.status_code == 200
    assert response.json()["next_contact_at"].startswith(later[:10])


# --- Quick log ----------------------------------------------------


async def test_quick_log_kinds_create_typed_activities(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    # Two no-answer attempts -> attempts_count grows (cadence input).
    for expected in (1, 2):
        response = await client.post(
            f"/api/v1/deals/{deal['id']}/log",
            headers=auth(admin_token),
            json={"kind": "attempt_no_answer", "note": "no reply"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["attempts_count"] == expected

    # Talked kinds do not touch attempts_count.
    for kind in ("talked_advance", "talked_objection"):
        response = await client.post(
            f"/api/v1/deals/{deal['id']}/log",
            headers=auth(admin_token),
            json={"kind": kind},
        )
        assert response.status_code == 200
        assert response.json()["attempts_count"] == 2

    timeline = await client.get(
        f"/api/v1/deals/{deal['id']}/activities", headers=auth(admin_token)
    )
    types = [a["type"] for a in timeline.json()["items"]]
    assert types.count("attempt_no_answer") == 2
    assert "talked_advance" in types
    assert "talked_objection" in types

    # Invalid kind is rejected by the schema.
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "note"},
    )
    assert response.status_code == 422


async def test_quick_log_stores_next_contact_at(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)
    when = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "attempt_no_answer", "next_contact_at": when},
    )
    assert response.status_code == 200
    assert response.json()["deal"]["next_contact_at"] is not None


async def test_quick_log_registers_first_contact_and_leaves_respond_now(
    client: AsyncClient, admin_token: str, contact_id: str
):
    """QA-final fix: the first quick log on an untouched lead IS
    the first contact — it sets first_whatsapp_contact_at (write-once) and the
    lead leaves My Day's respond_now section."""
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    deal = await create_deal(
        client, admin_token, contact_id, title="Quick log touch", owner_id=admin_me["id"]
    )
    assert deal["first_whatsapp_contact_at"] is None

    body = (await client.get("/api/v1/my-day", headers=auth(admin_token))).json()
    assert deal["id"] in {d["deal_id"] for d in body["respond_now"]}

    tomorrow = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "attempt_no_answer", "next_contact_at": tomorrow},
    )
    assert response.status_code == 200, response.text
    first_contact = response.json()["deal"]["first_whatsapp_contact_at"]
    assert first_contact is not None

    # Timeline gets the write-once registration event (via quick_log).
    timeline = (
        await client.get(
            f"/api/v1/deals/{deal['id']}/activities", headers=auth(admin_token)
        )
    ).json()["items"]
    registered = [a for a in timeline if a["type"] == "first_contact_registered"]
    assert len(registered) == 1
    assert registered[0]["payload"]["via"] == "quick_log"

    # A second quick log does NOT touch the write-once timestamp.
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "attempt_no_answer"},
    )
    assert response.status_code == 200
    assert response.json()["deal"]["first_whatsapp_contact_at"] == first_contact

    # Contacted + next contact tomorrow -> out of respond_now (and of My Day).
    body = (await client.get("/api/v1/my-day", headers=auth(admin_token))).json()
    assert deal["id"] not in {d["deal_id"] for d in body["respond_now"]}
    assert deal["id"] not in {d["deal_id"] for d in body["today"]["followups"]}
    assert deal["id"] not in {d["deal_id"] for d in body["overdue"]["followups"]}


async def test_quick_log_visit_requires_date_and_creates_task(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "visit_scheduled"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "visit_requires_next_contact_at"

    visit_at = datetime.now(UTC) + timedelta(days=2)
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "visit_scheduled", "next_contact_at": visit_at.isoformat()},
    )
    assert response.status_code == 200
    assert response.json()["deal"]["next_contact_at"] is not None

    tasks = await client.get(
        f"/api/v1/deals/{deal['id']}/tasks", headers=auth(admin_token)
    )
    visit_tasks = [t for t in tasks.json() if t["title"] == "Visit"]
    assert len(visit_tasks) == 1
    assert visit_tasks[0]["due_date"] == visit_at.date().isoformat()


# --- Webhook cadence + claim --------------------------------------


async def create_source(client: AsyncClient, admin_token: str) -> dict:
    response = await client.post(
        "/api/v1/lead-sources",
        headers=auth(admin_token),
        json={"name": "LP Followup Test"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_webhook_lead_lands_in_new_first_stage_with_auto_task(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    source = await create_source(client, admin_token)
    stages = await get_stages(client, admin_token)

    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "Lead Funil Novo", "phone": "+5563999997777"},
    )
    assert response.status_code == 202, response.text
    deal_id = response.json()["deal_id"]

    deal = (
        await client.get(f"/api/v1/deals/{deal_id}", headers=auth(admin_token))
    ).json()
    assert deal["stage_id"] == stages["Novo lead"]["id"]

    # Auto "Make first contact" task: due today, unassigned, system-created.
    tasks = (
        await client.get(f"/api/v1/deals/{deal_id}/tasks", headers=auth(admin_token))
    ).json()
    assert len(tasks) == 1
    task = tasks[0]
    assert task["title"] == "Make first contact"
    assert task["assigned_to"] is None
    assert task["created_by"] is None
    assert task["due_date"] == datetime.now(UTC).date().isoformat()

    # Claiming the deal assigns its open unassigned tasks to the claimer.
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    claim = await client.post(
        f"/api/v1/deals/{deal_id}/claim", headers=auth(consultor_token)
    )
    assert claim.status_code == 200
    tasks = (
        await client.get(f"/api/v1/deals/{deal_id}/tasks", headers=auth(consultor_token))
    ).json()
    assert tasks[0]["assigned_to"] == me["id"]


async def test_auto_first_contact_task_can_be_disabled(
    client: AsyncClient, admin_token: str
):
    response = await client.patch(
        "/api/v1/settings",
        headers=auth(admin_token),
        json={"auto_first_contact_task": False},
    )
    assert response.status_code == 200
    assert response.json()["auto_first_contact_task"] is False

    source = await create_source(client, admin_token)
    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "Sem Task", "phone": "+5563999996666"},
    )
    assert response.status_code == 202
    deal_id = response.json()["deal_id"]
    tasks = (
        await client.get(f"/api/v1/deals/{deal_id}/tasks", headers=auth(admin_token))
    ).json()
    assert tasks == []


# --- Cadence settings ---------------------------------------------


async def test_settings_expose_and_update_cadence(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    response = await client.get("/api/v1/settings", headers=auth(consultor_token))
    assert response.status_code == 200
    body = response.json()
    assert body["auto_first_contact_task"] is True
    assert body["followup_cadence"] == [1, 3, 7]

    response = await client.patch(
        "/api/v1/settings",
        headers=auth(admin_token),
        json={"followup_cadence": [2, 5]},
    )
    assert response.status_code == 200
    assert response.json()["followup_cadence"] == [2, 5]

    # Invalid cadence entries are rejected; consultor writes are forbidden.
    response = await client.patch(
        "/api/v1/settings", headers=auth(admin_token), json={"followup_cadence": [0]}
    )
    assert response.status_code == 422
    response = await client.patch(
        "/api/v1/settings",
        headers=auth(consultor_token),
        json={"followup_cadence": [1]},
    )
    assert response.status_code == 403


# --- Message templates --------------------------------------------


async def test_message_templates_seeded_and_readable(
    client: AsyncClient, consultor_token: str
):
    response = await client.get(
        "/api/v1/message-templates", headers=auth(consultor_token)
    )
    assert response.status_code == 200
    names = [t["name"] for t in response.json()]
    assert names == ["Primeiro contato", "Lembrete", "Resgate"]
    assert "{{first_name}}" in response.json()[0]["body"]


async def test_message_templates_crud_is_admin_only(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    response = await client.post(
        "/api/v1/message-templates",
        headers=auth(consultor_token),
        json={"name": "X", "body": "Y"},
    )
    assert response.status_code == 403

    response = await client.post(
        "/api/v1/message-templates",
        headers=auth(admin_token),
        json={"name": "Boas-vindas", "body": "Olá {{first_name}}!", "sort_order": 9},
    )
    assert response.status_code == 201, response.text
    template = response.json()

    # Duplicate name -> 409.
    response = await client.post(
        "/api/v1/message-templates",
        headers=auth(admin_token),
        json={"name": "Boas-vindas", "body": "dup"},
    )
    assert response.status_code == 409

    # Deactivate -> disappears from the default list, visible with the flag.
    response = await client.patch(
        f"/api/v1/message-templates/{template['id']}",
        headers=auth(admin_token),
        json={"is_active": False},
    )
    assert response.status_code == 200
    names = [
        t["name"]
        for t in (
            await client.get("/api/v1/message-templates", headers=auth(admin_token))
        ).json()
    ]
    assert "Boas-vindas" not in names
    names = [
        t["name"]
        for t in (
            await client.get(
                "/api/v1/message-templates?include_inactive=true",
                headers=auth(admin_token),
            )
        ).json()
    ]
    assert "Boas-vindas" in names

    response = await client.delete(
        f"/api/v1/message-templates/{template['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204


# --- My Day -------------------------------------------------------


async def test_my_day_sections_and_scope(
    client: AsyncClient, admin_token: str, consultor_token: str, db_session_factory
):
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    now = datetime.now(UTC)

    async def own_deal(phone: str, title: str) -> dict:
        contact = await make_contact(client, consultor_token, phone, title)
        return await create_deal(client, consultor_token, contact, title=title)

    # 1. Own deal without first contact -> respond_now.
    fresh = await own_deal("+5563999980001", "Fresh lead")

    # 2. Queue deal (no owner) -> respond_now too.
    queue_contact = await make_contact(client, admin_token, "+5563999980002", "Queue")
    queue = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={"title": "Queue lead", "contact_id": queue_contact, "owner_id": None},
    )
    assert queue.status_code == 201

    # 3. Contacted deal with next_contact today -> today.followups.
    today_deal = await own_deal("+5563999980003", "Today follow-up")
    r = await client.post(
        f"/api/v1/deals/{today_deal['id']}/first-contact",
        headers=auth(consultor_token),
        json={"next_contact_at": now.isoformat()},
    )
    assert r.status_code == 200

    # 4. Contacted deal with next_contact in the past -> overdue.followups.
    overdue_deal = await own_deal("+5563999980004", "Overdue follow-up")
    r = await client.post(
        f"/api/v1/deals/{overdue_deal['id']}/first-contact",
        headers=auth(consultor_token),
        json={"next_contact_at": (now - timedelta(days=2)).isoformat()},
    )
    assert r.status_code == 200

    # 5. Cooling deal, contacted, no next step -> cooling_no_next_step.
    cooling_deal = await own_deal("+5563999980005", "Cooling deal")
    r = await client.post(
        f"/api/v1/deals/{cooling_deal['id']}/first-contact",
        headers=auth(consultor_token),
    )
    assert r.status_code == 200
    async with db_session_factory() as session:
        await session.execute(
            text(
                "UPDATE deals SET last_activity_at = now() - interval '5 days' "
                "WHERE id = :id"
            ),
            {"id": cooling_deal["id"]},
        )
        await session.commit()

    # 6. Admin-owned deal -> must NOT appear for the consultant.
    foreign_contact = await make_contact(client, admin_token, "+5563999980006", "F")
    r = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={
            "title": "Foreign deal",
            "contact_id": foreign_contact,
            "owner_id": admin_me["id"],
        },
    )
    assert r.status_code == 201

    # 7. Tasks: one due today, one overdue (on the consultant's own deal).
    for title, due in (
        ("Call today", now.date()),
        ("Call yesterday", (now - timedelta(days=1)).date()),
    ):
        r = await client.post(
            f"/api/v1/deals/{fresh['id']}/tasks",
            headers=auth(consultor_token),
            json={"title": title, "due_date": due.isoformat()},
        )
        assert r.status_code == 201

    response = await client.get("/api/v1/my-day", headers=auth(consultor_token))
    assert response.status_code == 200
    body = response.json()

    respond_titles = {d["title"] for d in body["respond_now"]}
    assert {"Fresh lead", "Queue lead"} <= respond_titles
    assert "Foreign deal" not in respond_titles
    assert body["respond_now"][0]["contact_phone"].startswith("+55")

    assert [d["title"] for d in body["today"]["followups"]] == ["Today follow-up"]
    assert [d["title"] for d in body["overdue"]["followups"]] == ["Overdue follow-up"]
    assert [d["title"] for d in body["cooling_no_next_step"]] == ["Cooling deal"]
    assert body["cooling_no_next_step"][0]["is_cooling"] is True

    assert [t["title"] for t in body["today"]["tasks"]] == ["Call today"]
    assert [t["title"] for t in body["overdue"]["tasks"]] == ["Call yesterday"]

    # Admin filtered by the consultant sees the same deal sections.
    response = await client.get(
        f"/api/v1/my-day?owner_id={me['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 200
    admin_view = response.json()
    assert {d["title"] for d in admin_view["respond_now"]} == respond_titles

    # Admin without a filter sees the whole team (foreign deal included).
    response = await client.get("/api/v1/my-day", headers=auth(admin_token))
    assert response.status_code == 200
    assert "Foreign deal" in {d["title"] for d in response.json()["respond_now"]}

    # Consultor cannot peek at another owner through the filter (ignored).
    response = await client.get(
        f"/api/v1/my-day?owner_id={admin_me['id']}", headers=auth(consultor_token)
    )
    assert "Foreign deal" not in {d["title"] for d in response.json()["respond_now"]}


# --- Reports: % without next step ---------------------------------


async def test_summary_report_includes_no_next_step_breakdown(
    client: AsyncClient, admin_token: str, contact_id: str
):
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    deal = await create_deal(client, admin_token, contact_id, owner_id=admin_me["id"])

    contact2 = await make_contact(client, admin_token, "+5563999980010", "Second")
    deal2 = await create_deal(
        client, admin_token, contact2, title="With next step", owner_id=admin_me["id"]
    )
    r = await client.patch(
        f"/api/v1/deals/{deal2['id']}",
        headers=auth(admin_token),
        json={"next_contact_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
    )
    assert r.status_code == 200
    assert deal["next_contact_at"] is None

    response = await client.get("/api/v1/reports/summary", headers=auth(admin_token))
    assert response.status_code == 200
    rows = response.json()["no_next_step"]
    row = next(r for r in rows if r["owner_id"] == admin_me["id"])
    assert row["open_deals"] == 2
    assert row["without_next_step"] == 1
    assert row["pct"] == 50.0
