import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Ecosystem = Literal["npm", "python"]
VersionSource = Literal["pinned", "minimum", "none"]
Update = Literal["up_to_date", "patch", "minor", "major", "unknown"]
VulnerabilitySeverity = Literal["critical", "high", "medium", "low", "unknown"]
ScopeFilter = Literal["runtime", "dev", "other"]
DependencySort = Literal["risk", "name", "update"]
LookupStatus = Literal["completed", "partial", "failed", "disabled", "skipped"]


class Vulnerability(BaseModel):
    id: str
    aliases: list[str]
    summary: str
    severity: VulnerabilitySeverity
    score: float | None  # CVSS v3 base score, when published
    fixed_in: str | None  # the lowest fixed version newer than the checked one
    cwe: int | None
    url: str


class DependencyRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    manifest: str
    ecosystem: Ecosystem
    name: str
    specifier: str
    scope: str
    line: int | None
    version: str | None
    version_source: VersionSource
    latest_version: str | None
    update: Update
    vulnerability_count: int
    max_severity: VulnerabilitySeverity | None
    vulnerabilities: list[Vulnerability]
    conflict: bool


class DependencyRecordListResponse(BaseModel):
    items: list[DependencyRecordResponse]
    total: int
    page: int
    page_size: int


class ManifestCounts(BaseModel):
    total: int
    parsed: int
    invalid: int
    unreadable: int


class EcosystemCounts(BaseModel):
    python: int
    npm: int


class ScopeCounts(BaseModel):
    runtime: int
    dev: int
    other: int


class VersionSourceCounts(BaseModel):
    pinned: int
    minimum: int
    none: int


class UpdateCounts(BaseModel):
    up_to_date: int
    patch: int
    minor: int
    major: int
    unknown: int


class VulnerabilitySeverityCounts(BaseModel):
    critical: int
    high: int
    medium: int
    low: int
    unknown: int


class ConflictDeclaration(BaseModel):
    manifest: str
    specifier: str


class Conflict(BaseModel):
    ecosystem: Ecosystem
    name: str
    declarations: list[ConflictDeclaration]


class Lookups(BaseModel):
    registry: LookupStatus  # latest versions from PyPI and npm
    osv: LookupStatus  # vulnerabilities from OSV.dev
    checked_at: datetime | None


class DependencySummary(BaseModel):
    """Dependency totals of a run. ``updates`` compares the checked version with the latest
    release; vulnerabilities are those OSV.dev published for the checked versions when the
    run was analyzed."""

    manifests: ManifestCounts
    dependencies: int
    truncated: bool
    by_ecosystem: EcosystemCounts
    by_scope: ScopeCounts
    by_version_source: VersionSourceCounts
    updates: UpdateCounts
    vulnerable_dependencies: int
    # Absent in runs stored before the health score (phase 7).
    vulnerable_by_max_severity: VulnerabilitySeverityCounts | None = None
    vulnerabilities: int
    by_severity: VulnerabilitySeverityCounts
    conflicts: list[Conflict]
    lookups: Lookups


class RepositoryDependencies(BaseModel):
    """A repository's latest run with dependency results (Dependencies overview)."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    analyzed_file_count: int
    code_lines: int
    dependencies: DependencySummary


class DependencyOverviewResponse(BaseModel):
    repositories: list[RepositoryDependencies]
