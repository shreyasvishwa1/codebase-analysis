import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.complexity.queries import (
    MAX_PAGE_SIZE,
    MAX_QUERY_CHARS,
    FileFilters,
    FunctionFilters,
    complexity_overview,
    list_files,
    list_functions,
)
from app.analysis.runner import AnalysisRunError, get_run
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import AnalysisRun, User
from app.schemas.complexity import (
    ComplexityFileListResponse,
    ComplexityFileResponse,
    ComplexityFunctionListResponse,
    ComplexityFunctionResponse,
    ComplexityOverviewResponse,
    ComplexityRank,
    FileSort,
    Maintainability,
    RepositoryComplexity,
)

# A run's complexity metrics. Every route requires an authenticated user and goes through the
# existing ownership lookup (404 for other users' repositories and runs).
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}/complexity",
    tags=["complexity"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/complexity", tags=["complexity"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Page = Annotated[int, Query(ge=1, le=10_000)]
PageSize = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)]
Text = Annotated[str | None, Query(max_length=MAX_QUERY_CHARS)]


async def _owned_run(
    db: AsyncSession, project_id: uuid.UUID, repository_id: uuid.UUID, run_id: uuid.UUID, user: User
) -> AnalysisRun:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        return await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.get("/files", response_model=ComplexityFileListResponse)
async def list_complexity_files(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    rank: ComplexityRank | None = None,
    maintainability: Maintainability | None = None,
    q: Text = None,
    sort: FileSort = "complexity",
    page: Page = 1,
    page_size: PageSize = 50,
) -> ComplexityFileListResponse:
    run = await _owned_run(db, project_id, repository_id, run_id, user)
    filters = FileFilters(
        rank=rank, maintainability=maintainability, query=(q or "").strip() or None, sort=sort
    )
    files, total = await list_files(db, run.id, filters, page, page_size)
    return ComplexityFileListResponse(
        items=[ComplexityFileResponse.model_validate(file) for file in files],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/functions", response_model=ComplexityFunctionListResponse)
async def list_complexity_functions(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    rank: ComplexityRank | None = None,
    path: Annotated[str | None, Query(max_length=1024)] = None,
    q: Text = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> ComplexityFunctionListResponse:
    run = await _owned_run(db, project_id, repository_id, run_id, user)
    filters = FunctionFilters(rank=rank, path=path or None, query=(q or "").strip() or None)
    functions, total = await list_functions(db, run.id, filters, page, page_size)
    return ComplexityFunctionListResponse(
        items=[ComplexityFunctionResponse.model_validate(function) for function in functions],
        total=total,
        page=page,
        page_size=page_size,
    )


@overview_router.get("", response_model=ComplexityOverviewResponse)
async def get_complexity_overview(db: DbSession, user: CurrentUser) -> ComplexityOverviewResponse:
    rows = await complexity_overview(db, user.id)
    return ComplexityOverviewResponse(
        repositories=[RepositoryComplexity.model_validate(row) for row in rows]
    )
