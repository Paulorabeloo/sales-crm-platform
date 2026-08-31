"""phase : extension login flow (?client=extension) + deals contact_id filter."""

from httpx import AsyncClient

from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, auth

COOKIE = "crm_refresh_token"


async def test_extension_login_long_token_no_refresh_cookie(client: AsyncClient):
    """Extension flow: 12h access token, NO refresh cookie, token works."""
    response = await client.post(
        "/api/v1/auth/login?client=extension",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["expires_in"] == 12 * 3600
    assert COOKIE not in response.cookies
    assert "set-cookie" not in response.headers

    me = await client.get("/api/v1/auth/me", headers=auth(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN_EMAIL


async def test_extension_login_invalid_client_is_422(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login?client=mobile",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 422


async def test_web_login_flow_unchanged(client: AsyncClient):
    """Default flow still issues the 15-min token + refresh cookie."""
    response = await client.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["expires_in"] == 15 * 60
    assert COOKIE in response.cookies


async def test_password_change_kills_the_extension_token(client: AsyncClient):
    """M8: the 12h extension token has no refresh channel to revoke, so a
    password change must invalidate it through ``password_changed_at``."""
    response = await client.post(
        "/api/v1/auth/login?client=extension",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 200

    new_password = "brand-new-admin-password-123"
    response = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(token),
        json={"current_password": ADMIN_PASSWORD, "new_password": new_password},
    )
    assert response.status_code == 204, response.text

    # The long-lived token is dead immediately, even though it has ~12h left.
    dead = await client.get("/api/v1/auth/me", headers=auth(token))
    assert dead.status_code == 401
    assert dead.json()["code"] == "token_revoked"

    # Logging in again with the new password issues a working token.
    response = await client.post(
        "/api/v1/auth/login?client=extension",
        json={"email": ADMIN_EMAIL, "password": new_password},
    )
    assert response.status_code == 200, response.text
    fresh = response.json()["access_token"]
    assert (await client.get("/api/v1/auth/me", headers=auth(fresh))).status_code == 200


async def test_admin_password_reset_kills_the_user_tokens(
    client: AsyncClient, admin_token: str, consultor_token: str
):
    """M8 through the admin path: resetting someone's password cuts their
    live sessions off, which is the revocation procedure for a leaver."""
    me = (await client.get("/api/v1/auth/me", headers=auth(consultor_token))).json()
    response = await client.post(
        f"/api/v1/users/{me['id']}/reset-password",
        headers=auth(admin_token),
        json={"new_password": "reset-by-the-admin-123"},
    )
    assert response.status_code == 204, response.text

    dead = await client.get("/api/v1/auth/me", headers=auth(consultor_token))
    assert dead.status_code == 401
    assert dead.json()["code"] == "token_revoked"
    # The admin's own token is untouched.
    assert (
        await client.get("/api/v1/auth/me", headers=auth(admin_token))
    ).status_code == 200


async def test_deals_contact_id_filter(client: AsyncClient, admin_token: str):
    """GET /deals?contact_id= returns only that contact's deals (extension
    panel: phone -> contact -> open deals)."""
    headers = auth(admin_token)

    async def make_contact(name: str, phone: str) -> str:
        r = await client.post(
            "/api/v1/contacts",
            headers=headers,
            json={"name": name, "phone_whatsapp": phone},
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    contact_a = await make_contact("Ana Extension", "+5563999990101")
    contact_b = await make_contact("Bruno Extension", "+5563999990102")

    for title, contact in (("Deal A", contact_a), ("Deal B", contact_b)):
        r = await client.post(
            "/api/v1/deals",
            headers=headers,
            json={"title": title, "contact_id": contact},
        )
        assert r.status_code == 201, r.text

    r = await client.get(f"/api/v1/deals?contact_id={contact_a}", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Deal A"
    assert body["items"][0]["contact_id"] == contact_a
