"""Win-back: recoverable lost reasons, the rescue list and
reopen-in-cycle (new linked deal in the active cycle)."""

from httpx import AsyncClient

from tests.conftest import auth
from tests.test_cycles import create_cycle, get_active_cycle
from tests.test_deals import create_deal
from tests.test_followup import make_contact


async def get_lost_reasons(client: AsyncClient, token: str) -> dict[str, dict]:
    response = await client.get("/api/v1/lost-reasons", headers=auth(token))
    assert response.status_code == 200
    return {r["label"]: r for r in response.json()}


async def lose_deal(
    client: AsyncClient, token: str, deal_id: str, reason_id: str
) -> None:
    response = await client.post(
        f"/api/v1/deals/{deal_id}/lost",
        headers=auth(token),
        json={"lost_reason_id": reason_id},
    )
    assert response.status_code == 200, response.text


async def test_seeded_recoverable_flags_and_patch(
    client: AsyncClient, admin_token: str
):
    reasons = await get_lost_reasons(client, admin_token)
    assert reasons["Sem resposta/sumiu"]["is_recoverable"] is True
    assert reasons["Preço/mensalidade"]["is_recoverable"] is True
    assert reasons["Sem ENEM/documentação"]["is_recoverable"] is True
    assert reasons["Escolheu concorrente"]["is_recoverable"] is False
    assert reasons["Desistiu de estudar"]["is_recoverable"] is False

    # Admin edits the flag.
    response = await client.patch(
        f"/api/v1/lost-reasons/{reasons['Outro']['id']}",
        headers=auth(admin_token),
        json={"is_recoverable": True},
    )
    assert response.status_code == 200
    assert response.json()["is_recoverable"] is True


async def test_recoverable_list_scopes_and_filters(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    reasons = await get_lost_reasons(client, admin_token)
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    cycle1 = await get_active_cycle(client, admin_token)

    # Consultant's recoverable loss + admin's recoverable loss + one
    # NON-recoverable loss, all in cycle 1.
    c1 = await make_contact(client, consultor_token, "+5563999860001", "R1")
    mine = await create_deal(client, consultor_token, c1, title="My recoverable")
    await lose_deal(
        client, consultor_token, mine["id"], reasons["Sem resposta/sumiu"]["id"]
    )

    c2 = await make_contact(client, admin_token, "+5563999860002", "R2")
    theirs = await create_deal(
        client, admin_token, c2, title="Admin recoverable", owner_id=admin_me["id"]
    )
    await lose_deal(
        client, admin_token, theirs["id"], reasons["Preço/mensalidade"]["id"]
    )

    c3 = await make_contact(client, admin_token, "+5563999860003", "R3")
    not_rec = await create_deal(client, admin_token, c3, title="Not recoverable")
    await lose_deal(
        client, admin_token, not_rec["id"], reasons["Escolheu concorrente"]["id"]
    )

    # While cycle 1 is still active, nothing is "from a previous cycle".
    response = await client.get("/api/v1/deals/recoverable", headers=auth(admin_token))
    assert response.status_code == 200
    assert response.json()["total"] == 0

    # Activate a new cycle: the recoverable losses of cycle 1 appear.
    await create_cycle(client, admin_token, "2026.2", activate=True)
    body = (
        await client.get("/api/v1/deals/recoverable", headers=auth(admin_token))
    ).json()
    ids = {r["deal_id"] for r in body["items"]}
    assert ids == {mine["id"], theirs["id"]}  # non-recoverable reason excluded
    row = next(r for r in body["items"] if r["deal_id"] == mine["id"])
    assert row["lost_reason_label"] == "Sem resposta/sumiu"
    assert row["cycle_name"] == cycle1["name"]
    assert row["contact_phone"].startswith("+55")

    # Consultant sees only their own losses.
    body = (
        await client.get("/api/v1/deals/recoverable", headers=auth(consultor_token))
    ).json()
    assert [r["deal_id"] for r in body["items"]] == [mine["id"]]
    assert body["items"][0]["owner_id"] == me["id"]

    # cycle_id_before narrows the source cycle.
    body = (
        await client.get(
            f"/api/v1/deals/recoverable?cycle_id_before={cycle1['id']}",
            headers=auth(admin_token),
        )
    ).json()
    assert body["total"] == 2


async def test_reopened_deal_leaves_recoverable_list(
    client: AsyncClient, admin_token: str
):
    """QA-final fix: once a lost deal is reopened in the active cycle it must
    disappear from /deals/recoverable (it carries a reopened_in_cycle
    activity), instead of staying a win-back candidate forever."""
    reasons = await get_lost_reasons(client, admin_token)
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()

    contact = await make_contact(client, admin_token, "+5563999860020", "Gone")
    deal = await create_deal(
        client, admin_token, contact, title="Leaves rescue list", owner_id=admin_me["id"]
    )
    await lose_deal(client, admin_token, deal["id"], reasons["Preço/mensalidade"]["id"])

    await create_cycle(client, admin_token, "2026.2", activate=True)

    # Before reopening: listed as recoverable.
    body = (
        await client.get("/api/v1/deals/recoverable", headers=auth(admin_token))
    ).json()
    assert deal["id"] in {r["deal_id"] for r in body["items"]}

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/reopen-in-cycle", headers=auth(admin_token)
    )
    assert response.status_code == 201, response.text

    # After reopening: gone from the list (and from the total).
    body = (
        await client.get("/api/v1/deals/recoverable", headers=auth(admin_token))
    ).json()
    assert deal["id"] not in {r["deal_id"] for r in body["items"]}
    assert body["total"] == 0


