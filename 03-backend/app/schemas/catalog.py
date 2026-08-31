"""Schemas for admin-managed catalogs: units, pipelines/stages, lost reasons,
lead sources."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


# --- Units --------------------------------------------------------------------

class UnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UnitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None


class UnitOut(ORMModel):
    id: uuid.UUID
    name: str
    is_active: bool


# --- Pipelines & stages -------------------------------------------------------

class StageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(ge=1)
    is_won_stage: bool = False
    required_fields: list[str] = Field(default_factory=list, max_length=50)
    playbook: str | None = Field(default=None, max_length=5000)


class StageUpdate(BaseModel):
    """``playbook`` supports explicit clearing (send null); the router checks
    ``model_fields_set``. ``required_fields`` keys are validated against the
    ``GET /deal-fields`` catalog."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=1)
    is_won_stage: bool | None = None
    required_fields: list[str] | None = Field(default=None, max_length=50)
    playbook: str | None = Field(default=None, max_length=5000)


class StageOut(ORMModel):
    id: uuid.UUID
    pipeline_id: uuid.UUID
    name: str
    sort_order: int
    is_won_stage: bool
    required_fields: list[str]
    playbook: str | None


class DealFieldOut(BaseModel):
    """Catalog entry for the required-fields multi-select (spec 08). Labels
    are pt-BR and live in the frontend (strings.ts) — keyed by ``key``."""

    key: str
    type: str  # string | number | boolean | date | datetime | uuid


class PipelineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_default: bool = False


class PipelineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    is_default: bool | None = None


class PipelineOut(ORMModel):
    id: uuid.UUID
    name: str
    is_active: bool
    is_default: bool
    stages: list[StageOut] = []


# --- Lost reasons -------------------------------------------------------------

class LostReasonCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    sort_order: int = 0
    is_recoverable: bool = False


class LostReasonUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None
    is_active: bool | None = None
    is_recoverable: bool | None = None


class LostReasonOut(ORMModel):
    id: uuid.UUID
    label: str
    sort_order: int
    is_active: bool
    is_recoverable: bool


# --- Objections (spec 12.2) ---------------------------------------------------

class ObjectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rebuttal: str = Field(min_length=1, max_length=2000)
    template_id: uuid.UUID | None = None  # linked WhatsApp template (09.4)
    sort_order: int = 0


class ObjectionUpdate(BaseModel):
    """``template_id`` supports explicit clearing (send null); the router
    checks ``model_fields_set``."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    rebuttal: str | None = Field(default=None, min_length=1, max_length=2000)
    template_id: uuid.UUID | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ObjectionOut(ORMModel):
    id: uuid.UUID
    name: str
    rebuttal: str
    template_id: uuid.UUID | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


# --- Sources (lead origin catalog, feedback item 5) ---------------------------

class SourceCreate(BaseModel):
    """``key`` is optional: when omitted it is derived from ``label``. Either
    way the router normalizes it (trim + lowercase + accents + separators)."""

    key: str | None = Field(default=None, min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    sort_order: int = 0
    is_active: bool = True


class SourceUpdate(BaseModel):
    key: str | None = Field(default=None, min_length=1, max_length=120)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None
    is_active: bool | None = None


class SourceOut(ORMModel):
    id: uuid.UUID
    key: str  # the value actually stored in deals.source / campaign_spend.source
    label: str
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


# --- Lead sources -------------------------------------------------------------

class LeadSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    default_unit_id: uuid.UUID | None = None
    default_pipeline_id: uuid.UUID | None = None


class LeadSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    default_unit_id: uuid.UUID | None = None
    default_pipeline_id: uuid.UUID | None = None


class MessageTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)
    sort_order: int = 0


class MessageTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    sort_order: int | None = None
    is_active: bool | None = None


class MessageTemplateOut(ORMModel):
    id: uuid.UUID
    name: str
    body: str  # variables {{first_name}} {{course}} {{unit}} {{consultant}}
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class LeadSourceOut(ORMModel):
    id: uuid.UUID
    name: str
    token: str  # webhook credential — admin-only visibility (router enforces)
    default_unit_id: uuid.UUID | None
    default_pipeline_id: uuid.UUID | None
    is_active: bool
    revoked_at: datetime | None
    created_at: datetime
