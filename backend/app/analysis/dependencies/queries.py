"""Reading stored dependency results: a run's dependencies (filtered, sorted, paged) and the
latest results of each of a user's repositories."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.results import escape_like, latest_runs_with, run_entry
from app.models import DependencyRecord

MAX_PAGE_SIZE = 200
MAX_QUERY_CHARS = 200

_SEVERITY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4},
    value=DependencyRecord.max_severity,
    else_=5,
)
_UPDATE_ORDER = case(
    {"major": 0, "minor": 1, "patch": 2, "unknown": 3, "up_to_date": 4},
    value=DependencyRecord.update,
    else_=5,
)
_ORDER: dict[str, tuple[Any, ...]] = {
    # Most severe vulnerability first, then the most vulnerabilities, then the most outdated.
    "risk": (_SEVERITY_ORDER, DependencyRecord.vulnerability_count.desc(), _UPDATE_ORDER),
    "update": (_UPDATE_ORDER,),
    "name": (),
}


@dataclass(frozen=True)
class DependencyFilters:
    ecosystem: str | None = None
    scope: str | None = None  # runtime, dev or other
    update: str | None = None
    vulnerable: bool | None = None
    conflict: bool | None = None
    query: str | None = None  # case-insensitive text in the name or manifest path
    sort: str = "risk"


async def list_dependencies(
    db: AsyncSession, run_id: uuid.UUID, filters: DependencyFilters, page: int, page_size: int
) -> tuple[list[DependencyRecord], int]:
    conditions: list[Any] = [DependencyRecord.run_id == run_id]
    if filters.ecosystem:
        conditions.append(DependencyRecord.ecosystem == filters.ecosystem)
    if filters.scope == "other":
        conditions.append(DependencyRecord.scope.not_in(("runtime", "dev")))
    elif filters.scope:
        conditions.append(DependencyRecord.scope == filters.scope)
    if filters.update:
        conditions.append(DependencyRecord.update == filters.update)
    if filters.vulnerable is not None:
        count = DependencyRecord.vulnerability_count
        conditions.append(count > 0 if filters.vulnerable else count == 0)
    if filters.conflict is not None:
        conditions.append(DependencyRecord.conflict.is_(filters.conflict))
    if filters.query:
        pattern = f"%{escape_like(filters.query[:MAX_QUERY_CHARS])}%"
        conditions.append(
            or_(
                DependencyRecord.name.ilike(pattern, escape="\\"),
                DependencyRecord.manifest.ilike(pattern, escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(DependencyRecord).where(*conditions))
    result = await db.scalars(
        select(DependencyRecord)
        .where(*conditions)
        .order_by(
            *_ORDER[filters.sort],
            func.lower(DependencyRecord.name),
            DependencyRecord.manifest,
            DependencyRecord.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.all()), int(total or 0)


async def dependency_overview(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Each of the user's repositories whose latest run has dependency results, newest first."""
    return [
        {**run_entry(run, project, repository), "dependencies": run.dependencies}
        for run, project, repository in await latest_runs_with(db, user_id, "dependencies")
    ]
