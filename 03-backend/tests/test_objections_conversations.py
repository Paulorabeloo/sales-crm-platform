"""Objection catalog (spec 12.2) + conversation metrics (spec 12.3)."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import auth
from tests.test_cac_goals import win_deal
from tests.test_deals import create_deal
from tests.test_followup import make_contact


async def get_objections(client: AsyncClient, token: str) -> dict[str, dict]:
    response = await client.get("/api/v1/objections", headers=auth(token))
    assert response.status_code == 200, response.text
    return {o["name"]: o for o in response.json()}


# --- Catalog ------------------------------------------------------------------


async def test_objections_seeded_and_readable(
    client: AsyncClient, consultor_token: str
):
    objections = await get_objections(client, consultor_token)
    assert set(objections) == {
        "Preço", "Vou pensar", "Preciso consultar alguém", "Sem tempo agora"
    }
    for o in objections.values():
        assert o["rebuttal"]
        assert "—" not in o["rebuttal"]  # seed texts carry no em dash
        assert o["template_id"] is None


async def test_objections_crud_admin_only(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    response = await client.post(
        "/api/v1/objections",
        headers=auth(consultor_token),
        json={"name": "X", "rebuttal": "Y"},
    )
    assert response.status_code == 403

    # Template link must exist.
    response = await client.post(
        "/api/v1/objections",
        headers=auth(admin_token),
        json={
            "name": "Distância",
            "rebuttal": "Ofereça a modalidade a distância.",
            "template_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_template"

    templates = (
        await client.get("/api/v1/message-templates", headers=auth(admin_token))
    ).json()
    response = await client.post(
        "/api/v1/objections",
        headers=auth(admin_token),
        json={
            "name": "Distância",
            "rebuttal": "Ofereça a modalidade a distância.",
            "template_id": templates[0]["id"],
            "sort_order": 9,
        },
    )
    assert response.status_code == 201, response.text
    objection = response.json()
    assert objection["template_id"] == templates[0]["id"]

    # Duplicate name -> 409.
    response = await client.post(
        "/api/v1/objections",
        headers=auth(admin_token),
        json={"name": "Distância", "rebuttal": "dup"},
    )
    assert response.status_code == 409

    # PATCH: unlink template with explicit null + deactivate hides it.
    response = await client.patch(
        f"/api/v1/objections/{objection['id']}",
        headers=auth(admin_token),
        json={"template_id": None, "is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["template_id"] is None
    names = set(await get_objections(client, admin_token))
    assert "Distância" not in names
    response = await client.get(
        "/api/v1/objections?include_inactive=true", headers=auth(admin_token)
    )
    assert "Distância" in {o["name"] for o in response.json()}

    response = await client.delete(
        f"/api/v1/objections/{objection['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204


async def test_deal_patch_objection_and_quick_log(
    client: AsyncClient, admin_token: str, contact_id: str
):
    objections = await get_objections(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)
    assert deal["objection_id"] is None

    # PATCH sets and clears the catalog objection.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"objection_id": objections["Preço"]["id"]},
    )
    assert response.status_code == 200
    assert response.json()["objection_id"] == objections["Preço"]["id"]
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"objection_id": None},
    )
    assert response.status_code == 200
    assert response.json()["objection_id"] is None

    # Unknown objection -> 422.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"objection_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_objection"

    # Quick log: objection_id only with talked_objection.
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "attempt_no_answer", "objection_id": objections["Preço"]["id"]},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "objection_requires_talked_objection"

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/log",
        headers=auth(admin_token),
        json={"kind": "talked_objection", "objection_id": objections["Vou pensar"]["id"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["deal"]["objection_id"] == objections["Vou pensar"]["id"]

    timeline = (
        await client.get(
            f"/api/v1/deals/{deal['id']}/activities", headers=auth(admin_token)
        )
    ).json()["items"]
    logged = next(a for a in timeline if a["type"] == "talked_objection")
    assert logged["payload"]["objection_id"] == objections["Vou pensar"]["id"]


async def test_lost_reasons_report_groups_by_catalog_objection(
    client: AsyncClient, admin_token: str, contact_id: str
):
    objections = await get_objections(client, admin_token)
    reasons = (
        await client.get("/api/v1/lost-reasons", headers=auth(admin_token))
    ).json()

    deal = await create_deal(client, admin_token, contact_id)
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"objection_id": objections["Preço"]["id"]},
    )
    assert response.status_code == 200
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/lost",
        headers=auth(admin_token),
        json={"lost_reason_id": reasons[0]["id"]},
    )
    assert response.status_code == 200

    report = (
        await client.get("/api/v1/reports/lost-reasons", headers=auth(admin_token))
    ).json()
    assert report["objection_breakdown"] == [
        {"objection_id": objections["Preço"]["id"], "name": "Preço", "count": 1}
    ]


# --- Conversation metrics (spec 12.3) -----------------------------------------


async def test_conversations_report_per_consultant(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    response = await client.get(
        "/api/v1/reports/conversations", headers=auth(consultor_token)
    )
    assert response.status_code == 403  # admin-only report

    objections = await get_objections(client, consultor_token)
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()

    # Deal 1: 2 attempts + 1 advance + objection talk, then WON.
    c1 = await make_contact(client, consultor_token, "+5563999850001", "Conv 1")
    deal1 = await create_deal(client, consultor_token, c1, title="Conv deal 1")
    for _ in range(2):
        r = await client.post(
            f"/api/v1/deals/{deal1['id']}/log",
            headers=auth(consultor_token),
            json={"kind": "attempt_no_answer"},
        )
        assert r.status_code == 200
    r = await client.post(
        f"/api/v1/deals/{deal1['id']}/log",
        headers=auth(consultor_token),
        json={"kind": "talked_advance"},
    )
    assert r.status_code == 200
    r = await client.post(
        f"/api/v1/deals/{deal1['id']}/log",
        headers=auth(consultor_token),
        json={"kind": "talked_objection", "objection_id": objections["Preço"]["id"]},
    )
    assert r.status_code == 200
    await win_deal(client, consultor_token, deal1["id"])

    # Deal 2: objection talk + a scheduled visit, stays open.
    c2 = await make_contact(client, consultor_token, "+5563999850002", "Conv 2")
    deal2 = await create_deal(client, consultor_token, c2, title="Conv deal 2")
    r = await client.post(
        f"/api/v1/deals/{deal2['id']}/log",
        headers=auth(consultor_token),
        json={"kind": "talked_objection"},
    )
    assert r.status_code == 200
    r = await client.post(
        f"/api/v1/deals/{deal2['id']}/log",
        headers=auth(consultor_token),
        json={
            "kind": "visit_scheduled",
            "next_contact_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
    )
    assert r.status_code == 200

    report = (
        await client.get("/api/v1/reports/conversations", headers=auth(admin_token))
    ).json()
    row = next(r for r in report["rows"] if r["user_id"] == me["id"])
    assert row["user_name"] == me["name"]
    assert row["attempts"] == 2
    assert row["conversations"] == 3  # 1 advance + 2 objection talks
    assert row["contact_to_conversation_rate"] == 0.6  # 3 / (2 + 3)
    assert row["visits_scheduled"] == 1
    assert row["objections_registered"] == 2
    assert row["objection_deals"] == 2
    assert row["objection_deals_won"] == 1  # deal1 became won
    assert row["objections_overcome_pct"] == 50.0
