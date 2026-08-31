"""Application settings loaded from environment (.env supported).

Pydantic-settings is the single boundary for configuration: nothing else in
the codebase reads ``os.environ`` directly.
"""

import logging
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_JWT_SECRET = "dev-only-secret-change-me"
_MIN_JWT_SECRET_LEN = 32
_logger = logging.getLogger("app.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://crm:crm@localhost:5432/sales_crm"

    # Security
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    cookie_secure: bool = False
    refresh_cookie_name: str = "crm_refresh_token"

    # CORS (comma-separated allowlist)
    cors_origins: str = "http://localhost:3000"

    # Chrome-extension origins allowed by CORS (comma-separated allowlist,
    # e.g. "chrome-extension://abcdefghijklmnopabcdefghijklmnop"). Kept
    # separate from CORS_ORIGINS so browser-app and extension allowlists are
    # managed independently. Empty = no extension origin allowed.
    extension_origins: str = ""

    # Access-token TTL for the extension login flow (?client=extension).
    # The extension has no refresh-cookie channel, so it gets a longer-lived
    # access token instead (stored in chrome.storage.session).
    extension_access_token_expire_hours: int = 12

    # Initial admin (seeds)
    # Note: must be a real-format email — ".local"/".test" TLDs are rejected
    # by the login validator (email-validator special-use domain rules).
    admin_email: str = "admin@example.com"
    admin_password: str = "ChangeMe123!"
    admin_name: str = "Admin"

    # Misc
    environment: str = "dev"

    # Webhook hardening
    webhook_max_body_bytes: int = 10 * 1024  # 10KB payload cap (architecture 2.7)

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in {"production", "prod"}

    @model_validator(mode="after")
    def _enforce_production_hardening(self) -> "Settings":
        """M4 fail-fast: refuse to start in production with unsafe secrets.

        - ``jwt_secret`` must not be the dev default and must be >= 32 chars
          (fatal in production, warning in dev/test).
        - ``cookie_secure`` must be true in production (fatal).
        """
        weak_secret = (
            self.jwt_secret == _DEFAULT_JWT_SECRET
            or len(self.jwt_secret) < _MIN_JWT_SECRET_LEN
        )
        if self.is_production:
            problems: list[str] = []
            if weak_secret:
                problems.append(
                    "JWT_SECRET is the dev default or shorter than "
                    f"{_MIN_JWT_SECRET_LEN} chars — generate one: "
                    'python -c "import secrets; print(secrets.token_urlsafe(48))"'
                )
            if not self.cookie_secure:
                problems.append(
                    "COOKIE_SECURE must be true in production (refresh cookie "
                    "over HTTPS only)"
                )
            if problems:
                raise ValueError(
                    "Refusing to start with ENVIRONMENT=production: "
                    + " | ".join(problems)
                )
        elif weak_secret:
            _logger.warning(
                "JWT_SECRET is the dev default or shorter than %d chars — fine "
                "for dev/test, fatal in production",
                _MIN_JWT_SECRET_LEN,
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def extension_origin_list(self) -> list[str]:
        """Validated chrome-extension:// origins (anything else is dropped)."""
        origins = [o.strip() for o in self.extension_origins.split(",") if o.strip()]
        return [o for o in origins if o.startswith("chrome-extension://")]

    @property
    def all_cors_origins(self) -> list[str]:
        return self.cors_origin_list + self.extension_origin_list


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance (import-time cheap, test-overridable)."""
    return Settings()
