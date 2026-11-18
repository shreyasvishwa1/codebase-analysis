"""Everything a run's PDF report shows, gathered from the stored run (summaries and result
tables) into plain values, so the PDF builder is a pure function. Lists are bounded; each
section records how many items exist in total, so the report can say when it shows only the
most important ones."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import health
from app.models import (
    AnalysisRun,
    ArchitectureReport,
    CodeIssue,
    ComplexityFile,
    ComplexityFunction,
    DependencyRecord,
    SecurityFinding,
)

TOP_FINDINGS = 30
TOP_ISSUES = 25
TOP_FUNCTIONS = 15
POOR_FILES = 15
TOP_DEPENDENCIES = 25
TOP_CYCLES = 10

_SECURITY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3}, value=SecurityFinding.severity, else_=4
)
_QUALITY_ORDER = case(
    {"high": 0, "medium": 1, "low": 2, "info": 3}, value=CodeIssue.severity, else_=4
)
_DEPENDENCY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4},
    value=DependencyRecord.max_severity,
    else_=5,
)


@dataclass
class ReportData:
    repository: str
    project: str
    run_id: uuid.UUID
    analyzed_at: datetime
    generated_at: datetime
    file_count: int
    analyzed_file_count: int
    excluded_file_count: int
    total_lines: int
    code_lines: int
    languages: list[dict[str, Any]]
    health: dict[str, Any] | None = None
    security: dict[str, Any] | None = None
    findings: list[dict[str, Any]] = field(default_factory=list)
    quality: dict[str, Any] | None = None
    issues: list[dict[str, Any]] = field(default_factory=list)
    complexity: dict[str, Any] | None = None
    functions: list[dict[str, Any]] = field(default_factory=list)
    poor_files: list[dict[str, Any]] = field(default_factory=list)
    dependencies: dict[str, Any] | None = None
    vulnerable: list[dict[str, Any]] = field(default_factory=list)
    outdated: list[dict[str, Any]] = field(default_factory=list)
    architecture: dict[str, Any] | None = None
    document: dict[str, Any] | None = None


def _health(
    run: AnalysisRun, document: dict[str, Any] | None, weights: dict[str, int]
) -> dict[str, Any] | None:
    if run.quality is None:  # runs stored before the analyses the score uses
        return None
    dimensions = health.dimensions(run, document if health.needs_report(run) else None)
    overall = health.overall({d.key: d.score for d in dimensions}, weights)
    return {
        "overall": overall,
        "grade": health.grade(overall),
        "dimensions": [d.as_dict() | {"weight": weights[d.key]} for d in dimensions],
    }


async def gather(
    db: AsyncSession,
    run: AnalysisRun,
    repository_name: str,
    project_name: str,
    weights: dict[str, int],
    generated_at: datetime,
) -> ReportData:
    document = await db.scalar(
        select(ArchitectureReport.document).where(ArchitectureReport.run_id == run.id)
    )
    data = ReportData(
        repository=repository_name,
        project=project_name,
        run_id=run.id,
        analyzed_at=run.created_at,
        generated_at=generated_at,
        file_count=run.file_count,
        analyzed_file_count=run.analyzed_file_count,
        excluded_file_count=run.excluded_file_count,
        total_lines=run.total_lines,
        code_lines=run.code_lines,
        languages=list(run.languages or []),
        health=_health(run, document, weights),
        security=run.security,
        quality=run.quality,
        complexity=run.complexity,
        dependencies=run.dependencies,
        architecture=run.architecture,
        document=document,
    )
    if run.security is not None:
        rows = await db.execute(
            select(
                SecurityFinding.severity,
                SecurityFinding.confidence,
                SecurityFinding.title,
                SecurityFinding.owasp,
                SecurityFinding.cwe,
                SecurityFinding.path,
                SecurityFinding.line,
                SecurityFinding.recommendation,
            )
            .where(SecurityFinding.run_id == run.id)
            .order_by(
                _SECURITY_ORDER,
                SecurityFinding.confidence,
                SecurityFinding.path,
                SecurityFinding.line,
            )
            .limit(TOP_FINDINGS)
        )
        data.findings = [dict(row._mapping) for row in rows]
    if run.quality is not None:
        rows = await db.execute(
            select(
                CodeIssue.severity,
                CodeIssue.category,
                CodeIssue.rule_id,
                CodeIssue.path,
                CodeIssue.line,
                CodeIssue.message,
            )
            .where(CodeIssue.run_id == run.id)
            .order_by(_QUALITY_ORDER, CodeIssue.path, CodeIssue.line)
            .limit(TOP_ISSUES)
        )
        data.issues = [dict(row._mapping) for row in rows]
    if run.complexity is not None:
        rows = await db.execute(
            select(
                ComplexityFunction.name,
                ComplexityFunction.path,
                ComplexityFunction.line,
                ComplexityFunction.cyclomatic,
                ComplexityFunction.nloc,
                ComplexityFunction.rank,
            )
            .where(ComplexityFunction.run_id == run.id)
            .order_by(
                ComplexityFunction.cyclomatic.desc(),
                ComplexityFunction.path,
                ComplexityFunction.line,
            )
            .limit(TOP_FUNCTIONS)
        )
        data.functions = [dict(row._mapping) for row in rows]
        rows = await db.execute(
            select(ComplexityFile.path, ComplexityFile.maintainability_index, ComplexityFile.nloc)
            .where(ComplexityFile.run_id == run.id, ComplexityFile.maintainability == "poor")
            .order_by(ComplexityFile.maintainability_index, ComplexityFile.path)
            .limit(POOR_FILES)
        )
        data.poor_files = [dict(row._mapping) for row in rows]
    if run.dependencies is not None:
        columns = (
            DependencyRecord.name,
            DependencyRecord.ecosystem,
            DependencyRecord.manifest,
            DependencyRecord.line,
            DependencyRecord.specifier,
            DependencyRecord.version,
            DependencyRecord.latest_version,
            DependencyRecord.update,
            DependencyRecord.vulnerability_count,
            DependencyRecord.max_severity,
            DependencyRecord.vulnerabilities,
        )
        rows = await db.execute(
            select(*columns)
            .where(DependencyRecord.run_id == run.id, DependencyRecord.vulnerability_count > 0)
            .order_by(
                _DEPENDENCY_ORDER,
                DependencyRecord.vulnerability_count.desc(),
                DependencyRecord.name,
            )
            .limit(TOP_DEPENDENCIES)
        )
        data.vulnerable = [_dependency(row._mapping) for row in rows]
        rows = await db.execute(
            select(*columns)
            .where(DependencyRecord.run_id == run.id, DependencyRecord.update == "major")
            .order_by(DependencyRecord.name, DependencyRecord.manifest)
            .limit(TOP_DEPENDENCIES)
        )
        data.outdated = [_dependency(row._mapping) for row in rows]
    return data


def _dependency(row: Any) -> dict[str, Any]:
    record = dict(row)
    vulnerabilities = record.pop("vulnerabilities") or []
    record["fixed_in"] = next((v["fixed_in"] for v in vulnerabilities if v.get("fixed_in")), None)
    record["ids"] = [v["id"] for v in vulnerabilities][:3]
    return record


async def report_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    from app.models import GeneratedReport

    return int(
        await db.scalar(
            select(func.count())
            .select_from(GeneratedReport)
            .where(GeneratedReport.user_id == user_id)
        )
        or 0
    )
