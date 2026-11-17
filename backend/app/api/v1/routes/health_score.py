"""The Code Health Score: per-run reports, a repository's history, an overview of the user's
repositories and the user's weights. Scores are computed from each run's stored summaries when
they are read (app.analysis.health), with the signed-in user's weights."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import health
from app.analysis.results import latest_runs_with, run_entry
from app.analysis.runner import AnalysisRunError, get_run, list_runs
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import AnalysisRun, ArchitectureReport, User
from app.schemas.health import (
    HealthDimension,
    HealthHistoryResponse,
    HealthOverviewResponse,
    HealthPoint,
    HealthReportResponse,
    HealthWeights,
    HealthWeightsResponse,
    RepositoryHealth,
)

NOT_SCORED = "This run was stored before the analyses the health score uses"

router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}",
    tags=["health score"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/health-score", tags=["health score"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def weights_of(user: User) -> dict[str, int]:
    stored = user.health_weights
    if isinstance(stored, dict) and set(stored) == set(health.DIMENSION_KEYS):
        return {key: int(stored[key]) for key in health.DIMENSION_KEYS}
    return dict(health.DEFAULT_WEIGHTS)


def scorable(run: AnalysisRun) -> bool:
    """Runs stored before code-quality analysis have none of the summaries scored here."""
    return run.quality is not None


async def _report_documents(db: AsyncSession, runs: list[AnalysisRun]) -> dict[uuid.UUID, Any]:
    """Architecture documents, only for the (older) runs whose summary lacks the facts."""
    ids = [run.id for run in runs if health.needs_report(run)]
    if not ids:
        return {}
    rows = await db.execute(
        select(ArchitectureReport.run_id, ArchitectureReport.document).where(
            ArchitectureReport.run_id.in_(ids)
        )
    )
    return dict(rows.all())  # type: ignore[arg-type]


def _scores(
    run: AnalysisRun, document: Any, weights: dict[str, int]
) -> tuple[list[health.Dimension], int | None]:
    dimensions = health.dimensions(run, document)
    overall = health.overall({d.key: d.score for d in dimensions}, weights)
    return dimensions, overall


def _point(run: AnalysisRun, document: Any, weights: dict[str, int]) -> dict[str, Any]:
    dimensions, overall = _scores(run, document, weights)
    return {
        "run_id": run.id,
        "created_at": run.created_at,
        "overall": overall,
        "grade": health.grade(overall),
        "scores": {d.key: d.score for d in dimensions},
    }


@router.get("/analysis-runs/{run_id}/health", response_model=HealthReportResponse)
async def get_run_health(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> HealthReportResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    if not scorable(run):
        raise HTTPException(status_code=404, detail=NOT_SCORED)
    weights = weights_of(user)
    documents = await _report_documents(db, [run])
    dimensions, overall = _scores(run, documents.get(run.id), weights)
    return HealthReportResponse(
        run_id=run.id,
        created_at=run.created_at,
        overall=overall,
        grade=health.grade(overall),
        weights=HealthWeights(**weights),
        dimensions=[HealthDimension(**d.as_dict(), weight=weights[d.key]) for d in dimensions],
    )


@router.get("/health-history", response_model=HealthHistoryResponse)
async def get_health_history(
    project_id: uuid.UUID, repository_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> HealthHistoryResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    runs = [run for run in await list_runs(db, repository.id) if scorable(run)]
    weights = weights_of(user)
    documents = await _report_documents(db, runs)
    points = [HealthPoint(**_point(run, documents.get(run.id), weights)) for run in reversed(runs)]
    return HealthHistoryResponse(points=points)


@overview_router.get("", response_model=HealthOverviewResponse)
async def get_health_overview(db: DbSession, user: CurrentUser) -> HealthOverviewResponse:
    weights = weights_of(user)
    latest = await latest_runs_with(db, user.id, "quality")
    documents = await _report_documents(db, [run for run, _, _ in latest])
    repositories = []
    for run, project, repository in latest:
        entry = run_entry(run, project, repository)
        repositories.append(
            RepositoryHealth(
                **{
                    k: entry[k]
                    for k in ("project_id", "project_name", "repository_id", "repository_name")
                },
                **_point(run, documents.get(run.id), weights),
            )
        )
    return HealthOverviewResponse(weights=HealthWeights(**weights), repositories=repositories)


@overview_router.get("/weights", response_model=HealthWeightsResponse)
async def get_weights(user: CurrentUser) -> HealthWeightsResponse:
    weights = weights_of(user)
    return HealthWeightsResponse(
        weights=HealthWeights(**weights), defaults=weights == health.DEFAULT_WEIGHTS
    )


@overview_router.put("/weights", response_model=HealthWeightsResponse)
async def put_weights(
    body: HealthWeights, db: DbSession, user: CurrentUser
) -> HealthWeightsResponse:
    weights = body.model_dump()
    user.health_weights = weights
    await db.commit()
    return HealthWeightsResponse(weights=body, defaults=weights == health.DEFAULT_WEIGHTS)


@overview_router.delete("/weights", status_code=status.HTTP_204_NO_CONTENT)
async def reset_weights(db: DbSession, user: CurrentUser) -> Response:
    user.health_weights = None
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
