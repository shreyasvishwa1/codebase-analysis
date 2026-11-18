import uuid
from datetime import datetime

from pydantic import BaseModel


class ReportResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    run_created_at: datetime  # the analysis the report describes
    filename: str
    size_bytes: int
    sha256: str
    pages: int
    created_at: datetime


class ReportListResponse(BaseModel):
    reports: list[ReportResponse]  # newest first


class HistoryEntry(BaseModel):
    """One analysis run with its headline numbers (the analysis history)."""

    run_id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    created_at: datetime
    analyzed_file_count: int
    code_lines: int
    overall: int | None  # health score, with the user's weights
    grade: str | None
    security_findings: int | None  # None: the run predates the analysis
    critical_findings: int | None
    high_findings: int | None
    quality_issues: int | None
    complex_functions: int | None  # cyclomatic complexity above 20
    vulnerable_dependencies: int | None
    chat_ready: bool
    reports: int  # the user's saved reports of this run


class AnalysisHistoryResponse(BaseModel):
    entries: list[HistoryEntry]  # newest first
    total: int  # runs matching the filter (entries holds at most ``limit``)
