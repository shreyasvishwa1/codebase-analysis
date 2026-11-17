import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.quality.queries import (
    MAX_PAGE_SIZE,
    MAX_QUERY_CHARS,
    IssueFilters,
    list_issues,
    quality_overview,
)
from app.analysis.runner import AnalysisRunError, get_run
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import User
from app.schemas.code_issue import (
    Category,
    CodeIssueListResponse,
    CodeIssueResponse,
    QualityOverviewResponse,
    RepositoryQuality,
    Severity,
)

# A run's code-quality issues. Every route requires an authenticated user and goes through
# the existing ownership lookup (404 for other users' repositories and runs).
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}/issues",
    tags=["code quality"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/code-quality", tags=["code quality"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=CodeIssueListResponse)
async def list_run_issues(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    severity: Severity | None = None,
    category: Category | None = None,
    path: Annotated[str | None, Query(max_length=1024)] = None,
    q: Annotated[str | None, Query(max_length=MAX_QUERY_CHARS)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
) -> CodeIssueListResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    filters = IssueFilters(
        severity=severity, category=category, path=path or None, query=(q or "").strip() or None
    )
    issues, total = await list_issues(db, run.id, filters, page, page_size)
    return CodeIssueListResponse(
        items=[CodeIssueResponse.model_validate(issue) for issue in issues],
        total=total,
        page=page,
        page_size=page_size,
    )


@overview_router.get("", response_model=QualityOverviewResponse)
async def get_quality_overview(db: DbSession, user: CurrentUser) -> QualityOverviewResponse:
    rows = await quality_overview(db, user.id)
    return QualityOverviewResponse(
        repositories=[RepositoryQuality.model_validate(row) for row in rows]
    )
