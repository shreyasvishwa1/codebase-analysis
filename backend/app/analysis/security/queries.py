"""Reading stored security results: a run's findings (filtered, paged) and the latest results
of each of a user's repositories."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.results import escape_like, latest_runs_with, run_entry
from app.models import SecurityFinding

MAX_PAGE_SIZE = 200
MAX_QUERY_CHARS = 200

_SEVERITY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3}, value=SecurityFinding.severity, else_=4
)
_CONFIDENCE_ORDER = case({"confirmed": 0}, value=SecurityFinding.confidence, else_=1)


@dataclass(frozen=True)
class FindingFilters:
    severity: str | None = None
    confidence: str | None = None
    owasp: str | None = None
    path: str | None = None  # exact file path
    query: str | None = None  # case-insensitive text in the title, message, path or rule


async def list_findings(
    db: AsyncSession, run_id: uuid.UUID, filters: FindingFilters, page: int, page_size: int
) -> tuple[list[SecurityFinding], int]:
    conditions: list[Any] = [SecurityFinding.run_id == run_id]
    if filters.severity:
        conditions.append(SecurityFinding.severity == filters.severity)
    if filters.confidence:
        conditions.append(SecurityFinding.confidence == filters.confidence)
    if filters.owasp:
        conditions.append(SecurityFinding.owasp == filters.owasp)
    if filters.path:
        conditions.append(SecurityFinding.path == filters.path)
    if filters.query:
        pattern = f"%{escape_like(filters.query[:MAX_QUERY_CHARS])}%"
        conditions.append(
            or_(
                SecurityFinding.title.ilike(pattern, escape="\\"),
                SecurityFinding.message.ilike(pattern, escape="\\"),
                SecurityFinding.path.ilike(pattern, escape="\\"),
                SecurityFinding.rule_id.ilike(pattern, escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(SecurityFinding).where(*conditions))
    result = await db.scalars(
        select(SecurityFinding)
        .where(*conditions)
        .order_by(
            _SEVERITY_ORDER,
            _CONFIDENCE_ORDER,
            SecurityFinding.path,
            SecurityFinding.line,
            SecurityFinding.rule_id,
            SecurityFinding.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.all()), int(total or 0)


async def security_overview(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Each of the user's repositories whose latest run has security results, newest first."""
    return [
        {**run_entry(run, project, repository), "security": run.security}
        for run, project, repository in await latest_runs_with(db, user_id, "security")
    ]
