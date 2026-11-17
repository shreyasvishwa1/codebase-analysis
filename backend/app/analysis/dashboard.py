"""Cross-project totals for the Overview dashboard, computed from stored runs (never
estimated). Only the user's own projects are read."""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisRun,
    Project,
    Repository,
    RepositoryStatus,
)
from app.schemas.analysis_run import DashboardSummary, LanguageBreakdown, RecentRun

RECENT_RUNS = 8


async def dashboard_summary(db: AsyncSession, user_id: uuid.UUID) -> DashboardSummary:
    owned_projects = select(Project.id).where(Project.user_id == user_id)
    projects = await db.scalar(select(func.count()).select_from(owned_projects.subquery())) or 0
    repo_counts = (
        await db.execute(
            select(
                func.count(Repository.id),
                func.count(Repository.id).filter(Repository.status == RepositoryStatus.READY),
            ).where(Repository.project_id.in_(owned_projects))
        )
    ).one()
    total_runs = (
        await db.scalar(
            select(func.count(AnalysisRun.id)).where(AnalysisRun.project_id.in_(owned_projects))
        )
        or 0
    )
    active_jobs = (
        await db.scalar(
            select(func.count(AnalysisJob.id)).where(
                AnalysisJob.project_id.in_(owned_projects),
                AnalysisJob.status.in_((AnalysisJobStatus.PENDING, AnalysisJobStatus.PROCESSING)),
            )
        )
        or 0
    )

    # Each repository's latest run.
    latest = (
        select(AnalysisRun)
        .where(AnalysisRun.project_id.in_(owned_projects))
        .distinct(AnalysisRun.repository_id)
        .order_by(AnalysisRun.repository_id, AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    )
    latest_runs = list((await db.scalars(latest)).all())
    languages: dict[str | None, dict[str, Any]] = {}
    for run in latest_runs:
        for entry in run.languages:
            total = languages.setdefault(
                entry["language"],
                {
                    "language": entry["language"],
                    "files": 0,
                    "lines": 0,
                    "code_lines": 0,
                    "bytes": 0,
                },
            )
            for key in ("files", "lines", "code_lines", "bytes"):
                total[key] += int(entry[key])
    language_totals = sorted(
        languages.values(),
        key=lambda e: (-e["code_lines"], -e["files"], e["language"] is None, e["language"] or ""),
    )

    recent_rows = (
        await db.execute(
            select(AnalysisRun, Repository.name, Project.name)
            .join(Repository, Repository.id == AnalysisRun.repository_id)
            .join(Project, Project.id == AnalysisRun.project_id)
            .where(Project.user_id == user_id)
            .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
            .limit(RECENT_RUNS)
        )
    ).all()
    recent = [
        RecentRun(
            run_id=run.id,
            project_id=run.project_id,
            project_name=project_name,
            repository_id=run.repository_id,
            repository_name=repository_name,
            created_at=run.created_at,
            file_count=run.file_count,
            code_lines=run.code_lines,
            top_language=run.languages[0]["language"] if run.languages else None,
        )
        for run, repository_name, project_name in recent_rows
    ]
    return DashboardSummary(
        projects=projects,
        repositories=repo_counts[0],
        ready_repositories=repo_counts[1],
        analyzed_repositories=len(latest_runs),
        total_runs=total_runs,
        active_jobs=active_jobs,
        analyzed_files=sum(run.analyzed_file_count for run in latest_runs),
        code_lines=sum(run.code_lines for run in latest_runs),
        languages=[LanguageBreakdown.model_validate(entry) for entry in language_totals],
        recent_runs=recent,
    )
