"""Structured JSON logging with a per-request request-id (ADR-009 minimal)."""

import json
import logging
import re
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

# The lead-source webhook authenticates by a secret token in the URL path —
# never write it to the request log (Minor 2).
_WEBHOOK_TOKEN_RE = re.compile(r"(/webhooks/leads/)[^/?#]+")


def mask_sensitive_path(path: str) -> str:
    """Mask URL path segments that carry secrets (webhook tokens)."""
    return _WEBHOOK_TOKEN_RE.sub(r"\1***", path)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            entry["request_id"] = rid
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        for key in ("method", "path", "status_code", "duration_ms", "client_ip"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    logging.getLogger("uvicorn.access").disabled = True  # replaced by RequestLogMiddleware


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Assign a request-id and log one structured line per request."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        safe_path = mask_sensitive_path(request.url.path)
        logger = logging.getLogger("app.request")
        logger.info(
            "%s %s -> %s",
            request.method,
            safe_path,
            response.status_code,
            extra={
                "method": request.method,
                "path": safe_path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "client_ip": request.client.host if request.client else None,
            },
        )
        response.headers["x-request-id"] = rid
        return response
