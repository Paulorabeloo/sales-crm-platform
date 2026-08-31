"""Owner-test feedback, items 3, 4 and 5.

- item 3: the kanban capped cards per column (real totals, priority ordering,
  unassigned queue);
- item 4: ``PATCH /deals/{id}`` shallow-merges ``enrollment_data`` instead of
  replacing it;
- item 5: the source catalog and the normalization of the free-text source on
  deals, campaign spend and the public webhook.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import text as sa_text

from app.services.sources import canonical_source_key
from tests.conftest import auth
from tests.test_deals import create_deal, get_stages
from tests.test_followup import make_contact

# --- helpers ------------------------------------------------------------------


async def kanban(client: AsyncClient, token: str, query: str = "") -> dict:
    url = "/api/v1/deals/kanban"
    if query:
        url = f"{url}?{query}"
    response = await client.get(url, headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def first_column(board: dict) -> dict:
    return board["stages"][0]


async def make_deals(
    client: AsyncClient,
    token: str,
    count: int,
    *,
    value: str = "100.00",
    offset: int = 0,
    **extra,
) -> list[dict]:
    """``offset`` keeps the generated phone numbers unique across calls."""
    deals = []
    for index in range(offset, offset + count):
        contact = await make_contact(
            client, token, f"+55639999{index:05d}", f"Lead {index}"
        )
        deals.append(
            await create_deal(client, token, contact, value=value, **extra)
        )
    return deals


async def set_timestamps(
    db_session_factory,  # noqa: ANN001
    deal_id: str,
    *,
    created_at: datetime | None = None,
    last_activity_at: datetime | None = None,
) -> None:
    """Backdate a deal. ``last_activity_at`` is trigger-maintained, so it has
    to be written after any activity the test itself created."""
    assignments = []
    params: dict[str, object] = {"id": deal_id}
    if created_at is not None:
        assignments.append("created_at = :created_at")
        params["created_at"] = created_at
    if last_activity_at is not None:
        assignments.append("last_activity_at = :last_activity_at")
        params["last_activity_at"] = last_activity_at
    async with db_session_factory() as session:
        await session.execute(
            sa_text(f"UPDATE deals SET {', '.join(assignments)} WHERE id = :id"),
            params,
        )
        await session.commit()


# --- item 3: kanban card cap --------------------------------------------------


async def test_kanban_caps_cards_but_keeps_the_real_totals(
    client: AsyncClient, admin_token: str
):
    await make_deals(client, admin_token, 8, value="100.00")

    board = await kanban(client, admin_token, "cards_per_stage=3")
    assert board["cards_per_stage"] == 3
    column = first_column(board)
    # Totals come from the whole column, not from the returned slice.
    assert column["count"] == 8
    assert Decimal(column["sum_value"]) == Decimal("800.00")
    assert len(column["deals"]) == 3
    assert column["has_more"] is True
    assert column["remaining"] == 5

    # Empty columns are honest about it.
    assert all(
        col["has_more"] is False and col["remaining"] == 0
        for col in board["stages"][1:]
    )

    # Default cap is 25, which swallows these 8 deals whole.
    board = await kanban(client, admin_token)
    column = first_column(board)
    assert board["cards_per_stage"] == 25
    assert len(column["deals"]) == 8
    assert column["has_more"] is False
    assert column["remaining"] == 0


async def test_kanban_cards_per_stage_is_bounded(
    client: AsyncClient, admin_token: str
):
    for bad in ("cards_per_stage=0", "cards_per_stage=101", "cards_per_stage=-1"):
        response = await client.get(
            f"/api/v1/deals/kanban?{bad}", headers=auth(admin_token)
        )
        assert response.status_code == 422, bad
        assert response.json()["code"] == "validation_error"


async def test_kanban_orders_cards_by_working_priority(
    client: AsyncClient, admin_token: str, db_session_factory
):
    """Never-contacted (oldest first) > going cold (oldest activity first) >
    everything else (most recent activity first)."""
    now = datetime.now(UTC)
    deals = await make_deals(client, admin_token, 4)
    old_no_contact, new_no_contact, cooling, fresh = deals

    await set_timestamps(
        db_session_factory, old_no_contact["id"], created_at=now - timedelta(days=10)
    )
    await set_timestamps(
        db_session_factory, new_no_contact["id"], created_at=now - timedelta(days=1)
    )
    for deal in (cooling, fresh):
        response = await client.post(
            f"/api/v1/deals/{deal['id']}/first-contact", headers=auth(admin_token)
        )
        assert response.status_code == 200, response.text
    # cooling_days is 3 by default, so 30 days without activity is cold.
    await set_timestamps(
        db_session_factory, cooling["id"], last_activity_at=now - timedelta(days=30)
    )
    await set_timestamps(
        db_session_factory, fresh["id"], last_activity_at=now - timedelta(minutes=1)
    )

    board = await kanban(client, admin_token)
    order = [d["id"] for d in first_column(board)["deals"]]
    assert order == [
        old_no_contact["id"],
        new_no_contact["id"],
        cooling["id"],
        fresh["id"],
    ]

    # The cap keeps the top of that ranking, never an arbitrary slice.
    board = await kanban(client, admin_token, "cards_per_stage=2")
    column = first_column(board)
    assert [d["id"] for d in column["deals"]] == [
        old_no_contact["id"],
        new_no_contact["id"],
    ]
    assert column["count"] == 4
    assert column["has_more"] is True
    assert column["remaining"] == 2


async def test_kanban_unassigned_queue_is_capped_too(
    client: AsyncClient, admin_token: str
):
    me = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()
    await make_deals(client, admin_token, 4, owner_id=None)
    owned = await make_deals(
        client, admin_token, 1, value="50.00", offset=10, owner_id=me["id"]
    )

    board = await kanban(client, admin_token, "cards_per_stage=2")
    queue = board["unassigned"]
    assert queue["count"] == 4
    assert Decimal(queue["sum_value"]) == Decimal("400.00")
    assert len(queue["deals"]) == 2
    assert queue["has_more"] is True
    assert queue["remaining"] == 2
    assert all(card["owner_id"] is None for card in queue["deals"])

    # Default (legacy) behaviour: the queue is also part of the columns.
    board = await kanban(client, admin_token)
    assert first_column(board)["count"] == 5

    # split_unassigned pulls it out of the columns, count and sum included.
    board = await kanban(client, admin_token, "split_unassigned=true")
    column = first_column(board)
    assert column["count"] == 1
    assert Decimal(column["sum_value"]) == Decimal("50.00")
    assert [d["id"] for d in column["deals"]] == [owned[0]["id"]]
    assert board["unassigned"]["count"] == 4


# --- item 4: enrollment_data merge --------------------------------------------


async def patch_enrollment(
    client: AsyncClient, token: str, deal_id: str, payload: dict, query: str = ""
) -> dict:
    url = f"/api/v1/deals/{deal_id}"
    if query:
        url = f"{url}?{query}"
    response = await client.patch(url, headers=auth(token), json=payload)
    assert response.status_code == 200, response.text
    return response.json()["enrollment_data"]


async def test_patch_merges_enrollment_data_by_default(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)

    data = await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {"enrollment_data": {"interest_course": "ADS", "modality": "ead"}},
    )
    assert data == {"interest_course": "ADS", "modality": "ead"}

    # A partial patch adds its key and keeps the others (the bug the owner hit
    # while generating the test base: entry_method used to erase the course).
    data = await patch_enrollment(
        client, admin_token, deal["id"], {"enrollment_data": {"entry_method": "enem"}}
    )
    assert data == {
        "interest_course": "ADS",
        "modality": "ead",
        "entry_method": "enem",
    }


async def test_patch_enrollment_null_clears_only_that_key(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)
    await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {"enrollment_data": {"interest_course": "ADS", "entry_method": "enem"}},
    )

    data = await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {"enrollment_data": {"interest_course": None}},
    )
    assert data == {"entry_method": "enem"}


async def test_patch_enrollment_replace_mode_still_available(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id)
    await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {"enrollment_data": {"interest_course": "ADS", "entry_method": "enem"}},
    )

    # Query param.
    data = await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {"enrollment_data": {"modality": "presencial"}},
        query="enrollment_data_mode=replace",
    )
    assert data == {"modality": "presencial"}

    # Body field, same effect.
    data = await patch_enrollment(
        client,
        admin_token,
        deal["id"],
        {
            "enrollment_data": {"interest_course": "Direito"},
            "enrollment_data_mode": "replace",
        },
    )
    assert data == {"interest_course": "Direito"}


async def test_patch_with_the_full_form_still_works(
    client: AsyncClient, admin_token: str, contact_id: str
):
    """The frontend submits the whole enrollment form; merging must produce
    exactly the same object a replace would."""
    deal = await create_deal(client, admin_token, contact_id)
    full = {
        "interest_course": "ADS",
        "entry_method": "enem",
        "modality": "ead",
        "contract_signed": True,
    }
    assert await patch_enrollment(
        client, admin_token, deal["id"], {"enrollment_data": full}
    ) == full

    edited = {**full, "modality": "presencial"}
    assert await patch_enrollment(
        client, admin_token, deal["id"], {"enrollment_data": edited}
    ) == edited


# --- item 5: source catalog ---------------------------------------------------


async def list_sources(
    client: AsyncClient, token: str, include_inactive: bool = False
) -> list[dict]:
    url = "/api/v1/sources"
    if include_inactive:
        url = f"{url}?include_inactive=true"
    response = await client.get(url, headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def test_source_catalog_is_seeded_and_readable(
    client: AsyncClient, consultor_token: str
):
    keys = [s["key"] for s in await list_sources(client, consultor_token)]
    assert keys == [
        "meta_ads",
        "google_ads",
        "tiktok_ads",
        "indicacao",
        "site",
        "whatsapp",
        "presencial",
        "outro",
    ]
    labels = {s["key"]: s["label"] for s in await list_sources(client, consultor_token)}
    assert labels["indicacao"] == "Indicação"
    assert all("—" not in label for label in labels.values())


async def test_source_crud_is_admin_only(
    client: AsyncClient, admin_token: str, consultor_token: str, contact_id: str
):
    response = await client.post(
        "/api/v1/sources", headers=auth(consultor_token), json={"label": "Rádio"}
    )
    assert response.status_code == 403

    # The key is derived from the label and normalized.
    response = await client.post(
        "/api/v1/sources", headers=auth(admin_token), json={"label": "Rádio Local FM"}
    )
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["key"] == "radio_local_fm"
    assert source["is_active"] is True

    # Any spelling of the same key is a duplicate.
    response = await client.post(
        "/api/v1/sources",
        headers=auth(admin_token),
        json={"key": " RADIO local  fm ", "label": "Outra"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_source"

    response = await client.patch(
        f"/api/v1/sources/{source['id']}",
        headers=auth(admin_token),
        json={"label": "Rádio Local", "is_active": False, "sort_order": 42},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Rádio Local"
    assert response.json()["is_active"] is False

    # Inactive sources leave the select but stay visible for the admin.
    assert "radio_local_fm" not in [s["key"] for s in await list_sources(client, admin_token)]
    assert "radio_local_fm" in [
        s["key"] for s in await list_sources(client, admin_token, include_inactive=True)
    ]
    # include_inactive is ignored for consultants.
    assert "radio_local_fm" not in [
        s["key"]
        for s in await list_sources(client, consultor_token, include_inactive=True)
    ]

    # Referenced sources cannot be deleted (the report would lose the label).
    await create_deal(client, admin_token, contact_id, source="Rádio Local FM")
    response = await client.delete(
        f"/api/v1/sources/{source['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "source_in_use"

    unused = (
        await client.post(
            "/api/v1/sources", headers=auth(admin_token), json={"label": "Panfleto"}
        )
    ).json()
    response = await client.delete(
        f"/api/v1/sources/{unused['id']}", headers=auth(admin_token)
    )
    assert response.status_code == 204


async def test_deal_source_is_normalized_to_a_catalog_key(
    client: AsyncClient, admin_token: str
):
    spellings = {
        "  Meta Ads ": "meta_ads",
        "META": "meta_ads",
        "Facebook": "meta_ads",
        "instagram": "meta_ads",
        "Google": "google_ads",
        "Indicação": "indicacao",
    }
    for index, (raw, expected) in enumerate(spellings.items()):
        contact = await make_contact(
            client, admin_token, f"+55639998{index:05d}", f"Lead {index}"
        )
        deal = await create_deal(client, admin_token, contact, source=raw)
        assert deal["source"] == expected, raw

    # PATCH normalizes too.
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}", headers=auth(admin_token), json={"source": "FB"}
    )
    assert response.status_code == 200
    assert response.json()["source"] == "meta_ads"


async def test_unknown_deal_source_is_accepted_and_registered_inactive(
    client: AsyncClient, admin_token: str, contact_id: str
):
    deal = await create_deal(client, admin_token, contact_id, source="Rádio FM 90,9")
    assert deal["source"] == "radio_fm_90_9"

    assert "radio_fm_90_9" not in [s["key"] for s in await list_sources(client, admin_token)]
    registered = {
        s["key"]: s
        for s in await list_sources(client, admin_token, include_inactive=True)
    }
    assert registered["radio_fm_90_9"]["is_active"] is False
    assert registered["radio_fm_90_9"]["label"] == "Rádio FM 90,9"


async def test_campaign_spend_source_is_normalized_and_deduped(
    client: AsyncClient, admin_token: str
):
    month = datetime.now(UTC).date().replace(day=1).isoformat()
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": month, "source": " Meta ", "amount": "7000.00"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["source"] == "meta_ads"

    # The variant that used to split the CAC in half is now the same row.
    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": month, "source": "meta_ads", "amount": "1.00"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_spend"

    response = await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": month, "source": "   ", "amount": "1.00"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_source_key"


async def test_cac_no_longer_splits_one_channel_across_spellings(
    client: AsyncClient, admin_token: str
):
    """The bug from the feedback: spend booked as "meta" and leads tagged
    "meta_ads" used to land on two rows, halving the reported CAC.

    The window is a whole month so the monthly budget is not prorated and the
    number is exact."""
    first_day = datetime.now(UTC).date().replace(day=1)
    next_month = (first_day + timedelta(days=32)).replace(day=1)
    await client.post(
        "/api/v1/campaign-spend",
        headers=auth(admin_token),
        json={"month": first_day.isoformat(), "source": "Meta", "amount": "1000.00"},
    )
    await make_deals(client, admin_token, 2, source="meta_ads")

    response = await client.get(
        "/api/v1/reports/cac?group_by=source"
        f"&from={first_day.isoformat()}&to={next_month.isoformat()}",
        headers=auth(admin_token),
    )
    assert response.status_code == 200, response.text
    rows = [r for r in response.json()["rows"] if r["group_key"] is not None]
    assert [r["group_key"] for r in rows] == ["meta_ads"]
    assert rows[0]["leads_count"] == 2
    assert Decimal(rows[0]["spend"]) == Decimal("1000.00")


def test_canonical_source_key_is_the_migration_contract():
    """Migration 0005 rewrites the existing rows with this exact function, so
    the data already in the base and every future write land on one key."""
    assert canonical_source_key("meta") == "meta_ads"
    assert canonical_source_key(" Meta Ads ") == "meta_ads"
    assert canonical_source_key("Facebook Ads") == "meta_ads"
    assert canonical_source_key("Google") == "google_ads"
    assert canonical_source_key("Indicação") == "indicacao"
    # No obvious catalog match: normalized, never remapped.
    assert canonical_source_key("Marketing") == "marketing"
    assert canonical_source_key("LP Webhook Institucional") == (
        "lp_webhook_institucional"
    )
    # Nothing usable left.
    assert canonical_source_key("   ") is None
    assert canonical_source_key(None) is None


async def test_webhook_with_an_unknown_source_never_refuses_the_lead(
    client: AsyncClient, admin_token: str
):
    lead_source = (
        await client.post(
            "/api/v1/lead-sources",
            headers=auth(admin_token),
            json={"name": "Parceria Escola Nova"},
        )
    ).json()

    response = await client.post(
        f"/api/v1/webhooks/leads/{lead_source['token']}",
        json={"name": "Ana Lead", "phone": "(63) 98888-7777"},
    )
    assert response.status_code == 202, response.text
    deal_id = response.json()["deal_id"]

    deal = (
        await client.get(f"/api/v1/deals/{deal_id}", headers=auth(admin_token))
    ).json()
    assert deal["source"] == "parceria_escola_nova"

    registered = {
        s["key"]: s
        for s in await list_sources(client, admin_token, include_inactive=True)
    }
    assert registered["parceria_escola_nova"]["is_active"] is False


async def test_stage_gate_and_board_survive_the_new_kanban_query(
    client: AsyncClient, admin_token: str, contact_id: str
):
    """Regression guard: the capped board still reports the same stage layout
    and per-column membership after a move."""
    stages = await get_stages(client, admin_token)
    deal = await create_deal(client, admin_token, contact_id, value="200.00")
    await client.post(
        f"/api/v1/deals/{deal['id']}/first-contact", headers=auth(admin_token)
    )
    response = await client.patch(
        f"/api/v1/deals/{deal['id']}/stage",
        headers=auth(admin_token),
        json={"stage_id": stages["Tentando contato"]["id"]},
    )
    assert response.status_code == 200, response.text

    board = await kanban(client, admin_token)
    assert first_column(board)["count"] == 0
    second = board["stages"][1]
    assert second["count"] == 1
    assert Decimal(second["sum_value"]) == Decimal("200.00")
    assert [d["id"] for d in second["deals"]] == [deal["id"]]
