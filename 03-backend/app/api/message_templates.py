"""WhatsApp message templates (spec 09.4): read authenticated, CRUD admin.

The backend only stores the raw body — the FRONTEND renders the variables
``{{first_name}}``, ``{{course}}``, ``{{unit}}``, ``{{consultant}}`` from the
deal context before opening the ``wa.me`` link.
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError
from app.db.models import MessageTemplate, UserRole
from app.schemas.catalog import (
    MessageTemplateCreate,
    MessageTemplateOut,
    MessageTemplateUpdate,
)

router = APIRouter(prefix="/message-templates", tags=["message-templates"])


@router.get("", response_model=list[MessageTemplateOut])
async def list_message_templates(
    user: CurrentUser, db: DbSession, include_inactive: bool = False
) -> list[MessageTemplateOut]:
    """Active templates for everyone; ``include_inactive=true`` (admin only,
    silently ignored otherwise) also returns deactivated ones for the
    settings screen."""
    stmt = select(MessageTemplate).order_by(
        MessageTemplate.sort_order, MessageTemplate.name
    )
    if not (include_inactive and user.role == UserRole.ADMIN):
        stmt = stmt.where(MessageTemplate.is_active.is_(True))
    templates = (await db.scalars(stmt)).all()
    return [MessageTemplateOut.model_validate(t) for t in templates]


@router.post("", response_model=MessageTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_message_template(
    body: MessageTemplateCreate, admin: AdminUser, db: DbSession
) -> MessageTemplateOut:
    if await db.scalar(
        select(MessageTemplate).where(MessageTemplate.name == body.name)
    ):
        raise ConflictError(
            "A template with this name already exists", "duplicate_template"
        )
    template = MessageTemplate(
        name=body.name, body=body.body, sort_order=body.sort_order
    )
    db.add(template)
    await db.flush()
    return MessageTemplateOut.model_validate(template)


@router.patch("/{template_id}", response_model=MessageTemplateOut)
async def update_message_template(
    template_id: uuid.UUID, body: MessageTemplateUpdate, admin: AdminUser, db: DbSession
) -> MessageTemplateOut:
    template = await db.get(MessageTemplate, template_id)
    if template is None:
        raise NotFoundError("Message template", code="template_not_found")
    if body.name is not None and body.name != template.name:
        if await db.scalar(
            select(MessageTemplate).where(
                MessageTemplate.name == body.name, MessageTemplate.id != template.id
            )
        ):
            raise ConflictError(
                "A template with this name already exists", "duplicate_template"
            )
        template.name = body.name
    if body.body is not None:
        template.body = body.body
    if body.sort_order is not None:
        template.sort_order = body.sort_order
    if body.is_active is not None:
        template.is_active = body.is_active
    await db.flush()
    return MessageTemplateOut.model_validate(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message_template(
    template_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> None:
    """Hard delete — templates hold no history (prefer deactivating via PATCH
    when in doubt)."""
    template = await db.get(MessageTemplate, template_id)
    if template is None:
        raise NotFoundError("Message template", code="template_not_found")
    await db.delete(template)
    await db.flush()
