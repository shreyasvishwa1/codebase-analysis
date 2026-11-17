import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.dependencies.queries import (
    MAX_PAGE_SIZE,
    MAX_QUERY_CHARS,
    DependencyFilters,
    dependency_overview,
    list_dependencies,
)
from app.analysis.runner import AnalysisRunError, get_run
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import User
from app.schemas.dependency_record import (
    DependencyOverviewResponse,
    DependencyRecordListResponse,
    DependencyRecordResponse,
    DependencySort,
    Ecosystem,
    RepositoryDependencies,
    ScopeFilter,
    Update,
)

# A run's dependency results. Every route requires an authenticated user and goes through
# the existing ownership lookup (404 for other users' repositories and runs). The existing
# request-time inventory (/repositories/{id}/dependencies) is separate and unchanged.
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}"
    "/dependencies",
    tags=["dependency analysis"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/dependency-analysis", tags=["dependency analysis"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=DependencyRecordListResponse)
async def list_run_dependencies(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    ecosystem: Ecosystem | None = None,
    scope: ScopeFilter | None = None,
    update: Update | None = None,
    vulnerable: bool | None = None,
    conflict: bool | None = None,
    q: Annotated[str | None, Query(max_length=MAX_QUERY_CHARS)] = None,
    sort: DependencySort = "risk",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
) -> DependencyRecordListResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    filters = DependencyFilters(
        ecosystem=ecosystem,
        scope=scope,
        update=update,
        vulnerable=vulnerable,
        conflict=conflict,
        query=(q or "").strip() or None,
        sort=sort,
    )
    records, total = await list_dependencies(db, run.id, filters, page, page_size)
    return DependencyRecordListResponse(
        items=[DependencyRecordResponse.model_validate(record) for record in records],
        total=total,
        page=page,
        page_size=page_size,
    )


@overview_router.get("", response_model=DependencyOverviewResponse)
async def get_dependency_overview(db: DbSession, user: CurrentUser) -> DependencyOverviewResponse:
    rows = await dependency_overview(db, user.id)
    return DependencyOverviewResponse(
        repositories=[RepositoryDependencies.model_validate(row) for row in rows]
    )
