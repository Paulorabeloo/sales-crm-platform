"""RBAC: consultants cannot reach admin resources; deal scope is per-owner."""

from httpx import AsyncClient

from tests.conftest import auth


async def _make_contact_and_deal(
    client: AsyncClient, admin_token: str, phone: str, title: str, owner_id: str | None
) -> tuple[str, str]:
    """Create (contact, deal) via the admin API; returns their ids."""
    c = await client.post(
        "/api/v1/contacts",
        headers=auth(admin_token),
        json={"name": title, "phone_whatsapp": phone},
    )
    assert c.status_code == 201, c.text
    d = await client.post(
        "/api/v1/deals",
        headers=auth(admin_token),
        json={"title": title, "contact_id": c.json()["id"], "owner_id": owner_id},
    )
    assert d.status_code == 201, d.text
    return c.json()["id"], d.json()["id"]


async def test_consultor_cannot_list_users(client: AsyncClient, consultor_token: str):
    response = await client.get("/api/v1/users", headers=auth(consultor_token))
    assert response.status_code == 403
    assert response.json()["code"] == "admin_only"


async def test_consultor_cannot_access_reports(client: AsyncClient, consultor_token: str):
    for path in (
        "/api/v1/reports/funnel",
        "/api/v1/reports/lost-reasons",
        "/api/v1/reports/response-time",
        "/api/v1/reports/sales",
        "/api/v1/reports/cooling",
    ):
        response = await client.get(path, headers=auth(consultor_token))
        assert response.status_code == 403, path


async def test_consultor_cannot_write_catalogs(client: AsyncClient, consultor_token: str):
    response = await client.post(
        "/api/v1/units",
        headers=auth(consultor_token),
        json={"name": "New Unit"},
    )
    assert response.status_code == 403

    response = await client.get("/api/v1/lead-sources", headers=auth(consultor_token))
    assert response.status_code == 403

    # Settings: read is open to any authenticated user (kanban needs
    # cooling_days), but writes stay admin-only.
    response = await client.get("/api/v1/settings", headers=auth(consultor_token))
    assert response.status_code == 200

    response = await client.patch(
        "/api/v1/settings", headers=auth(consultor_token), json={"cooling_days": 5}
    )
    assert response.status_code == 403


async def test_consultor_can_read_catalogs(client: AsyncClient, consultor_token: str):
    for path in ("/api/v1/units", "/api/v1/pipelines", "/api/v1/lost-reasons"):
        response = await client.get(path, headers=auth(consultor_token))
        assert response.status_code == 200, path


