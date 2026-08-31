"""Typed application errors and FastAPI exception handlers.

Every error response has a consistent JSON shape::

    {"detail": "<human readable, English>", "code": "<stable_machine_code>", ...extras}

The frontend translates ``code`` to pt-BR messages (ADR-007).
"""

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")


class AppError(Exception):
    """Base application error carrying an HTTP status and a stable code."""

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        extras: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.extras = extras or {}
        super().__init__(detail)


class NotFoundError(AppError):
    def __init__(self, resource: str = "resource", code: str = "not_found") -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, code, f"{resource} not found")


class ForbiddenError(AppError):
    def __init__(self, detail: str = "Not enough permissions", code: str = "forbidden") -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, code, detail)


class UnauthorizedError(AppError):
    def __init__(self, detail: str = "Not authenticated", code: str = "unauthorized") -> None:
        super().__init__(status.HTTP_401_UNAUTHORIZED, code, detail)


class ConflictError(AppError):
    def __init__(self, detail: str, code: str, extras: dict[str, Any] | None = None) -> None:
        super().__init__(status.HTTP_409_CONFLICT, code, detail, extras)


class ValidationFailedError(AppError):
    def __init__(self, detail: str, code: str, extras: dict[str, Any] | None = None) -> None:
        super().__init__(422, code, detail, extras)


class RateLimitedError(AppError):
    def __init__(self, detail: str = "Too many requests, slow down") -> None:
        super().__init__(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited", detail)


def register_exception_handlers(app: FastAPI) -> None:
    """Attach handlers so every error body follows {detail, code}."""

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        body: dict[str, Any] = {"detail": exc.detail, "code": exc.code, **exc.extras}
        headers = {}
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": str(exc.detail), "code": "http_error"},
            headers=getattr(exc, "headers", None) or {},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {
                "loc": [str(part) for part in e.get("loc", ())],
                "msg": str(e.get("msg", "")),
                "type": str(e.get("type", "")),
            }
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Request validation failed",
                "code": "validation_error",
                "errors": errors,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error", "code": "internal_error"},
        )
