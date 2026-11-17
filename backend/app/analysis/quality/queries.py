"""Reading stored code-quality results: a run's issues (filtered, paged) and the latest
results of each of a user's repositories."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.results import escape_like, latest_runs_with, run_entry
from app.models import CodeIssue

MAX_PAGE_SIZE = 200
MAX_QUERY_CHARS = 200

_SEVERITY_ORDER = case(
    {"high": 0, "medium": 1, "low": 2, "info": 3}, value=CodeIssue.severity, else_=4
)


@dataclass(frozen=True)
class IssueFilters:
    severity: str | None = None
    category: str | None = None
    path: str | None = None  # exact file path
    query: str | None = None  # case-insensitive text in the message, path or rule


async def list_issues(
    db: AsyncSession, run_id: uuid.UUID, filters: IssueFilters, page: int, page_size: int
) -> tuple[list[CodeIssue], int]:
    conditions: list[Any] = [CodeIssue.run_id == run_id]
    if filters.severity:
        conditions.append(CodeIssue.severity == filters.severity)
    if filters.category:
        conditions.append(CodeIssue.category == filters.category)
    if filters.path:
        conditions.append(CodeIssue.path == filters.path)
    if filters.query:
        pattern = f"%{escape_like(filters.query[:MAX_QUERY_CHARS])}%"
        conditions.append(
            or_(
                CodeIssue.message.ilike(pattern, escape="\\"),
                CodeIssue.path.ilike(pattern, escape="\\"),
                CodeIssue.rule_id.ilike(pattern, escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(CodeIssue).where(*conditions))
    result = await db.scalars(
        select(CodeIssue)
        .where(*conditions)
        .order_by(_SEVERITY_ORDER, CodeIssue.path, CodeIssue.line, CodeIssue.rule_id, CodeIssue.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.all()), int(total or 0)


async def quality_overview(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Each of the user's repositories whose latest run has quality results, newest first."""
    return [
        {**run_entry(run, project, repository), "quality": run.quality}
        for run, project, repository in await latest_runs_with(db, user_id, "quality")
    ]