async def test_deal_scope_own_plus_unassigned(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    """Consultant sees own deals + the unassigned queue — never other owners'."""
    admin_id = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()["id"]

    async def make_contact_and_deal(phone: str, title: str, owner_id: str | None):
        c = await client.post(
            "/api/v1/contacts",
            headers=auth(admin_token),
            json={"name": title, "phone_whatsapp": phone},
        )
        assert c.status_code == 201
        d = await client.post(
            "/api/v1/deals",
            headers=auth(admin_token),
            json={"title": title, "contact_id": c.json()["id"], "owner_id": owner_id},
        )
        assert d.status_code == 201, d.text
        return d.json()["id"]

    admin_deal = await make_contact_and_deal("+5563999990101", "Admin owned", admin_id)
    queue_deal = await make_contact_and_deal("+5563999990102", "Unassigned", None)

    response = await client.get("/api/v1/deals", headers=auth(consultor_token))
    assert response.status_code == 200
    titles = {item["title"] for item in response.json()["items"]}
    assert "Unassigned" in titles
    assert "Admin owned" not in titles

    # Direct access to another owner's deal is a 404 (scope in the query).
    response = await client.get(f"/api/v1/deals/{admin_deal}", headers=auth(consultor_token))
    assert response.status_code == 404

    # The queue deal is visible and claimable.
    response = await client.post(
        f"/api/v1/deals/{queue_deal}/claim", headers=auth(consultor_token)
    )
    assert response.status_code == 200
    assert response.json()["owner_id"] is not None


# --- M1: contact write scope --------------------------------------------------


async def test_consultor_cannot_edit_contact_of_foreign_deal(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    """PATCH on a contact linked to another owner's deal -> 403 (M1)."""
    admin_id = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()["id"]
    contact, _ = await _make_contact_and_deal(
        client, admin_token, "+5563999990201", "Foreign contact", admin_id
    )

    response = await client.patch(
        f"/api/v1/contacts/{contact}",
        headers=auth(consultor_token),
        json={"name": "Hijacked"},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "contact_out_of_scope"

    # Admin still can.
    response = await client.patch(
        f"/api/v1/contacts/{contact}",
        headers=auth(admin_token),
        json={"name": "Renamed by admin"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed by admin"


async def test_consultor_can_edit_contact_in_own_scope(
    client: AsyncClient, admin_token: str, consultor_token: str, contact_id: str
):
    """Contacts with no deals, queue deals, or own deals stay editable (M1)."""
    # No deals at all -> editable.
    response = await client.patch(
        f"/api/v1/contacts/{contact_id}",
        headers=auth(consultor_token),
        json={"name": "Edited no-deal contact"},
    )
    assert response.status_code == 200

    # Unassigned queue deal -> editable; after claiming (own deal) -> still editable.
    contact, deal = await _make_contact_and_deal(
        client, admin_token, "+5563999990202", "Queue contact", None
    )
    response = await client.patch(
        f"/api/v1/contacts/{contact}",
        headers=auth(consultor_token),
        json={"name": "Edited queue contact"},
    )
    assert response.status_code == 200

    claim = await client.post(f"/api/v1/deals/{deal}/claim", headers=auth(consultor_token))
    assert claim.status_code == 200
    response = await client.patch(
        f"/api/v1/contacts/{contact}",
        headers=auth(consultor_token),
        json={"name": "Edited own contact"},
    )
    assert response.status_code == 200


async def test_contact_delete_is_admin_only(
    client: AsyncClient, admin_token: str, consultor_token: str, contact_id: str
):
    """DELETE /contacts/{id} is admin-only (M1 / LGPD erasure)."""
    response = await client.delete(
        f"/api/v1/contacts/{contact_id}", headers=auth(consultor_token)
    )
    assert response.status_code == 403
    assert response.json()["code"] == "admin_only"

    response = await client.delete(
        f"/api/v1/contacts/{contact_id}", headers=auth(admin_token)
    )
    assert response.status_code == 204


# --- M2: task editability rides on deal EDIT scope ----------------------------


async def test_queue_deal_tasks_are_read_only_for_consultor(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    """Queue deals (no owner) are read-only + claim: their tasks cannot be
    completed/edited/deleted until the consultant claims the deal (M2)."""
    _, deal = await _make_contact_and_deal(
        client, admin_token, "+5563999990203", "Queue deal with task", None
    )
    task = await client.post(
        f"/api/v1/deals/{deal}/tasks",
        headers=auth(admin_token),
        json={"title": "Call the lead", "due_date": "2030-01-01"},
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]

    # Visible (read is fine)...
    listing = await client.get(
        f"/api/v1/deals/{deal}/tasks", headers=auth(consultor_token)
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    # ...but not editable nor deletable.
    response = await client.patch(
        f"/api/v1/tasks/{task_id}", headers=auth(consultor_token), json={"is_done": True}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_deal_owner"

    response = await client.delete(
        f"/api/v1/tasks/{task_id}", headers=auth(consultor_token)
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_deal_owner"

    # After claiming the deal, the consultant owns it and can complete the task.
    claim = await client.post(f"/api/v1/deals/{deal}/claim", headers=auth(consultor_token))
    assert claim.status_code == 200
    response = await client.patch(
        f"/api/v1/tasks/{task_id}", headers=auth(consultor_token), json={"is_done": True}
    )
    assert response.status_code == 200
    assert response.json()["is_done"] is True


async def test_foreign_deal_task_is_invisible_and_admin_can_edit(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    """Another owner's task: 404 for the consultant (scope), editable by admin."""
    admin_id = (await client.get("/api/v1/auth/me", headers=auth(admin_token))).json()["id"]
    _, deal = await _make_contact_and_deal(
        client, admin_token, "+5563999990204", "Admin deal with task", admin_id
    )
    task = await client.post(
        f"/api/v1/deals/{deal}/tasks",
        headers=auth(admin_token),
        json={"title": "Admin follow-up", "due_date": "2030-01-01"},
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    response = await client.patch(
        f"/api/v1/tasks/{task_id}", headers=auth(consultor_token), json={"is_done": True}
    )
    assert response.status_code == 404  # not even visible

    response = await client.patch(
        f"/api/v1/tasks/{task_id}", headers=auth(admin_token), json={"is_done": True}
    )
    assert response.status_code == 200
