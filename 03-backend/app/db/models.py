"""SQLAlchemy 2.0 models for the Sales CRM.

Adapted from the canonical ``02-schema/models.py`` (dev-database-architect).
Mirrors the canonical DDL in ``02-schema/schema.sql`` (PostgreSQL 16), which is
embedded in the initial Alembic migration. The database is the source of truth
for invariants (CHECKs, triggers, partial unique indexes); these models are the
typed application-side view of it.

Backend-specific addition: ``refresh_tokens`` (ADR-002 — rotated refresh
tokens, stored hashed, revocable).

Conventions
-----------
- Tables: snake_case plural. PKs: ``id`` UUID (app generates UUIDv7 via
  ``uuid6.uuid7`` for time-ordered ids; DB default ``gen_random_uuid()`` is a
  fallback for ad-hoc inserts).
- All timestamps are timezone-aware (``timestamptz``).
- Soft-delete (LGPD) only on tables holding personal data: ``contacts`` and
  ``deals`` (``deleted_at``). Application queries must filter it by default.
- ``deals.last_activity_at`` and ``deal_stage_history`` are maintained by DB
  triggers — the application must NOT write them directly. The backend sets
  ``SET LOCAL app.user_id = '<uuid>'`` per request so triggers can attribute
  stage changes.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)
from sqlalchemy.types import Enum as SAEnum
from uuid6 import uuid7  # UUIDv7 generator; PG16 lacks uuidv7()


# ---------------------------------------------------------------------------
# Enums (mirror the PostgreSQL ENUM types 1:1 — names AND values)
# ---------------------------------------------------------------------------

class UserRole(str, enum.Enum):
    """Access role. No dynamic RBAC at this scale (see the architecture ADR)."""

    ADMIN = "ADMIN"
    CONSULTOR = "CONSULTOR"


class DealStatus(str, enum.Enum):
    """Deal lifecycle. ``lost`` requires a lost reason (DB CHECK)."""

    OPEN = "open"
    WON = "won"
    LOST = "lost"


class ActivityType(str, enum.Enum):
    """Timeline entry types. Only ``NOTE`` is user-written; the rest are
    system events emitted by the backend (never by the client)."""

    NOTE = "note"
    DEAL_CREATED = "deal_created"
    STAGE_CHANGED = "stage_changed"
    STATUS_CHANGED = "status_changed"
    FIRST_CONTACT_REGISTERED = "first_contact_registered"
    FIRST_CONTACT_CORRECTED = "first_contact_corrected"
    TASK_CREATED = "task_created"
    TASK_COMPLETED = "task_completed"
    OWNER_CHANGED = "owner_changed"
    # Quick-log outcomes: one-click contact result registration.
    ATTEMPT_NO_ANSWER = "attempt_no_answer"
    TALKED_ADVANCE = "talked_advance"
    TALKED_OBJECTION = "talked_objection"
    VISIT_SCHEDULED = "visit_scheduled"
    # Cycle machinery (the spec/10.4): rollover move + win-back link.
    CYCLE_CHANGED = "cycle_changed"
    REOPENED_IN_CYCLE = "reopened_in_cycle"


class WebhookDeliveryResult(str, enum.Enum):
    """Outcome of one webhook hit (log kept even for rejects)."""

    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DUPLICATE_CONTACT = "duplicate_contact"


def pg_enum(py_enum: type[enum.Enum], name: str) -> SAEnum:
    """Bind a Python enum to an existing PostgreSQL ENUM type by *value*."""
    return SAEnum(
        py_enum,
        name=name,
        values_callable=lambda e: [m.value for m in e],
        create_type=False,  # types are created by the Alembic migration
    )


# ---------------------------------------------------------------------------
# Base + mixins
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    """Declarative base with shared type defaults."""

    type_annotation_map = {
        datetime: DateTime(timezone=True),
    }


class PKMixin:
    """UUID primary key, app-generated UUIDv7 (time-ordered)."""

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid7,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    """created_at / updated_at (updated_at bumped by DB trigger)."""

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Unit(PKMixin, TimestampMixin, Base):
    """Business unit (branch / sales team). Informative/filter dimension only —
    no access gating by unit (gate decision 2026-08-28)."""

    __tablename__ = "units"

    name: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))

    users: Mapped[list["User"]] = relationship(back_populates="unit")
    deals: Mapped[list["Deal"]] = relationship(back_populates="unit")


class User(PKMixin, TimestampMixin, Base):
    """Account created by an admin (no open signup). Deactivate, never delete:
    deal history must survive (FKs are RESTRICT)."""

    __tablename__ = "users"
    __table_args__ = (
        Index("ux_users_email_lower", func.lower(text("email")), unique=True),
    )

    email: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)  # argon2id
    # Cut-off for stateless access tokens: any token issued before this instant
    # is refused by ``get_current_user`` (M8). Changing or resetting a password
    # therefore kills every live session, including the extension's 12h token.
    password_changed_at: Mapped[datetime] = mapped_column(server_default=func.now())
    name: Mapped[str] = mapped_column(Text)
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"), server_default=UserRole.CONSULTOR.value
    )
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))
    unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT"), index=True
    )

    unit: Mapped[Optional[Unit]] = relationship(back_populates="users")
    owned_deals: Mapped[list["Deal"]] = relationship(
        back_populates="owner", foreign_keys="Deal.owner_id"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")


class RefreshToken(PKMixin, Base):
    """Rotated refresh token (ADR-002). Only the SHA-256 of the opaque token
    is stored. Rotation: using a token revokes it and issues a replacement;
    logout revokes; reuse of a revoked token is rejected."""

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_user_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[Optional[datetime]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class Pipeline(PKMixin, TimestampMixin, Base):
    """Sales pipeline. Exactly one default (partial unique index in DDL)."""

    __tablename__ = "pipelines"

    name: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))
    is_default: Mapped[bool] = mapped_column(server_default=text("false"))

    stages: Mapped[list["Stage"]] = relationship(
        back_populates="pipeline", order_by="Stage.sort_order"
    )
    deals: Mapped[list["Deal"]] = relationship(back_populates="pipeline")


class Stage(PKMixin, TimestampMixin, Base):
    """Kanban column. ``sort_order`` is unique per pipeline (deferrable, so
    reorders can swap inside one transaction). At most one won-stage per
    pipeline (partial unique index in DDL)."""

    __tablename__ = "stages"
    __table_args__ = (
        UniqueConstraint(
            "pipeline_id", "sort_order",
            name="ux_stages_pipeline_sort", deferrable=True,
        ),
        UniqueConstraint("id", "pipeline_id", name="ux_stages_id_pipeline"),
    )

    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pipelines.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int]
    is_won_stage: Mapped[bool] = mapped_column(server_default=text("false"))
    # Entry gate: field keys a deal must have filled to ENTER this
    # stage. Valid keys come from app/services/deal_fields.py.
    required_fields: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # Per-stage sales guide shown on the deal detail (the spec, admin-edited).
    playbook: Mapped[Optional[str]] = mapped_column(Text)

    pipeline: Mapped[Pipeline] = relationship(back_populates="stages")
    deals: Mapped[list["Deal"]] = relationship(
        back_populates="stage",
        foreign_keys="Deal.stage_id",
        primaryjoin="Stage.id == Deal.stage_id",
    )


class Cycle(PKMixin, TimestampMixin, Base):
    """Sales/enrollment cycle — e.g. "2026.2". At most ONE active
    cycle (partial unique index). Every deal belongs to a cycle; new deals
    default to the active one."""

    __tablename__ = "cycles"

    name: Mapped[str] = mapped_column(Text, unique=True)
    starts_on: Mapped[date] = mapped_column(Date)
    deadline_on: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(server_default=text("false"))

    deals: Mapped[list["Deal"]] = relationship(back_populates="cycle")


class CampaignSpend(PKMixin, TimestampMixin, Base):
    """Monthly ad-spend input — the CAC report joins it against
    won deals. ``month`` is always the first day of the month (DB CHECK).
    Unique per (month, source, campaign, unit_id) with NULLS NOT DISTINCT."""

    __tablename__ = "campaign_spend"

    month: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(Text)
    campaign: Mapped[Optional[str]] = mapped_column(Text)
    unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    unit: Mapped[Optional[Unit]] = relationship()


class Goal(PKMixin, TimestampMixin, Base):
    """Per-cycle enrollment target. ``scope`` decides the target:
    ``consultant`` -> ``target_user_id``; ``unit`` -> ``unit_id`` (XOR, DB
    CHECK). One goal per target per cycle (unique, NULLS NOT DISTINCT)."""

    __tablename__ = "goals"

    cycle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cycles.id", ondelete="RESTRICT"), index=True
    )
    scope: Mapped[str] = mapped_column(Text)  # 'consultant' | 'unit'
    target_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT")
    )
    target_count: Mapped[int]

    cycle: Mapped[Cycle] = relationship()
    target_user: Mapped[Optional[User]] = relationship()
    unit: Mapped[Optional[Unit]] = relationship()


class Objection(PKMixin, TimestampMixin, Base):
    """Objection catalog: named objection + suggested rebuttal +
    optional linked WhatsApp template. Deactivate instead of delete when the
    objection is referenced by deals (FK RESTRICT)."""

    __tablename__ = "objections"

    name: Mapped[str] = mapped_column(Text, unique=True)
    rebuttal: Mapped[str] = mapped_column(Text)
    template_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("message_templates.id", ondelete="SET NULL")
    )
    sort_order: Mapped[int] = mapped_column(server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))

    template: Mapped[Optional["MessageTemplate"]] = relationship()


class Contact(PKMixin, TimestampMixin, Base):
    """Person (LGPD: soft-delete). ``phone_whatsapp`` is E.164-normalized by
    the application and is the dedupe key (partial unique on active rows)."""

    __tablename__ = "contacts"

    name: Mapped[str] = mapped_column(Text)
    phone_whatsapp: Mapped[str] = mapped_column(Text)  # E.164, e.g. +5563999998888
    email: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    deleted_at: Mapped[Optional[datetime]]

    deals: Mapped[list["Deal"]] = relationship(back_populates="contact")


class LostReason(PKMixin, TimestampMixin, Base):
    """Admin-managed catalog. Deactivate instead of delete so historical
    reports keep their labels."""

    __tablename__ = "lost_reasons"

    label: Mapped[str] = mapped_column(Text, unique=True)
    sort_order: Mapped[int] = mapped_column(server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))
    # Win-back flag: losses with this reason are candidates for
    # the "reopen in the active cycle" rescue list.
    is_recoverable: Mapped[bool] = mapped_column(server_default=text("false"))

    deals: Mapped[list["Deal"]] = relationship(back_populates="lost_reason")


class Deal(PKMixin, TimestampMixin, Base):
    """Central entity (a negotiation / enrollment funnel item).

    First-class columns are the ones used in filters, kanban, reports or
    business rules. The ~25 progressive-fill enrollment fields live in
    ``enrollment_data`` (JSONB), whose shape is owned by the Pydantic
    ``EnrollmentData`` schema (``app/schemas/enrollment.py``).

    Trigger-maintained (do NOT set from the app):
    - ``last_activity_at`` — bumped on every activity insert.
    - ``deal_stage_history`` rows — written on insert and on stage change.
    - ``first_whatsapp_contact_at`` is write-once; admin correction requires
      ``SET LOCAL app.allow_first_contact_override = 'on'``.
    """

    __tablename__ = "deals"
    __table_args__ = (
        ForeignKeyConstraint(
            ["stage_id", "pipeline_id"],
            ["stages.id", "stages.pipeline_id"],
            name="fk_deals_stage_in_pipeline",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status <> 'lost' OR (lost_reason_id IS NOT NULL AND lost_at IS NOT NULL)",
            name="ck_deals_lost_requires_reason",
        ),
        CheckConstraint(
            "status <> 'won' OR won_at IS NOT NULL",
            name="ck_deals_won_requires_won_at",
        ),
        CheckConstraint(
            "status <> 'open' OR (won_at IS NULL AND lost_at IS NULL "
            "AND lost_reason_id IS NULL)",
            name="ck_deals_open_has_no_outcome",
        ),
        CheckConstraint(
            "qualification BETWEEN 1 AND 5", name="ck_deals_qualification_range"
        ),
    )

    title: Mapped[str] = mapped_column(Text)
    status: Mapped[DealStatus] = mapped_column(
        pg_enum(DealStatus, "deal_status"), server_default=DealStatus.OPEN.value
    )
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pipelines.id", ondelete="RESTRICT")
    )
    stage_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    owner_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )  # NULL = unassigned-leads queue
    unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT")
    )
    contact_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contacts.id", ondelete="RESTRICT")
    )
    # Sales cycle: mandatory dimension; defaults to the active
    # cycle on creation (manual and webhook).
    cycle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cycles.id", ondelete="RESTRICT"), index=True
    )
    # Main objection from the catalog. Free-text legacy stays in
    # enrollment_data.main_objection.
    objection_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("objections.id", ondelete="RESTRICT")
    )
    value: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2))
    qualification: Mapped[Optional[int]] = mapped_column(SmallInteger)  # 1 cold .. 5 hot
    expected_close_date: Mapped[Optional[date]] = mapped_column(Date)
    source: Mapped[Optional[str]] = mapped_column(Text)
    campaign: Mapped[Optional[str]] = mapped_column(Text)
    lost_reason_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("lost_reasons.id", ondelete="RESTRICT")
    )
    lost_notes: Mapped[Optional[str]] = mapped_column(Text)
    first_whatsapp_contact_at: Mapped[Optional[datetime]]
    # Follow-up "next step": when the consultant plans to contact
    # the lead again. NULL on an open deal = "no next step" badge.
    next_contact_at: Mapped[Optional[datetime]]
    last_activity_at: Mapped[datetime] = mapped_column(server_default=func.now())
    won_at: Mapped[Optional[datetime]]
    lost_at: Mapped[Optional[datetime]]
    enrollment_data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    deleted_at: Mapped[Optional[datetime]]

    pipeline: Mapped[Pipeline] = relationship(
        back_populates="deals", foreign_keys=[pipeline_id]
    )
    stage: Mapped[Stage] = relationship(
        back_populates="deals",
        foreign_keys=[stage_id],
        primaryjoin="Deal.stage_id == Stage.id",
    )
    owner: Mapped[Optional[User]] = relationship(
        back_populates="owned_deals", foreign_keys=[owner_id]
    )
    unit: Mapped[Optional[Unit]] = relationship(back_populates="deals")
    contact: Mapped[Contact] = relationship(back_populates="deals")
    cycle: Mapped[Cycle] = relationship(back_populates="deals")
    objection: Mapped[Optional[Objection]] = relationship()
    lost_reason: Mapped[Optional[LostReason]] = relationship(back_populates="deals")
    tasks: Mapped[list["Task"]] = relationship(back_populates="deal")
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="deal", order_by="Activity.created_at.desc()"
    )
    stage_history: Mapped[list["DealStageHistory"]] = relationship(
        back_populates="deal", order_by="DealStageHistory.entered_at"
    )


class DealStageHistory(PKMixin, Base):
    """One row per stay in a stage (``entered_at`` / ``left_at``).

    ``left_at IS NULL`` marks the current stage (unique per deal). Rows are
    written exclusively by DB triggers on ``deals`` — treat as read-only.
    """

    __tablename__ = "deal_stage_history"
    __table_args__ = (
        Index("ix_dsh_deal_entered", "deal_id", "entered_at"),
        Index("ix_dsh_stage_entered", "stage_id", "entered_at"),
    )

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deals.id", ondelete="RESTRICT")
    )
    stage_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT")
    )
    entered_at: Mapped[datetime] = mapped_column(server_default=func.now())
    left_at: Mapped[Optional[datetime]]
    changed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )  # NULL = system (e.g. webhook)

    deal: Mapped[Deal] = relationship(back_populates="stage_history")
    stage: Mapped[Stage] = relationship()


class Activity(PKMixin, Base):
    """Timeline entry on a deal. ``NOTE`` is user-written free text; all other
    types are backend-emitted events with structured ``payload``. Inserting an
    activity bumps ``deals.last_activity_at`` via trigger ("warms" the lead)."""

    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_deal_created", "deal_id", "created_at"),
    )

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deals.id", ondelete="RESTRICT")
    )
    type: Mapped[ActivityType] = mapped_column(pg_enum(ActivityType, "activity_type"))
    body: Mapped[Optional[str]] = mapped_column(Text)  # required when type == NOTE
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )  # NULL = system
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    deal: Mapped[Deal] = relationship(back_populates="activities")
    user: Mapped[Optional[User]] = relationship()


class Task(PKMixin, TimestampMixin, Base):
    """Per-deal to-do. ``due_date`` is a plain date (no time in phase 1).

    ``assigned_to`` / ``created_by`` are nullable since phase : the lead
    webhook auto-creates a "Make first contact" task with no assignee and no
    creator (NULL = system); claiming the deal assigns its open unassigned
    tasks to the new owner.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_my_tasks", "assigned_to", "is_done", "due_date"),
    )

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deals.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(Text)
    due_date: Mapped[date] = mapped_column(Date)
    is_done: Mapped[bool] = mapped_column(server_default=text("false"))
    done_at: Mapped[Optional[datetime]]
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )  # NULL = unassigned (waits for the deal claim)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )  # NULL = system (webhook cadence)

    deal: Mapped[Deal] = relationship(back_populates="tasks")
    assignee: Mapped[Optional[User]] = relationship(foreign_keys=[assigned_to])
    creator: Mapped[Optional[User]] = relationship(foreign_keys=[created_by])


