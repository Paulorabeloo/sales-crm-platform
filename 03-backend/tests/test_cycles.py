"""Sales cycles (spec 10.1): active-cycle default on creation (manual +
webhook), CRUD/activation RBAC, rollover of open deals, cycle filters."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import auth
from tests.test_deals import create_deal, fill_won_requirements

TODAY = datetime.now(UTC).date()


async def get_active_cycle(client: AsyncClient, token: str) -> dict:
    response = await client.get("/api/v1/cycles/active", headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def create_cycle(
    client: AsyncClient, token: str, name: str, *, activate: bool = False, **extra
) -> dict:
    payload = {"name": name, "starts_on": TODAY.isoformat(), **extra}
    response = await client.post("/api/v1/cycles", headers=auth(token), json=payload)
    assert response.status_code == 201, response.text
    cycle = response.json()
    if activate:
        response = await client.post(
            f"/api/v1/cycles/{cycle['id']}/activate", headers=auth(token)
        )
        assert response.status_code == 200, response.text
        cycle = response.json()
    return cycle


async def test_seeded_active_cycle_and_deal_default(
    client: AsyncClient, admin_token: str, consultor_token: str, contact_id: str
):
    # Seeds guarantee one active cycle, readable by any authenticated user.
    active = await get_active_cycle(client, consultor_token)
    assert active["name"] == "Ciclo 1"
    assert active["is_active"] is True

    # Deals default to the active cycle...
    deal = await create_deal(client, admin_token, contact_id)
    assert deal["cycle_id"] == active["id"]

    # ...and an explicit cycle_id wins.
    other = await create_cycle(client, admin_token, "2027.1")
    deal2 = await create_deal(
        client, admin_token, contact_id, title="Explicit cycle", cycle_id=other["id"]
    )
    assert deal2["cycle_id"] == other["id"]

    # Unknown cycle -> 422.
    response = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={
            "title": "Bad cycle",
            "contact_id": contact_id,
            "cycle_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cycle"


async def test_webhook_lead_lands_in_active_cycle(
    client: AsyncClient, admin_token: str
):
    active = await get_active_cycle(client, admin_token)
    response = await client.post(
        "/api/v1/lead-sources", headers=auth(admin_token), json={"name": "LP Cycle"}
    )
    assert response.status_code == 201
    token = response.json()["token"]

    response = await client.post(
        f"/api/v1/webhooks/leads/{token}",
        json={"name": "Lead Ciclo", "phone": "+5563999880001"},
    )
    assert response.status_code == 202, response.text
    deal_id = response.json()["deal_id"]
    deal = (
        await client.get(f"/api/v1/deals/{deal_id}", headers=auth(admin_token))
    ).json()
    assert deal["cycle_id"] == active["id"]


async def test_cycle_crud_and_activation_rules(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    # CRUD is admin-only.
    response = await client.post(
        "/api/v1/cycles",
        headers=auth(consultor_token),
        json={"name": "X", "starts_on": TODAY.isoformat()},
    )
    assert response.status_code == 403

    cycle = await create_cycle(
        client,
        admin_token,
        "2026.2",
        deadline_on=(TODAY + timedelta(days=60)).isoformat(),
    )
    assert cycle["is_active"] is False

    # Duplicate name -> 409.
    response = await client.post(
        "/api/v1/cycles",
        headers=auth(admin_token),
        json={"name": "2026.2", "starts_on": TODAY.isoformat()},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_cycle"

    # Activation swaps the single active cycle.
    previous_active = await get_active_cycle(client, admin_token)
    response = await client.post(
        f"/api/v1/cycles/{cycle['id']}/activate", headers=auth(admin_token)
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is True
    cycles = (await client.get("/api/v1/cycles", headers=auth(admin_token))).json()
    actives = [c for c in cycles if c["is_active"]]
    assert [c["id"] for c in actives] == [cycle["id"]]
    assert previous_active["id"] != cycle["id"]

    # PATCH: explicit null clears the deadline.
    response = await client.patch(
        f"/api/v1/cycles/{cycle['id']}",
        headers=auth(admin_token),
        json={"deadline_on": None},
    )
    assert response.status_code == 200
    assert response.json()["deadline_on"] is None

    # Active cycle cannot be deleted; an unused one can.
    response = await client.delete(
        f"/api/v1/cycles/{cycle['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "cannot_delete_active_cycle"
    spare = await create_cycle(client, admin_token, "Spare")
    response = await client.delete(
        f"/api/v1/cycles/{spare['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204


async def test_rollover_moves_open_deals_only(
    client: AsyncClient, admin_token: str, contact_id: str
):
    cycle1 = await get_active_cycle(client, admin_token)

    open_deal = await create_deal(client, admin_token, contact_id, title="Still open")
    won_deal = await create_deal(client, admin_token, contact_id, title="Won deal")
    await fill_won_requirements(client, admin_token, won_deal["id"])
    response = await client.post(
        f"/api/v1/deals/{won_deal['id']}/won", headers=auth(admin_token), json={}
    )
    assert response.status_code == 200

    # Rolling the active cycle onto itself is refused.
    response = await client.post(
        f"/api/v1/cycles/{cycle1['id']}/rollover", headers=auth(admin_token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "cannot_rollover_active_cycle"

    cycle2 = await create_cycle(client, admin_token, "2026.2", activate=True)
    response = await client.post(
        f"/api/v1/cycles/{cycle1['id']}/rollover", headers=auth(admin_token)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["moved_count"] == 1
    assert body["from_cycle_id"] == cycle1["id"]
    assert body["to_cycle_id"] == cycle2["id"]

    moved = (
        await client.get(f"/api/v1/deals/{open_deal['id']}", headers=auth(admin_token))
    ).json()
    assert moved["cycle_id"] == cycle2["id"]
    kept = (
        await client.get(f"/api/v1/deals/{won_deal['id']}", headers=auth(admin_token))
    ).json()
    assert kept["cycle_id"] == cycle1["id"]  # closed deals stay in their cycle

    # Each moved deal gets an automatic cycle_changed activity.
    timeline = await client.get(
        f"/api/v1/deals/{open_deal['id']}/activities", headers=auth(admin_token)
    )
    entries = [a for a in timeline.json()["items"] if a["type"] == "cycle_changed"]
    assert len(entries) == 1
    assert entries[0]["payload"]["via"] == "rollover"
    assert entries[0]["payload"]["to_cycle_id"] == cycle2["id"]


async def test_cycle_filter_on_deals_and_kanban(
    client: AsyncClient, admin_token: str, contact_id: str
):
    cycle1 = await get_active_cycle(client, admin_token)
    deal1 = await create_deal(client, admin_token, contact_id, title="Cycle 1 deal")
    cycle2 = await create_cycle(client, admin_token, "2026.2", activate=True)
    deal2 = await create_deal(client, admin_token, contact_id, title="Cycle 2 deal")

    response = await client.get(
        f"/api/v1/deals?cycle_id={cycle1['id']}", headers=auth(admin_token)
    )
    assert [d["id"] for d in response.json()["items"]] == [deal1["id"]]
    response = await client.get(
        f"/api/v1/deals?cycle_id={cycle2['id']}", headers=auth(admin_token)
    )
    assert [d["id"] for d in response.json()["items"]] == [deal2["id"]]

    response = await client.get(
        f"/api/v1/deals/kanban?cycle_id={cycle2['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 200
    cards = [d["id"] for s in response.json()["stages"] for d in s["deals"]]
    assert cards == [deal2["id"]]
