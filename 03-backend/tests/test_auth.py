"""Auth: login, me, refresh rotation, logout, rate limit."""

from httpx import AsyncClient

from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, auth, login

COOKIE = "crm_refresh_token"


async def test_login_returns_access_token_and_refresh_cookie(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 15 * 60
    assert COOKIE in response.cookies
    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


async def test_login_wrong_password_is_401(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"


async def test_me_returns_profile(client: AsyncClient, admin_token: str):
    response = await client.get("/api/v1/auth/me", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["role"] == "ADMIN"


async def test_me_without_token_is_401(client: AsyncClient):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_refresh_rotates_token(client: AsyncClient):
    await login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    old_refresh = client.cookies[COOKIE]

    response = await client.post("/api/v1/auth/refresh")
    assert response.status_code == 200
    assert response.json()["access_token"]
    new_refresh = client.cookies[COOKIE]
    assert new_refresh != old_refresh

    # The rotated-out token is single-use: replaying it must fail.
    client.cookies.set(COOKIE, old_refresh, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401
    assert replay.json()["code"] == "invalid_refresh_token"


async def test_logout_revokes_refresh_token(client: AsyncClient):
    await login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    refresh_value = client.cookies[COOKIE]

    response = await client.post("/api/v1/auth/logout")
    assert response.status_code == 204

    client.cookies.set(COOKIE, refresh_value, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401


async def test_login_rate_limit(client: AsyncClient):
    for _ in range(5):
        response = await client.post(
            "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "nope"}
        )
        assert response.status_code == 401
    response = await client.post(
        "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "nope"}
    )
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
