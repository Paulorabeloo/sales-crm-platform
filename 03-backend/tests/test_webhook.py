"""Public lead webhook: happy path, invalid token, invalid payload logging,
contact dedupe, and the cycle fallback that keeps capture alive (M6)."""

from httpx import AsyncClient
from sqlalchemy import select, update

from app.db.models import Cycle, WebhookDelivery
from tests.conftest import auth


async def create_source(client: AsyncClient, admin_token: str) -> dict:
    response = await client.post(
        "/api/v1/lead-sources",
        headers=auth(admin_token),
        json={"name": "LP Test (Apps Script)"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["token"]) >= 32
    return body


async def test_webhook_happy_path(
    client: AsyncClient, admin_token: str, db_session_factory
):
    source = await create_source(client, admin_token)
    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={
            "name": "João Lead",
            "phone": "(63) 99999-1234",
            "email": "joao@example.com",
            "course_of_interest": "Análise e Desenvolvimento de Sistemas",
            "campaign": "meta-agosto",
        },
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["result"] == "accepted"

    # The deal is in the unassigned queue, first stage, with source/campaign.
    deal = await client.get(f"/api/v1/deals/{body['deal_id']}", headers=auth(admin_token))
    assert deal.status_code == 200
    deal_body = deal.json()
    assert deal_body["owner_id"] is None
    assert deal_body["status"] == "open"
    assert deal_body["source"] == "LP Test (Apps Script)"
    assert deal_body["campaign"] == "meta-agosto"
    assert deal_body["enrollment_data"]["interest_course"] == (
        "Análise e Desenvolvimento de Sistemas"
    )
    # Phone was normalized to E.164.
    assert deal_body["contact"]["phone_whatsapp"] == "+5563999991234"

    # Delivery was logged as accepted.
    async with db_session_factory() as session:
        deliveries = (await session.scalars(select(WebhookDelivery))).all()
    assert len(deliveries) == 1
    assert deliveries[0].result.value == "accepted"
    assert str(deliveries[0].deal_id) == body["deal_id"]


async def test_webhook_invalid_token_is_404(client: AsyncClient):
    response = await client.post(
        "/api/v1/webhooks/leads/definitely-not-a-valid-token-000000",
        json={"name": "X", "phone": "+5563999990000"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "invalid_token"


async def test_webhook_invalid_payload_is_422_and_logged(
    client: AsyncClient, admin_token: str, db_session_factory
):
    source = await create_source(client, admin_token)
    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "No Phone"},  # phone is mandatory
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_lead_payload"

    # The bad delivery is logged with the raw payload (debuggability rule).
    async with db_session_factory() as session:
        deliveries = (await session.scalars(select(WebhookDelivery))).all()
    assert len(deliveries) == 1
    assert deliveries[0].result.value == "rejected"
    assert deliveries[0].raw_payload == {"name": "No Phone"}
    assert deliveries[0].error_detail


async def test_webhook_dedupes_contact_by_phone(
    client: AsyncClient, admin_token: str
):
    source = await create_source(client, admin_token)
    payload = {"name": "Ana Lead", "phone": "+5563999995555"}

    first = await client.post(f"/api/v1/webhooks/leads/{source['token']}", json=payload)
    assert first.status_code == 202
    assert first.json()["result"] == "accepted"

    second = await client.post(f"/api/v1/webhooks/leads/{source['token']}", json=payload)
    assert second.status_code == 202
    body = second.json()
    assert body["result"] == "duplicate_contact"
    # Same person, new deal (re-lead behavior).
    assert body["contact_id"] == first.json()["contact_id"]
    assert body["deal_id"] != first.json()["deal_id"]


async def test_webhook_accepts_lead_without_an_active_cycle(
    client: AsyncClient, admin_token: str, db_session_factory
):
    """M6: a missing active cycle is our configuration gap, never a reason to
    drop a captured lead. The lead lands in the most recent cycle and the
    delivery is logged as accepted (only token and payload can reject)."""
    source = await create_source(client, admin_token)

    # Deactivate every cycle (what an admin forgetting to activate looks like).
    async with db_session_factory() as session:
        await session.execute(update(Cycle).values(is_active=False))
        await session.commit()

    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "Lead sem ciclo", "phone": "+5563999997777"},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["result"] == "accepted"

    deal = (
        await client.get(f"/api/v1/deals/{body['deal_id']}", headers=auth(admin_token))
    ).json()
    assert deal["status"] == "open"
    assert deal["cycle_id"] is not None

    # Delivery logged as accepted, and the timeline flags the fallback so the
    # gap is visible instead of silent.
    async with db_session_factory() as session:
        deliveries = (await session.scalars(select(WebhookDelivery))).all()
    assert [d.result.value for d in deliveries] == ["accepted"]
    timeline = (
        await client.get(
            f"/api/v1/deals/{body['deal_id']}/activities", headers=auth(admin_token)
        )
    ).json()["items"]
    created = next(a for a in timeline if a["type"] == "deal_created")
    assert created["payload"]["cycle_fallback"] is True


async def test_webhook_creates_a_cycle_when_the_base_has_none(
    client: AsyncClient, admin_token: str, db_session_factory
):
    """M6, extreme case: not a single cycle in the base. Capture still works
    (a "Sem ciclo" cycle is created, inactive so it never overrides an admin
    decision) because ``deals.cycle_id`` must stay NOT NULL for the reports."""
    source = await create_source(client, admin_token)
    async with db_session_factory() as session:
        # No deal exists yet, so nothing references the seeded cycle.
        await session.execute(Cycle.__table__.delete())
        await session.commit()

    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "Lead base vazia", "phone": "+5563999997778"},
    )
    assert response.status_code == 202, response.text

    async with db_session_factory() as session:
        cycles = (await session.scalars(select(Cycle))).all()
    assert [(c.name, c.is_active) for c in cycles] == [("Sem ciclo", False)]

    deal = (
        await client.get(
            f"/api/v1/deals/{response.json()['deal_id']}", headers=auth(admin_token)
        )
    ).json()
    assert deal["cycle_id"] == str(cycles[0].id)


async def test_revoked_source_stops_accepting(client: AsyncClient, admin_token: str):
    source = await create_source(client, admin_token)
    revoke = await client.post(
        f"/api/v1/lead-sources/{source['id']}/revoke", headers=auth(admin_token)
    )
    assert revoke.status_code == 200

    response = await client.post(
        f"/api/v1/webhooks/leads/{source['token']}",
        json={"name": "X", "phone": "+5563999990000"},
    )
    assert response.status_code == 404
