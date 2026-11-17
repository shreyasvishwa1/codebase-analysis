"""Helpers shared by the readers of stored run results (code quality, security, ...)."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnalysisRun, Project, Repository


def escape_like(text: str) -> str:
    """``text`` with LIKE wildcards escaped (use with ``escape="\\\\"``)."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def latest_runs_with(
    db: AsyncSession, user_id: uuid.UUID, summary: str
) -> list[tuple[AnalysisRun, str, str]]:
    """(run, project name, repository name) for each of the user's repositories whose latest
    run has the ``summary`` column (for example "quality"), newest run first. A repository
    whose latest run predates that analysis is not listed."""
    column = getattr(AnalysisRun, summary)
    latest = (
        select(AnalysisRun.id)
        .join(Project, Project.id == AnalysisRun.project_id)
        .where(Project.user_id == user_id)
        .distinct(AnalysisRun.repository_id)
        .order_by(AnalysisRun.repository_id, AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    ).subquery()
    rows = await db.execute(
        select(AnalysisRun, Project.name, Repository.name)
        .join(latest, latest.c.id == AnalysisRun.id)
        .join(Project, Project.id == AnalysisRun.project_id)
        .join(Repository, Repository.id == AnalysisRun.repository_id)
        .where(column.is_not(None))
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    )
    return [(run, project, repository) for run, project, repository in rows.all()]


def run_entry(run: AnalysisRun, project_name: str, repository_name: str) -> dict[str, Any]:
    return {
        "project_id": run.project_id,
        "project_name": project_name,
        "repository_id": run.repository_id,
        "repository_name": repository_name,
        "run_id": run.id,
        "created_at": run.created_at,
        "analyzed_file_count": run.analyzed_file_count,
        "code_lines": run.code_lines,
    }
