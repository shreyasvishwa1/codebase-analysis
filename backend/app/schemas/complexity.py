import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

ComplexityRank = Literal["low", "medium", "high"]
Maintainability = Literal["good", "moderate", "poor"]
FileSort = Literal["complexity", "maintainability", "size", "path"]


class RankCounts(BaseModel):
    low: int
    medium: int
    high: int


class MaintainabilityCounts(BaseModel):
    good: int
    moderate: int
    poor: int


class SkippedCounts(BaseModel):
    too_large: int
    unparsable: int


class LanguageFiles(BaseModel):
    language: str
    files: int


class TopFunction(BaseModel):
    path: str
    name: str
    line: int
    cyclomatic: int
    nloc: int
    rank: ComplexityRank


class ComplexitySummary(BaseModel):
    """Complexity totals of a run. Cyclomatic complexity: 1-10 low, 11-20 medium, 21+ high.
    Maintainability index (0-100): 20+ good, 10-19 moderate, below 10 poor; the repository's
    value is the mean over its files. ``mi_estimated_files`` were measured from Lizard's tokens
    instead of by Radon (languages other than Python)."""

    files_measured: int
    files_skipped: SkippedCounts
    languages: list[LanguageFiles]
    nloc: int
    functions: int
    classes: int
    total_cyclomatic: int
    average_cyclomatic: float
    max_cyclomatic: int
    functions_by_rank: RankCounts
    files_by_rank: RankCounts
    maintainability_index: float | None
    maintainability: Maintainability | None
    files_by_maintainability: MaintainabilityCounts
    mi_estimated_files: int
    stored_files: int
    stored_functions: int
    top_functions: list[TopFunction]


class ComplexityFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    path: str
    language: str
    nloc: int
    functions: int
    classes: int
    total_cyclomatic: int
    max_cyclomatic: int
    average_cyclomatic: float
    rank: ComplexityRank
    maintainability_index: float | None
    maintainability: Maintainability | None
    mi_estimated: bool


class ComplexityFunctionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    path: str
    name: str
    line: int
    end_line: int
    cyclomatic: int
    nloc: int
    parameters: int
    rank: ComplexityRank


class ComplexityFileListResponse(BaseModel):
    items: list[ComplexityFileResponse]
    total: int
    page: int
    page_size: int


class ComplexityFunctionListResponse(BaseModel):
    """The most complex stored functions matching the filters, most complex first."""

    items: list[ComplexityFunctionResponse]
    total: int
    page: int
    page_size: int


class RepositoryComplexity(BaseModel):
    """A repository's latest run with complexity results (Complexity overview)."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    analyzed_file_count: int
    code_lines: int
    complexity: ComplexitySummary


class ComplexityOverviewResponse(BaseModel):
    repositories: list[RepositoryComplexity]
