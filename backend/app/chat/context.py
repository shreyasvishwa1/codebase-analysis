"""The analysis results given to the model with every question: a compact text summary of
the run (languages, health score, the most severe security findings, code quality, the most
complex functions, vulnerable dependencies and the architecture), each finding with its
file and line. Every number comes from the stored run; secrets are never included (findings
carry only the rule and location)."""

from typing import Any

from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import health
from app.models import AnalysisRun, DependencyRecord, SecurityFinding

TOP_FINDINGS = 10
TOP_FUNCTIONS = 5
TOP_DEPENDENCIES = 10
MAX_LIST = 12

_SEVERITY_ORDER = case(
    {"critical": 0, "high": 1, "medium": 2, "low": 3}, value=SecurityFinding.severity, else_=4
)


def _n(value: Any) -> str:
    return f"{value:,}" if isinstance(value, int) else str(value)


def _counts(counts: dict[str, Any]) -> str:
    return ", ".join(
        f"{key.replace('_', ' ')} {_n(value)}" for key, value in counts.items() if value
    )


def _listed(items: list[str]) -> str:
    shown = ", ".join(items[:MAX_LIST])
    return shown + (f" and {len(items) - MAX_LIST} more" if len(items) > MAX_LIST else "")


async def analysis_context(
    db: AsyncSession, run: AnalysisRun, repository_name: str, weights: dict[str, int]
) -> str:
    lines = [
        f"Repository: {repository_name}. Full analysis of {run.created_at:%Y-%m-%d %H:%M} UTC:"
        f" {_n(run.analyzed_file_count)} files analyzed, {_n(run.code_lines)} lines of code.",
    ]
    total = max(1, run.code_lines)
    languages = [
        f"{entry['language'] or 'other'} {round(100 * entry['code_lines'] / total)}%"
        for entry in (run.languages or [])[:8]
        if 100 * entry["code_lines"] >= total  # at least 1%
    ]
    if languages:
        lines.append("Languages (share of code lines): " + ", ".join(languages) + ".")

    dimensions = health.dimensions(run)
    overall = health.overall({d.key: d.score for d in dimensions}, weights)
    if overall is not None:
        parts = ", ".join(
            f"{d.name} {d.score if d.score is not None else 'not scored'}" for d in dimensions
        )
        lines.append(f"Code health score: {overall}/100 (grade {health.grade(overall)}); {parts}.")

    if run.security is not None:
        security = run.security
        lines.append(
            f"Security: {_n(security['findings'])} findings ({_counts(security['by_severity'])})."
            " Static analysis reports only what it found; it cannot show that the code is secure."
        )
        findings = await db.execute(
            select(
                SecurityFinding.severity,
                SecurityFinding.confidence,
                SecurityFinding.title,
                SecurityFinding.path,
                SecurityFinding.line,
            )
            .where(SecurityFinding.run_id == run.id)
            .order_by(
                _SEVERITY_ORDER,
                SecurityFinding.confidence,
                SecurityFinding.path,
                SecurityFinding.line,
            )
            .limit(TOP_FINDINGS * 4)
        )
        # One line per finding and place (a package with several advisories is listed once).
        shown: dict[str, None] = {}
        for severity, confidence, title, path, line in findings.all():
            shown.setdefault(f"- {severity}, {confidence}: {title} at {path}:{line}", None)
        lines.extend(list(shown)[:TOP_FINDINGS])

    if run.quality is not None:
        quality = run.quality
        lines.append(
            f"Code quality: {_n(quality['issues'])} issues ({_counts(quality['by_severity'])});"
            f" {quality['duplication']['percent']}% of lines duplicated."
        )

    if run.complexity is not None:
        complexity = run.complexity
        lines.append(
            f"Complexity: {_n(complexity['functions'])} functions, average cyclomatic complexity"
            f" {complexity['average_cyclomatic']}; maintainability index"
            f" {complexity.get('maintainability_index')}."
        )
        for function in (complexity.get("top_functions") or [])[:TOP_FUNCTIONS]:
            lines.append(
                f"- {function['name']} (complexity {function['cyclomatic']}) at"
                f" {function['path']}:{function['line']}"
            )

    if run.dependencies is not None:
        dependencies = run.dependencies
        lines.append(
            f"Dependencies: {_n(dependencies['dependencies'])} declared,"
            f" {_n(dependencies['vulnerable_dependencies'])} with known vulnerabilities,"
            f" {_n(dependencies['updates']['major'])} a major version behind"
            f" (registry lookup: {dependencies['lookups']['registry']};"
            f" vulnerability lookup: {dependencies['lookups']['osv']})."
        )
        vulnerable = await db.execute(
            select(DependencyRecord)
            .where(DependencyRecord.run_id == run.id, DependencyRecord.vulnerability_count > 0)
            .order_by(DependencyRecord.vulnerability_count.desc(), DependencyRecord.name)
            .limit(TOP_DEPENDENCIES)
        )
        for record in vulnerable.scalars():
            fixed = next((v["fixed_in"] for v in record.vulnerabilities if v.get("fixed_in")), None)
            lines.append(
                f"- {record.name} {record.version or record.specifier}: {record.vulnerability_count}"
                f" vulnerabilities, worst {record.max_severity}"
                + (f", fixed in {fixed}" if fixed else "")
                + f" ({record.manifest}:{record.line or 1})"
            )

    if run.architecture is not None:
        architecture = run.architecture
        lines.append(
            f"Architecture: {_n(architecture['components'])} components,"
            f" {_n(architecture['routes'])} API routes, {_n(architecture['entry_points'])} entry"
            f" points, {_n(architecture['cycles'])} dependency cycles."
            + (
                f" Technologies: {_listed(architecture['technologies'])}."
                if architecture["technologies"]
                else ""
            )
            + (
                f" Data stores: {_listed(architecture['data_stores'])}."
                if architecture["data_stores"]
                else ""
            )
        )
    return "\n".join(lines)
