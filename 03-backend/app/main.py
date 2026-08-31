"""Sales CRM API — application entrypoint.

Run locally::

    uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import RequestLogMiddleware, configure_logging

configure_logging()

app = FastAPI(
    title="Sales CRM API",
    version="0.1.0",
    description=(
        "Sales pipeline CRM for multi-unit sales operations. "
        "Auth: Bearer access token (15 min) + rotating refresh cookie."
    ),
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.all_cors_origins,  # explicit allowlist (never "*")
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
)
app.add_middleware(RequestLogMiddleware)

register_exception_handlers(app)
app.include_router(api_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Liveness probe (unauthenticated by design)."""
    return {"status": "ok"}