class LeadSource(PKMixin, TimestampMixin, Base):
    """Lead-capture source. One source = one webhook token (random secret
    generated with ``secrets.token_urlsafe(32)``). Revoke by setting
    ``is_active=False`` + ``revoked_at`` — the delivery log is preserved."""

    __tablename__ = "lead_sources"

    name: Mapped[str] = mapped_column(Text, unique=True)
    token: Mapped[str] = mapped_column(Text, unique=True)
    default_unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT"), index=True
    )
    default_pipeline_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("pipelines.id", ondelete="RESTRICT"), index=True
    )
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))
    revoked_at: Mapped[Optional[datetime]]

    default_unit: Mapped[Optional[Unit]] = relationship()
    default_pipeline: Mapped[Optional[Pipeline]] = relationship()
    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        back_populates="lead_source"
    )


class WebhookDelivery(PKMixin, Base):
    """Raw log of every webhook hit, accepted or not. Append-only; exists to
    debug capture sources (e.g. Apps Script LPs) that fail silently."""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        Index("ix_wd_source_created", "lead_source_id", "created_at"),
    )

    lead_source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lead_sources.id", ondelete="RESTRICT")
    )
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    result: Mapped[WebhookDeliveryResult] = mapped_column(
        pg_enum(WebhookDeliveryResult, "webhook_delivery_result")
    )
    error_detail: Mapped[Optional[str]] = mapped_column(Text)
    deal_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("deals.id", ondelete="SET NULL"), index=True
    )
    ip: Mapped[Optional[str]] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    lead_source: Mapped[LeadSource] = relationship(back_populates="deliveries")
    deal: Mapped[Optional[Deal]] = relationship()


class MessageTemplate(PKMixin, TimestampMixin, Base):
    """WhatsApp message template. The backend only stores the
    body; rendering the ``{{first_name}}/{{course}}/{{unit}}/{{consultant}}``
    variables is the frontend's job (it has the deal context loaded)."""

    __tablename__ = "message_templates"

    name: Mapped[str] = mapped_column(Text, unique=True)
    body: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))


class AppSetting(Base):
    """Global key-value configuration (JSONB values), e.g. cooling_days=3."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
