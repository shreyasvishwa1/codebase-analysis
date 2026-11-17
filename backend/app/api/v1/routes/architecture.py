import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.results import latest_runs_with, run_entry
from app.analysis.runner import AnalysisRunError, get_run
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import ArchitectureReport, User
from app.schemas.architecture import (
    ArchitectureOverviewResponse,
    ArchitectureReportResponse,
    RepositoryArchitecture,
)

ARCHITECTURE_NOT_FOUND = "This run has no architecture report"

# A run's architecture. Every route requires an authenticated user and goes through the
# existing ownership lookup (404 for other users' repositories and runs).
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}"
    "/architecture",
    tags=["architecture"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/architecture", tags=["architecture"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=ArchitectureReportResponse)
async def get_run_architecture(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> ArchitectureReportResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    document = await db.scalar(
        select(ArchitectureReport.document).where(ArchitectureReport.run_id == run.id)
    )
    if document is None:  # a run stored before architecture analysis existed
        raise HTTPException(status_code=404, detail=ARCHITECTURE_NOT_FOUND)
    return ArchitectureReportResponse.model_validate(
        {"run_id": run.id, "created_at": run.created_at, "document": document}
    )


async def architecture_overview(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    return [
        {**run_entry(run, project, repository), "architecture": run.architecture}
        for run, project, repository in await latest_runs_with(db, user_id, "architecture")
    ]


@overview_router.get("", response_model=ArchitectureOverviewResponse)
async def get_architecture_overview(
    db: DbSession, user: CurrentUser
) -> ArchitectureOverviewResponse:
    rows = await architecture_overview(db, user.id)
    return ArchitectureOverviewResponse(
        repositories=[RepositoryArchitecture.model_validate(row) for row in rows]
    )
