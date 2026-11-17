import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Severity = Literal["high", "medium", "low", "info"]
Category = Literal[
    "syntax_error",
    "bug_risk",
    "unused_code",
    "dead_code",
    "duplication",
    "naming",
    "documentation",
    "formatting",
    "maintainability",
]


class SeverityCounts(BaseModel):
    high: int
    medium: int
    low: int
    info: int


class CategoryCounts(BaseModel):
    syntax_error: int
    bug_risk: int
    unused_code: int
    dead_code: int
    duplication: int
    naming: int
    documentation: int
    formatting: int
    maintainability: int


class DuplicationSummary(BaseModel):
    percent: float
    duplicated_lines: int
    significant_lines: int
    files: int
    blocks: int
    partial: bool


class FileIssueCount(BaseModel):
    path: str
    issues: int
    high: int
    medium: int
    low: int
    info: int


class RuleCount(BaseModel):
    rule_id: str
    count: int
    category: Category
    severity: Severity


class QualitySummary(BaseModel):
    """Code-quality totals of a run. ``issues`` counts every finding; the most severe
    ``stored_issues`` of them are stored and listed. ``ruff`` is the Ruff run's status
    ("completed", "skipped" when there are no Python files, or why it did not complete)."""

    files_analyzed: int
    python_files: int
    ruff: str
    issues: int
    stored_issues: int
    by_severity: SeverityCounts
    by_category: CategoryCounts
    duplication: DuplicationSummary
    top_files: list[FileIssueCount]
    top_rules: list[RuleCount]


class CodeIssueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    path: str
    line: int
    column: int | None
    end_line: int
    tool: str
    rule_id: str
    category: Category
    severity: Severity
    message: str
    explanation: str
    suggestion: str
    doc_url: str | None


class CodeIssueListResponse(BaseModel):
    """One page of a run's stored issues matching the filters, most severe first."""

    items: list[CodeIssueResponse]
    total: int
    page: int
    page_size: int


class RepositoryQuality(BaseModel):
    """A repository's latest run with code-quality results (Code Analysis overview)."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    analyzed_file_count: int
    code_lines: int
    quality: QualitySummary


class QualityOverviewResponse(BaseModel):
    repositories: list[RepositoryQuality]
