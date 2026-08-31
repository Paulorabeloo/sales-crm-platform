"""Deals: creation, stage moves (+history/timeline), won/lost rules,
first-contact write-once, kanban aggregates."""

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models import DealStageHistory
from tests.conftest import auth


async def get_stages(client: AsyncClient, token: str) -> dict[str, dict]:
    response = await client.get("/api/v1/pipelines", headers=auth(token))
    assert response.status_code == 200
    pipeline = response.json()[0]
    return {s["name"]: s for s in pipeline["stages"]}


async def create_deal(client: AsyncClient, token: str, contact_id: str, **extra) -> dict:
    response = await client.post(
        "/api/v1/deals",
        headers=auth(token),
        json={"title": "Maria — ADS", "contact_id": contact_id, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_deal_lands_in_first_stage(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id, value="450.00")
    assert deal["status"] == "open"
    assert deal["stage_id"] == stages["Novo lead"]["id"]

    # Timeline carries the automatic deal_created event.
    timeline = await client.get(
        f"/api/v1/deals/{deal['id']}/activities", headers=auth(admin_token)
    )
    types = [a["type"] for a in timeline.json()["items"]]
    assert "deal_created" in types


async def test_move_stage_records_history_and_event(
    client: AsyncClient, admin_token: str, contact_id: str, db_session_factory
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)

    # "Tentando contato" requires first_whatsapp_contact_at (default gate).
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/first-contact", headers=auth(admin_token)
    )
    assert response.status_code == 200

    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Tentando contato"]["id"]},
    )
    assert response.status_code == 200
    assert response.json()["stage_id"] == stages["Tentando contato"]["id"]

    # DB trigger wrote the stage history (one closed row + one open row).
    async with db_session_factory() as session:
        rows = (
            await session.scalars(
                select(DealStageHistory)
                .where(DealStageHistory.deal_id == deal["id"])
                .order_by(DealStageHistory.entered_at)
            )
        ).all()
    assert len(rows) == 2
    assert rows[0].left_at is not None
    assert rows[1].left_at is None
    assert str(rows[1].stage_id) == stages["Tentando contato"]["id"]
    assert rows[1].changed_by is not None  # attributed via app.user_id

    timeline = await client.get(
        f"/api/v1/deals/{deal['id']}/activities", headers=auth(admin_token)
    )
    assert "stage_changed" in [a["type"] for a in timeline.json()["items"]]


async def fill_won_requirements(client: AsyncClient, token: str, deal_id: str) -> None:
    """Fill the won-stage's default required fields."""
    response = await client.patch(
        f"/api/v1/deals/{deal_id}",
        headers=auth(token),
        json={"enrollment_data": {"contract_signed": True, "ra_number": "RA-1001"}},
    )
    assert response.status_code == 200, response.text


async def test_mark_won_sets_won_at_and_won_stage(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)
    await fill_won_requirements(client, admin_token, deal["id"])

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/won",
        headers=auth(admin_token),
        json={"value": "499.90"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "won"
    assert body["won_at"] is not None
    assert body["stage_id"] == stages["Concluído"]["id"]

    # Won deals are locked: further moves are rejected.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Tentando contato"]["id"]},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "deal_locked"


async def test_move_into_won_stage_marks_won(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)
    await fill_won_requirements(client, admin_token, deal["id"])
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Concluído"]["id"]},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "won"
    assert response.json()["won_at"] is not None


async def test_mark_lost_requires_valid_reason(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    # Missing lost_reason_id -> 422 (schema validation).
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/lost", headers=auth(admin_token), json={}
    )
    assert response.status_code == 422

    # Bogus reason id -> 422 (service validation).
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/lost",
        headers=auth(admin_token),
        json={"lost_reason_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_lost_reason"

    # Valid reason -> lost with lost_at set.
    reasons = await client.get("/api/v1/lost-reasons", headers=auth(admin_token))
    reason_id = reasons.json()[0]["id"]
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/lost",
        headers=auth(admin_token),
        json={"lost_reason_id": reason_id, "lost_notes": "went silent"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "lost"
    assert body["lost_at"] is not None
    assert body["lost_reason_id"] == reason_id


async def test_first_contact_is_write_once(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/first-contact", headers=auth(admin_token)
    )
    assert response.status_code == 200
    first = response.json()["first_whatsapp_contact_at"]
    assert first is not None

    response = await client.post(
        f"/api/v1/deals/{deal['id']}/first-contact", headers=auth(admin_token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "first_contact_already_set"

    # Admin correction path works (trigger override + audit event).
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/first-contact",
        headers=auth(admin_token),
        json={"first_whatsapp_contact_at": "2026-08-01T12:00:00Z"},
    )
    assert response.status_code == 200
    assert response.json()["first_whatsapp_contact_at"] != first


async def test_kanban_aggregates(client: AsyncClient, admin_token: str, contact_id: str):
    await create_deal(client, admin_token, contact_id, value="100.00")
    response = await client.get("/api/v1/deals/kanban", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["cooling_days"] == 3
    assert [s["name"] for s in body["stages"]] == [
        "Novo lead",
        "Tentando contato",
        "Conversa qualificada",
        "Proposta apresentada",
        "Fechamento em andamento",
        "Concluído",
    ]
    first_col = body["stages"][0]
    assert first_col["count"] == 1
    assert first_col["deals"][0]["contact_name"] == "Maria Lead"
