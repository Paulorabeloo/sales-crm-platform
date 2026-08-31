"""API v1 aggregate router."""

from fastapi import APIRouter

from app.api import (
    activities,
    auth,
    campaign_spend,
    contacts,
    cycles,
    deal_fields,
    deals,
    goals,
    lead_sources,
    lost_reasons,
    message_templates,
    my_day,
    objections,
    pipelines,
    units,
    reports,
    settings,
    tasks,
    users,
    webhooks,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(units.router)
api_router.include_router(pipelines.router)
api_router.include_router(deal_fields.router)
api_router.include_router(lost_reasons.router)
api_router.include_router(lead_sources.router)
api_router.include_router(message_templates.router)
api_router.include_router(cycles.router)
api_router.include_router(campaign_spend.router)
api_router.include_router(goals.router)
api_router.include_router(objections.router)
api_router.include_router(contacts.router)
api_router.include_router(deals.router)
api_router.include_router(my_day.router)
api_router.include_router(tasks.router)
api_router.include_router(activities.router)
api_router.include_router(webhooks.router)
api_router.include_router(reports.router)
api_router.include_router(settings.router)
