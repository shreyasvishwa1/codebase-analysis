import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

SecuritySeverity = Literal["critical", "high", "medium", "low"]
Confidence = Literal["confirmed", "potential"]
OwaspCategory = Literal["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10"]


class SecuritySeverityCounts(BaseModel):
    critical: int
    high: int
    medium: int
    low: int


class ConfidenceCounts(BaseModel):
    confirmed: int
    potential: int


class OwaspCounts(BaseModel):
    A01: int
    A02: int
    A03: int
    A04: int
    A05: int
    A06: int
    A07: int
    A08: int
    A09: int
    A10: int


class FileFindingCount(BaseModel):
    path: str
    findings: int
    critical: int
    high: int
    medium: int
    low: int


class SecurityRuleCount(BaseModel):
    rule_id: str
    count: int
    title: str
    severity: SecuritySeverity


class SecuritySummary(BaseModel):
    """Security totals of a run. ``findings`` counts every finding; the most severe
    ``stored_findings`` are stored and listed. ``bandit`` is the Bandit run's status
    ("completed", "skipped" when there are no Python files, or why it did not complete).
    No findings never means that a project is secure, only that these checks found nothing."""

    files_scanned: int
    python_files: int
    bandit: str
    findings: int
    stored_findings: int
    by_severity: SecuritySeverityCounts
    by_confidence: ConfidenceCounts
    by_owasp: OwaspCounts
    top_files: list[FileFindingCount]
    top_rules: list[SecurityRuleCount]


class SecurityFindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    path: str
    line: int
    end_line: int
    tool: str
    rule_id: str
    title: str
    owasp: OwaspCategory
    cwe: int | None
    severity: SecuritySeverity
    confidence: Confidence
    message: str
    explanation: str
    recommendation: str
    doc_url: str | None


class SecurityFindingListResponse(BaseModel):
    """One page of a run's stored findings matching the filters, most severe first."""

    items: list[SecurityFindingResponse]
    total: int
    page: int
    page_size: int


class RepositorySecurity(BaseModel):
    """A repository's latest run with security results (Security overview)."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    analyzed_file_count: int
    security: SecuritySummary


class SecurityOverviewResponse(BaseModel):
    repositories: list[RepositorySecurity]