async def test_reopen_in_cycle_is_idempotent(client: AsyncClient, admin_token: str):
    """M7: a second rescue of the same lost deal (double click, retry, direct
    API call) answers 409 pointing at the deal already created, instead of
    minting a duplicate that would be counted twice in leads, funnel, goals
    and CAC."""
    reasons = await get_lost_reasons(client, admin_token)
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()

    contact = await make_contact(client, admin_token, "+5563999860030", "Twice")
    deal = await create_deal(
        client, admin_token, contact, title="Rescued once", owner_id=admin_me["id"]
    )
    await lose_deal(client, admin_token, deal["id"], reasons["Preço/mensalidade"]["id"])
    await create_cycle(client, admin_token, "2026.2", activate=True)

    first = await client.post(
        f"/api/v1/deals/{deal['id']}/reopen-in-cycle", headers=auth(admin_token)
    )
    assert first.status_code == 201, first.text
    new_deal_id = first.json()["id"]

    second = await client.post(
        f"/api/v1/deals/{deal['id']}/reopen-in-cycle", headers=auth(admin_token)
    )
    assert second.status_code == 409, second.text
    body = second.json()
    assert body["code"] == "already_reopened"
    assert body["new_deal_id"] == new_deal_id  # recoverable, so it is returned

    # Exactly one deal was created for that contact in the active cycle.
    deals = (
        await client.get(
            f"/api/v1/deals?contact_id={contact}", headers=auth(admin_token)
        )
    ).json()
    assert [d["id"] for d in deals["items"] if d["status"] == "open"] == [new_deal_id]


async def test_reopen_in_cycle_links_and_preserves(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    reasons = await get_lost_reasons(client, admin_token)
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    stages = (
        await client.get("/api/v1/pipelines", headers=auth(consultor_token))
    ).json()[0]["stages"]
    first_stage = next(s for s in stages if s["sort_order"] == 1)

    contact = await make_contact(client, consultor_token, "+5563999860010", "Rescue")
    old = await create_deal(client, consultor_token, contact, title="Old lost deal")
    # Give it qualification data that should carry over (and closing data
    # that must NOT).
    response = await client.patch(
        f"/api/v1/deals/{old['id']}",
        headers=auth(consultor_token),
        json={
            "enrollment_data": {
                "interest_course": "Direito",
                "entry_method": "enem",
                "contract_signed": True,
            }
        },
    )
    assert response.status_code == 200
    await lose_deal(
        client, consultor_token, old["id"], reasons["Sem resposta/sumiu"]["id"]
    )

    # Reopening an OPEN deal is refused.
    other_contact = await make_contact(client, admin_token, "+5563999860011", "Open")
    open_deal = await create_deal(client, admin_token, other_contact, title="Open")
    response = await client.post(
        f"/api/v1/deals/{open_deal['id']}/reopen-in-cycle", headers=auth(admin_token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "deal_not_lost"

    cycle2 = await create_cycle(client, admin_token, "2026.2", activate=True)
    response = await client.post(
        f"/api/v1/deals/{old['id']}/reopen-in-cycle", headers=auth(consultor_token)
    )
    assert response.status_code == 201, response.text
    new = response.json()
    assert new["id"] != old["id"]
    assert new["status"] == "open"
    assert new["cycle_id"] == cycle2["id"]
    assert new["stage_id"] == first_stage["id"]
    assert new["owner_id"] == me["id"]
    assert new["contact_id"] == old["contact_id"]
    assert new["enrollment_data"]["interest_course"] == "Direito"
    assert "contract_signed" not in new["enrollment_data"]

    # Old deal stays lost, with a reopened_in_cycle activity pointing forward.
    old_after = (
        await client.get(f"/api/v1/deals/{old['id']}", headers=auth(consultor_token))
    ).json()
    assert old_after["status"] == "lost"
    assert old_after["lost_reason_id"] is not None
    timeline = (
        await client.get(
            f"/api/v1/deals/{old['id']}/activities", headers=auth(consultor_token)
        )
    ).json()["items"]
    link = next(a for a in timeline if a["type"] == "reopened_in_cycle")
    assert link["payload"]["new_deal_id"] == new["id"]

    # New deal's creation activity points back to the old one.
    timeline = (
        await client.get(
            f"/api/v1/deals/{new['id']}/activities", headers=auth(consultor_token)
        )
    ).json()["items"]
    created = next(a for a in timeline if a["type"] == "deal_created")
    assert created["payload"]["via"] == "reopen_in_cycle"
    assert created["payload"]["from_deal_id"] == old["id"]

    # A consultant cannot rescue someone else's loss (admin-owned deal).
    admin_me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    c4 = await make_contact(client, admin_token, "+5563999860012", "Foreign")
    foreign = await create_deal(
        client, admin_token, c4, title="Foreign loss", owner_id=admin_me["id"]
    )
    await lose_deal(
        client, admin_token, foreign["id"], reasons["Sem resposta/sumiu"]["id"]
    )
    response = await client.post(
        f"/api/v1/deals/{foreign['id']}/reopen-in-cycle", headers=auth(consultor_token)
    )
    assert response.status_code in (403, 404)  # invisible or forbidden
