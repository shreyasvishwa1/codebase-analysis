import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.runner import AnalysisRunError, get_run
from app.analysis.security.queries import (
    MAX_PAGE_SIZE,
    MAX_QUERY_CHARS,
    FindingFilters,
    list_findings,
    security_overview,
)
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import User
from app.schemas.security_finding import (
    Confidence,
    OwaspCategory,
    RepositorySecurity,
    SecurityFindingListResponse,
    SecurityFindingResponse,
    SecurityOverviewResponse,
    SecuritySeverity,
)

# A run's security findings. Every route requires an authenticated user and goes through the
# existing ownership lookup (404 for other users' repositories and runs).
router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}"
    "/security-findings",
    tags=["security"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/security", tags=["security"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=SecurityFindingListResponse)
async def list_run_security_findings(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    severity: SecuritySeverity | None = None,
    confidence: Confidence | None = None,
    owasp: OwaspCategory | None = None,
    path: Annotated[str | None, Query(max_length=1024)] = None,
    q: Annotated[str | None, Query(max_length=MAX_QUERY_CHARS)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
) -> SecurityFindingListResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    filters = FindingFilters(
        severity=severity,
        confidence=confidence,
        owasp=owasp,
        path=path or None,
        query=(q or "").strip() or None,
    )
    findings, total = await list_findings(db, run.id, filters, page, page_size)
    return SecurityFindingListResponse(
        items=[SecurityFindingResponse.model_validate(finding) for finding in findings],
        total=total,
        page=page,
        page_size=page_size,
    )


@overview_router.get("", response_model=SecurityOverviewResponse)
async def get_security_overview(db: DbSession, user: CurrentUser) -> SecurityOverviewResponse:
    rows = await security_overview(db, user.id)
    return SecurityOverviewResponse(
        repositories=[RepositorySecurity.model_validate(row) for row in rows]
    )
