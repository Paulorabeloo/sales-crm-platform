"""Required-fields stage gate (spec 08): catalog endpoint, admin config,
422 on entering a stage with missing fields, won-stage gate, playbook field."""

from httpx import AsyncClient

from tests.conftest import auth
from tests.test_deals import create_deal, get_stages


async def test_deal_fields_catalog(client: AsyncClient, admin_token: str):
    # Unauthenticated -> 401.
    response = await client.get("/api/v1/deal-fields")
    assert response.status_code == 401

    response = await client.get("/api/v1/deal-fields", headers=auth(admin_token))
    assert response.status_code == 200
    catalog = {f["key"]: f["type"] for f in response.json()}
    assert catalog["value"] == "number"
    assert catalog["first_whatsapp_contact_at"] == "datetime"
    assert catalog["contact.phone_whatsapp"] == "string"
    assert catalog["enrollment.cpf"] == "string"
    assert catalog["enrollment.contract_signed"] == "boolean"
    assert catalog["enrollment.monthly_fee_value"] == "number"
    assert catalog["enrollment.entry_method"] == "string"


async def test_default_stages_carry_required_fields_and_playbook(
    client: AsyncClient, admin_token: str
):
    stages = await get_stages(client, admin_token)
    assert stages["Novo lead"]["required_fields"] == []
    assert stages["Tentando contato"]["required_fields"] == ["first_whatsapp_contact_at"]
    assert stages["Concluído"]["required_fields"] == [
        "enrollment.contract_signed",
        "enrollment.ra_number",
    ]
    assert stages["Conversa qualificada"]["playbook"]  # seeded, non-empty


async def test_move_blocked_until_required_field_filled(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)

    # "Tentando contato" requires the first WhatsApp contact -> 422 with list.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Tentando contato"]["id"]},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "stage_requirements_missing"
    assert body["missing_fields"] == ["first_whatsapp_contact_at"]

    # Fill it -> the move passes.
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


async def test_move_lists_all_missing_enrollment_fields(
    client: AsyncClient, admin_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id)

    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Conversa qualificada"]["id"]},
    )
    assert response.status_code == 422
    assert response.json()["missing_fields"] == [
        "enrollment.interest_course",
        "enrollment.entry_method",
    ]

    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"enrollment_data": {"interest_course": "ADS", "entry_method": "enem"}},
    )
    assert response.status_code == 200
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Conversa qualificada"]["id"]},
    )
    assert response.status_code == 200


async def test_creation_in_a_middle_stage_respects_the_gate(
    client: AsyncClient, admin_token: str, contact_id: str
):
    """Minor 1: POST /deals with an explicit stage_id must clear that stage's
    gate. Otherwise a deal could be born past the middle stages, distorting the
    funnel (which reads deal_stage_history)."""
    stages = await get_stages(client, admin_token)
    qualified = stages["Conversa qualificada"]["id"]

    response = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={"title": "Born qualified", "contact_id": contact_id, "stage_id": qualified},
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "stage_requirements_missing"
    assert body["missing_fields"] == [
        "enrollment.interest_course",
        "enrollment.entry_method",
    ]

    # With the fields filled at creation time, the same call passes.
    response = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={
            "title": "Born qualified",
            "contact_id": contact_id,
            "stage_id": qualified,
            "enrollment_data": {"interest_course": "ADS", "entry_method": "enem"},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["stage_id"] == qualified

    # The default path (no stage_id) is untouched: first stage, no gate.
    response = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={"title": "Born in stage 1", "contact_id": contact_id},
    )
    assert response.status_code == 201, response.text
    assert response.json()["stage_id"] == stages["Novo lead"]["id"]


async def test_won_gate_requires_contract_true_and_ra(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    # Nothing filled -> both fields missing.
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/won", headers=auth(admin_token), json={}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "stage_requirements_missing"
    assert response.json()["missing_fields"] == [
        "enrollment.contract_signed",
        "enrollment.ra_number",
    ]

    # contract_signed=false does NOT satisfy a required boolean.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"enrollment_data": {"contract_signed": False, "ra_number": "RA-9"}},
    )
    assert response.status_code == 200
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/won", headers=auth(admin_token), json={}
    )
    assert response.status_code == 422
    assert response.json()["missing_fields"] == ["enrollment.contract_signed"]

    # contract_signed=true -> won.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"enrollment_data": {"contract_signed": True, "ra_number": "RA-9"}},
    )
    assert response.status_code == 200
    response = await client.post(
        f"/api/v1/deals/{deal['id']}/won", headers=auth(admin_token), json={}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "won"


async def test_admin_configures_required_fields(
    client: AsyncClient, admin_token: str, consultor_token: str, contact_id: str
):
    stages = await get_stages(client, admin_token)
    stage_id = stages["Tentando contato"]["id"]

    # Invalid key -> 422 with the offending keys.
    response = await client.patch(
        f"/api/v1/stages/{stage_id}",
        headers=auth(admin_token),
        json={"required_fields": ["value", "not_a_field"]},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_required_field"
    assert response.json()["invalid_fields"] == ["not_a_field"]

    # Consultor cannot configure stages.
    response = await client.patch(
        f"/api/v1/stages/{stage_id}",
        headers=auth(consultor_token),
        json={"required_fields": ["value"]},
    )
    assert response.status_code == 403

    # Valid config sticks and gates the move.
    response = await client.patch(
        f"/api/v1/stages/{stage_id}",
        headers=auth(admin_token),
        json={"required_fields": ["value"]},
    )
    assert response.status_code == 200
    assert response.json()["required_fields"] == ["value"]

    deal = await create_deal(client, admin_token, contact_id)
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stage_id},
    )
    assert response.status_code == 422
    assert response.json()["missing_fields"] == ["value"]

    response = await client.patch(
        f"/api/v1/deals/{deal['id']}",
        headers=auth(admin_token),
        json={"value": "350.00"},
    )
    assert response.status_code == 200
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stage_id},
    )
    assert response.status_code == 200


async def test_stage_playbook_update_and_clear(client: AsyncClient, admin_token: str):
    stages = await get_stages(client, admin_token)
    stage_id = stages["Novo lead"]["id"]

    response = await client.patch(
        f"/api/v1/stages/{stage_id}",
        headers=auth(admin_token),
        json={"playbook": "Answer fast. Ask one question."},
    )
    assert response.status_code == 200
    assert response.json()["playbook"] == "Answer fast. Ask one question."

    # Explicit null clears it.
    response = await client.patch(
        f"/api/v1/stages/{stage_id}", headers=auth(admin_token), json={"playbook": None}
    )
    assert response.status_code == 200
    assert response.json()["playbook"] is None
