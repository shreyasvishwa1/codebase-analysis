"""Reading stored complexity results: a run's files and functions (filtered, sorted, paged) and
the latest results of each of a user's repositories."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.results import escape_like, latest_runs_with, run_entry
from app.models import ComplexityFile, ComplexityFunction

MAX_PAGE_SIZE = 200
MAX_QUERY_CHARS = 200

_FILE_ORDER: dict[str, tuple[Any, ...]] = {
    "complexity": (ComplexityFile.max_cyclomatic.desc(), ComplexityFile.nloc.desc()),
    # Least maintainable first; files without an index last.
    "maintainability": (ComplexityFile.maintainability_index.asc().nulls_last(),),
    "size": (ComplexityFile.nloc.desc(),),
    "path": (),
}


@dataclass(frozen=True)
class FileFilters:
    rank: str | None = None
    maintainability: str | None = None
    query: str | None = None  # case-insensitive text in the path
    sort: str = "complexity"


@dataclass(frozen=True)
class FunctionFilters:
    rank: str | None = None
    path: str | None = None  # exact file path
    query: str | None = None  # case-insensitive text in the function name or path


def _like(text: str) -> str:
    return f"%{escape_like(text[:MAX_QUERY_CHARS])}%"


async def list_files(
    db: AsyncSession, run_id: uuid.UUID, filters: FileFilters, page: int, page_size: int
) -> tuple[list[ComplexityFile], int]:
    conditions: list[Any] = [ComplexityFile.run_id == run_id]
    if filters.rank:
        conditions.append(ComplexityFile.rank == filters.rank)
    if filters.maintainability:
        conditions.append(ComplexityFile.maintainability == filters.maintainability)
    if filters.query:
        conditions.append(ComplexityFile.path.ilike(_like(filters.query), escape="\\"))
    total = await db.scalar(select(func.count()).select_from(ComplexityFile).where(*conditions))
    result = await db.scalars(
        select(ComplexityFile)
        .where(*conditions)
        .order_by(*_FILE_ORDER[filters.sort], ComplexityFile.path, ComplexityFile.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.all()), int(total or 0)


async def list_functions(
    db: AsyncSession, run_id: uuid.UUID, filters: FunctionFilters, page: int, page_size: int
) -> tuple[list[ComplexityFunction], int]:
    conditions: list[Any] = [ComplexityFunction.run_id == run_id]
    if filters.rank:
        conditions.append(ComplexityFunction.rank == filters.rank)
    if filters.path:
        conditions.append(ComplexityFunction.path == filters.path)
    if filters.query:
        pattern = _like(filters.query)
        conditions.append(
            or_(
                ComplexityFunction.name.ilike(pattern, escape="\\"),
                ComplexityFunction.path.ilike(pattern, escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(ComplexityFunction).where(*conditions))
    result = await db.scalars(
        select(ComplexityFunction)
        .where(*conditions)
        .order_by(
            ComplexityFunction.cyclomatic.desc(),
            ComplexityFunction.path,
            ComplexityFunction.line,
            ComplexityFunction.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.all()), int(total or 0)


async def complexity_overview(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Each of the user's repositories whose latest run has complexity results, newest first."""
    return [
        {**run_entry(run, project, repository), "complexity": run.complexity}
        for run, project, repository in await latest_runs_with(db, user_id, "complexity")
    ]
