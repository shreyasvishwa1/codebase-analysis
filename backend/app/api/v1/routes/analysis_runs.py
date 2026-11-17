import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.dashboard import dashboard_summary
from app.analysis.runner import (
    AnalysisRunError,
    get_run,
    latest_job,
    list_runs,
    start_full_analysis,
)
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import AnalysisJobStatus, User
from app.schemas.analysis_job import AnalysisJobResponse
from app.schemas.analysis_run import (
    AnalysisRunJobResponse,
    AnalysisRunListResponse,
    AnalysisRunResponse,
    DashboardSummary,
)
from app.services.rate_limit import Limit, RateLimit

# Starting a full analysis reads every file of a repository: limited per user.
FULL_ANALYSIS_LIMIT = Limit("full-analysis-user", 10, 600)

# Full analysis of a repository and its run history. Every route requires an authenticated
# user and goes through the existing ownership lookup (404 for other users' repositories).
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs",
    tags=["analysis runs"],
    dependencies=[Depends(get_current_user)],
)
dashboard_router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("", response_model=AnalysisRunJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_analysis_run(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    limiter: RateLimit,
) -> AnalysisRunJobResponse:
    # Ownership first, so another user's repository answers 404 before any limit applies.
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    await limiter.hit(FULL_ANALYSIS_LIMIT, str(user.id))
    try:
        job_id = await start_full_analysis(db, repository)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    return AnalysisRunJobResponse(
        job_id=job_id, repository_id=repository_id, status=AnalysisJobStatus.PENDING
    )


@router.get("", response_model=AnalysisRunListResponse)
async def list_analysis_runs(
    project_id: uuid.UUID, repository_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> AnalysisRunListResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    job = await latest_job(db, repository.id)
    runs = await list_runs(db, repository.id)
    return AnalysisRunListResponse(
        job=AnalysisJobResponse.model_validate(job) if job is not None else None,
        runs=[AnalysisRunResponse.model_validate(run) for run in runs],
    )


@router.get("/{run_id}", response_model=AnalysisRunResponse)
async def get_analysis_run(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> AnalysisRunResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    return AnalysisRunResponse.model_validate(run)


@dashboard_router.get("", response_model=DashboardSummary)
async def get_dashboard(db: DbSession, user: CurrentUser) -> DashboardSummary:
    return await dashboard_summary(db, user.id)
