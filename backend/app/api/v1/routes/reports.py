"""PDF reports of analysis runs and the analysis history.

A report is generated on request from the stored run (``app.reports``), kept in the
database for its user and downloaded again later. Reports and history are always scoped to
the signed-in user's own repositories."""

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.analysis import health
from app.analysis.runner import AnalysisRunError, get_run
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.health_score import _report_documents, weights_of
from app.api.v1.routes.repositories import _get_owned_repository
from app.database import get_db
from app.models import AnalysisRun, GeneratedReport, Project, Repository, User
from app.reports.data import gather, report_count
from app.reports.pdf import build_pdf
from app.schemas.report import (
    AnalysisHistoryResponse,
    HistoryEntry,
    ReportListResponse,
    ReportResponse,
)
from app.services.rate_limit import Limit, RateLimit

REPORT_LIMIT = Limit("report-user", 10, 3600)  # reports per user per hour
MAX_REPORTS = 100  # saved reports per user
REPORT_NOT_FOUND = "Report not found"
TOO_MANY_REPORTS = f"You have {MAX_REPORTS} saved reports; delete some before creating more"
HISTORY_LIMIT = 200

run_router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/analysis-runs/{run_id}",
    tags=["reports"],
    dependencies=[Depends(get_current_user)],
)
router = APIRouter(tags=["reports"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def filename_of(repository_name: str, analyzed_at: datetime) -> str:
    """An ASCII file name: the repository name reduced to [a-z0-9-] and the analysis time."""
    slug = re.sub(r"[^a-z0-9]+", "-", repository_name.lower()).strip("-")[:60] or "repository"
    return f"{slug}-report-{analyzed_at:%Y%m%d-%H%M}.pdf"


def _report_query() -> Any:
    return (
        select(GeneratedReport, AnalysisRun.created_at, Project.name, Repository.name)
        .join(AnalysisRun, AnalysisRun.id == GeneratedReport.run_id)
        .join(Project, Project.id == GeneratedReport.project_id)
        .join(Repository, Repository.id == GeneratedReport.repository_id)
    )


def _response(row: Any) -> ReportResponse:
    report, run_created_at, project_name, repository_name = row
    return ReportResponse(
        id=report.id,
        project_id=report.project_id,
        project_name=project_name,
        repository_id=report.repository_id,
        repository_name=repository_name,
        run_id=report.run_id,
        run_created_at=run_created_at,
        filename=report.filename,
        size_bytes=report.size_bytes,
        sha256=report.sha256,
        pages=report.pages,
        created_at=report.created_at,
    )


async def _owned_report(db: AsyncSession, user: User, report_id: uuid.UUID) -> GeneratedReport:
    report = await db.scalar(
        select(GeneratedReport).where(
            GeneratedReport.id == report_id, GeneratedReport.user_id == user.id
        )
    )
    if report is None:
        raise HTTPException(status_code=404, detail=REPORT_NOT_FOUND)
    return report


@run_router.post("/reports", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    limiter: RateLimit,
) -> ReportResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    try:
        run = await get_run(db, repository.id, run_id)
    except AnalysisRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    if await report_count(db, user.id) >= MAX_REPORTS:
        raise HTTPException(status_code=409, detail=TOO_MANY_REPORTS)
    await limiter.hit(REPORT_LIMIT, str(user.id))
    project = await db.get(Project, repository.project_id)
    assert project is not None  # the repository's project, just checked for ownership
    data = await gather(db, run, repository.name, project.name, weights_of(user), datetime.now(UTC))
    built = await run_in_threadpool(build_pdf, data)
    report = GeneratedReport(
        user_id=user.id,
        project_id=repository.project_id,
        repository_id=repository.id,
        run_id=run.id,
        filename=filename_of(repository.name, run.created_at),
        size_bytes=len(built.content),
        sha256=hashlib.sha256(built.content).hexdigest(),
        pages=built.pages,
        content=built.content,
        # The wall-clock time, so reports created within one transaction keep their order.
        created_at=func.clock_timestamp(),
    )
    db.add(report)
    await db.commit()
    row = (await db.execute(_report_query().where(GeneratedReport.id == report.id))).one()
    return _response(row)


@router.get("/reports", response_model=ReportListResponse)
async def list_reports(
    db: DbSession,
    user: CurrentUser,
    repository_id: Annotated[uuid.UUID | None, Query()] = None,
) -> ReportListResponse:
    query = _report_query().where(GeneratedReport.user_id == user.id)
    if repository_id is not None:
        query = query.where(GeneratedReport.repository_id == repository_id)
    rows = await db.execute(
        query.order_by(GeneratedReport.created_at.desc(), GeneratedReport.id).limit(MAX_REPORTS)
    )
    return ReportListResponse(reports=[_response(row) for row in rows.all()])


@router.get("/reports/{report_id}/download")
async def download_report(report_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    report = await _owned_report(db, user, report_id)
    content = (
        await db.scalar(select(GeneratedReport.content).where(GeneratedReport.id == report.id))
    ) or b""
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{report.filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(report_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    report = await _owned_report(db, user, report_id)
    await db.delete(report)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _count(summary: dict[str, Any] | None, *keys: str) -> int | None:
    value: Any = summary
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return int(value) if isinstance(value, int) else None


@router.get("/analysis-history", response_model=AnalysisHistoryResponse)
async def analysis_history(
    db: DbSession,
    user: CurrentUser,
    repository_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=HISTORY_LIMIT)] = 50,
) -> AnalysisHistoryResponse:
    owned = (
        select(AnalysisRun, Project.name, Repository.name)
        .join(Project, Project.id == AnalysisRun.project_id)
        .join(Repository, Repository.id == AnalysisRun.repository_id)
        .where(Project.user_id == user.id)
    )
    if repository_id is not None:
        owned = owned.where(AnalysisRun.repository_id == repository_id)
    total = await db.scalar(select(func.count()).select_from(owned.subquery()))
    rows = (
        await db.execute(
            owned.order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc()).limit(limit)
        )
    ).all()
    runs = [run for run, _, _ in rows]
    weights = weights_of(user)
    documents = await _report_documents(db, runs)
    report_rows = await db.execute(
        select(GeneratedReport.run_id, func.count())
        .where(
            GeneratedReport.user_id == user.id,
            GeneratedReport.run_id.in_([r.id for r in runs]),
        )
        .group_by(GeneratedReport.run_id)
    )
    counts: dict[uuid.UUID, int] = {run_id: count for run_id, count in report_rows.all()}
    entries = []
    for run, project_name, repository_name in rows:
        overall = None
        if run.quality is not None:
            dimensions = health.dimensions(run, documents.get(run.id))
            overall = health.overall({d.key: d.score for d in dimensions}, weights)
        entries.append(
            HistoryEntry(
                run_id=run.id,
                project_id=run.project_id,
                project_name=project_name,
                repository_id=run.repository_id,
                repository_name=repository_name,
                created_at=run.created_at,
                analyzed_file_count=run.analyzed_file_count,
                code_lines=run.code_lines,
                overall=overall,
                grade=health.grade(overall),
                security_findings=_count(run.security, "findings"),
                critical_findings=_count(run.security, "by_severity", "critical"),
                high_findings=_count(run.security, "by_severity", "high"),
                quality_issues=_count(run.quality, "issues"),
                complex_functions=_count(run.complexity, "functions_by_rank", "high"),
                vulnerable_dependencies=_count(run.dependencies, "vulnerable_dependencies"),
                chat_ready=run.chat_index is not None,
                reports=int(counts.get(run.id, 0)),
            )
        )
    return AnalysisHistoryResponse(entries=entries, total=int(total or 0))
