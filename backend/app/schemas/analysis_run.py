import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import AnalysisJobStatus
from app.schemas.analysis_job import AnalysisJobResponse
from app.schemas.code_issue import QualitySummary


class LanguageBreakdown(BaseModel):
    language: str | None
    files: int
    lines: int
    code_lines: int
    bytes: int


class SkippedFiles(BaseModel):
    binary: int
    too_large: int
    unavailable: int
    generated: int


class AnalysisRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    analysis_job_id: uuid.UUID
    repository_id: uuid.UUID
    project_id: uuid.UUID
    file_count: int
    analyzed_file_count: int
    excluded_file_count: int
    total_bytes: int
    total_lines: int
    code_lines: int
    languages: list[LanguageBreakdown]
    skipped: SkippedFiles
    # None for runs stored before code-quality analysis existed.
    quality: QualitySummary | None
    created_at: datetime


class AnalysisRunListResponse(BaseModel):
    """The latest full-analysis job (any status) and the completed runs, newest first."""

    job: AnalysisJobResponse | None
    runs: list[AnalysisRunResponse]


class AnalysisRunJobResponse(BaseModel):
    job_id: uuid.UUID
    repository_id: uuid.UUID
    status: AnalysisJobStatus


class RecentRun(BaseModel):
    run_id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    created_at: datetime
    file_count: int
    code_lines: int
    top_language: str | None


class DashboardSummary(BaseModel):
    """Totals across the user's projects. Language totals and code size come from each
    repository's latest run."""

    projects: int
    repositories: int
    ready_repositories: int
    analyzed_repositories: int
    total_runs: int
    active_jobs: int
    analyzed_files: int
    code_lines: int
    languages: list[LanguageBreakdown]
    recent_runs: list[RecentRun]
