"""Pipelines & stages: read authenticated, write admin-only.

Deleting a stage that still holds deals is blocked (phase 1 decision:
move the deals first)."""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import Deal, DealStageHistory, Pipeline, Stage
from app.schemas.catalog import (
    PipelineCreate,
    PipelineOut,
    PipelineUpdate,
    StageCreate,
    StageOut,
    StageUpdate,
)
from app.services.deal_fields import invalid_field_keys


def _validate_required_fields(keys: list[str]) -> list[str]:
    """Reject keys outside the ``GET /deal-fields`` catalog (dedup preserved
    order)."""
    invalid = invalid_field_keys(keys)
    if invalid:
        raise ValidationFailedError(
            "required_fields contains keys outside the deal-field catalog",
            "invalid_required_field",
            extras={"invalid_fields": invalid},
        )
    return list(dict.fromkeys(keys))

router = APIRouter(tags=["pipelines"])


@router.get("/pipelines", response_model=list[PipelineOut])
async def list_pipelines(user: CurrentUser, db: DbSession) -> list[PipelineOut]:
    pipelines = (
        await db.scalars(
            select(Pipeline).options(selectinload(Pipeline.stages)).order_by(Pipeline.name)
        )
    ).all()
    return [PipelineOut.model_validate(p) for p in pipelines]


@router.post("/pipelines", response_model=PipelineOut, status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    body: PipelineCreate, admin: AdminUser, db: DbSession
) -> PipelineOut:
    if await db.scalar(select(Pipeline).where(Pipeline.name == body.name)):
        raise ConflictError("A pipeline with this name already exists", "duplicate_pipeline")
    if body.is_default:
        await _clear_default(db)
    pipeline = Pipeline(name=body.name, is_default=body.is_default)
    db.add(pipeline)
    await db.flush()
    await db.refresh(pipeline, ["stages"])
    return PipelineOut.model_validate(pipeline)


async def _clear_default(db: DbSession) -> None:
    current = await db.scalar(select(Pipeline).where(Pipeline.is_default.is_(True)))
    if current is not None:
        current.is_default = False
        await db.flush()


async def _get_pipeline_or_404(db: DbSession, pipeline_id: uuid.UUID) -> Pipeline:
    pipeline = await db.scalar(
        select(Pipeline)
        .where(Pipeline.id == pipeline_id)
        .options(selectinload(Pipeline.stages))
    )
    if pipeline is None:
        raise NotFoundError("Pipeline", code="pipeline_not_found")
    return pipeline


@router.patch("/pipelines/{pipeline_id}", response_model=PipelineOut)
async def update_pipeline(
    pipeline_id: uuid.UUID, body: PipelineUpdate, admin: AdminUser, db: DbSession
) -> PipelineOut:
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    if body.name is not None:
        pipeline.name = body.name
    if body.is_active is not None:
        pipeline.is_active = body.is_active
    if body.is_default is True and not pipeline.is_default:
        await _clear_default(db)
        pipeline.is_default = True
    await db.flush()
    return PipelineOut.model_validate(pipeline)


@router.post(
    "/pipelines/{pipeline_id}/stages",
    response_model=StageOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_stage(
    pipeline_id: uuid.UUID, body: StageCreate, admin: AdminUser, db: DbSession
) -> StageOut:
    await _get_pipeline_or_404(db, pipeline_id)
    if body.is_won_stage:
        existing_won = await db.scalar(
            select(Stage).where(
                Stage.pipeline_id == pipeline_id, Stage.is_won_stage.is_(True)
            )
        )
        if existing_won is not None:
            raise ConflictError(
                "Pipeline already has a won-stage", "won_stage_exists"
            )
    taken = await db.scalar(
        select(Stage).where(
            Stage.pipeline_id == pipeline_id, Stage.sort_order == body.sort_order
        )
    )
    if taken is not None:
        raise ConflictError("sort_order already in use in this pipeline", "sort_order_taken")
    stage = Stage(
        pipeline_id=pipeline_id,
        name=body.name,
        sort_order=body.sort_order,
        is_won_stage=body.is_won_stage,
        required_fields=_validate_required_fields(body.required_fields),
        playbook=body.playbook,
    )
    db.add(stage)
    await db.flush()
    return StageOut.model_validate(stage)


@router.patch("/stages/{stage_id}", response_model=StageOut)
async def update_stage(
    stage_id: uuid.UUID, body: StageUpdate, admin: AdminUser, db: DbSession
) -> StageOut:
    stage = await db.get(Stage, stage_id)
    if stage is None:
        raise NotFoundError("Stage", code="stage_not_found")
    if body.name is not None:
        stage.name = body.name
    if body.sort_order is not None and body.sort_order != stage.sort_order:
        taken = await db.scalar(
            select(Stage).where(
                Stage.pipeline_id == stage.pipeline_id,
                Stage.sort_order == body.sort_order,
                Stage.id != stage.id,
            )
        )
        if taken is not None:
            raise ConflictError(
                "sort_order already in use in this pipeline", "sort_order_taken"
            )
        stage.sort_order = body.sort_order
    if body.is_won_stage is not None and body.is_won_stage != stage.is_won_stage:
        if body.is_won_stage:
            existing_won = await db.scalar(
                select(Stage).where(
                    Stage.pipeline_id == stage.pipeline_id,
                    Stage.is_won_stage.is_(True),
                    Stage.id != stage.id,
                )
            )
            if existing_won is not None:
                raise ConflictError("Pipeline already has a won-stage", "won_stage_exists")
        stage.is_won_stage = body.is_won_stage
    if body.required_fields is not None:
        stage.required_fields = _validate_required_fields(body.required_fields)
    if "playbook" in body.model_fields_set:  # allows explicit clearing (null)
        stage.playbook = body.playbook
    await db.flush()
    return StageOut.model_validate(stage)


@router.delete("/stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stage(stage_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    stage = await db.get(Stage, stage_id)
    if stage is None:
        raise NotFoundError("Stage", code="stage_not_found")
    deal_count = await db.scalar(
        select(func.count()).select_from(Deal).where(Deal.stage_id == stage_id)
    )
    if deal_count:
        raise ConflictError(
            "Stage still holds deals — move them before deleting",
            "stage_has_deals",
            extras={"deal_count": int(deal_count)},
        )
    history_count = await db.scalar(
        select(func.count())
        .select_from(DealStageHistory)
        .where(DealStageHistory.stage_id == stage_id)
    )
    if history_count:
        raise ConflictError(
            "Stage appears in deal history and cannot be deleted (deactivate the "
            "pipeline or rename the stage instead)",
            "stage_has_history",
        )
    await db.delete(stage)
    await db.flush()
