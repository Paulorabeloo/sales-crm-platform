"""Test fixtures — real PostgreSQL (docker compose), no DB mocking.

A dedicated ``sales_crm_test`` database is (re)created once per session and
migrated with Alembic. Every test starts from truncated tables + fresh seeds.
"""

import asyncio
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Environment must be set BEFORE any app import (get_settings is cached).
TEST_DB_NAME = "sales_crm_test"
_admin_url = os.environ.get(
    "TEST_DATABASE_ADMIN_URL", "postgresql+asyncpg://crm:crm@localhost:5432/sales_crm"
)
_test_url = _admin_url.rsplit("/", 1)[0] + f"/{TEST_DB_NAME}"
os.environ["DATABASE_URL"] = _test_url
os.environ["ENVIRONMENT"] = "test"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789abcdef"
os.environ["ADMIN_EMAIL"] = "admin@example.com"
os.environ["ADMIN_PASSWORD"] = "test-admin-password"
os.environ["ADMIN_NAME"] = "Test Admin"

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config as AlembicConfig  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine.url import make_url  # noqa: E402

from app.core.rate_limit import (  # noqa: E402
    login_limiter,
    webhook_ip_limiter,
    webhook_token_limiter,
)
from app.db.seeds import run_seeds  # noqa: E402
from app.db.session import get_engine, get_session_factory  # noqa: E402
from app.main import app  # noqa: E402

ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

_TRUNCATE_SQL = """
TRUNCATE webhook_deliveries, lead_sources, tasks, activities, deal_stage_history,
         deals, contacts, lost_reasons, stages, pipelines, refresh_tokens,
         users, units, message_templates, app_settings, goals, campaign_spend,
         objections, cycles CASCADE
"""


async def _recreate_test_database() -> None:
    url = make_url(_admin_url)
    conn = await asyncpg.connect(
        user=url.username,
        password=url.password,
        host=url.host or "localhost",
        port=url.port or 5432,
        database=url.database,
    )
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
        await conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    """Create the test database and migrate it to head (once per session)."""
    asyncio.run(_recreate_test_database())
    cfg = AlembicConfig(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", _test_url)
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def clean_db(database) -> None:  # noqa: ANN001
    """Truncate everything, re-seed, reset rate limiters; dispose the engine
    afterwards so pooled connections never cross event loops."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text(_TRUNCATE_SQL))
    await run_seeds()
    login_limiter.reset()
    webhook_ip_limiter.reset()
    webhook_token_limiter.reset()
    yield
    await engine.dispose()


@pytest.fixture
async def client() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def db_session_factory():
    """Direct DB access for assertions that have no API endpoint."""
    return get_session_factory()


async def login(client: AsyncClient, email: str, password: str) -> str:
    """Login helper returning the access token (raises on failure)."""
    response = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def admin_token(client: AsyncClient) -> str:
    return await login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture
async def consultor_token(client: AsyncClient, admin_token: str) -> str:
    """Create a consultant via the admin API and log them in."""
    response = await client.post(
        "/api/v1/users",
        headers=auth(admin_token),
        json={
            "email": "consultor@example.com",
            "name": "Con Sultor",
            "password": "consultor-pass-123",
            "role": "CONSULTOR",
        },
    )
    assert response.status_code == 201, response.text
    return await login(client, "consultor@example.com", "consultor-pass-123")


@pytest.fixture
async def contact_id(client: AsyncClient, admin_token: str) -> str:
    response = await client.post(
        "/api/v1/contacts",
        headers=auth(admin_token),
        json={"name": "Maria Lead", "phone_whatsapp": "+5563999990001"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]
