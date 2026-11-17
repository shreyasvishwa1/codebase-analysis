"""The dependency analyzer.

In the file pass, every manifest (``package.json``, ``pyproject.toml``, ``requirements*.txt``;
not in an excluded directory such as ``node_modules/``) is parsed with the existing
inventory parsers. Each declaration becomes a record with its ecosystem, scope, the line it
is on and the version it declares (pinned, a minimum, or none; see versions.py).

After the pass, ``check`` looks the packages up (latest versions on PyPI/npm, advisories on
OSV.dev) unless lookups are disabled, and ``summary`` describes the result. A package
declared with different specifiers (in one manifest or several, same ecosystem) is a
conflict. ``security_findings`` turns vulnerable declarations into security findings (OWASP
A06): confirmed for a pinned version, potential when only the lowest version a range allows
is affected.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from app.analysis.dependencies.lookups import Advisory, LookupResult, first_fix, look_up
from app.analysis.dependencies.versions import (
    normalize_name,
    npm_declared,
    python_declared,
    update_level,
)
from app.analysis.exclusions import excluded_directory
from app.analysis.security.analyzer import Finding
from app.analysis.summary import SnapshotFile
from app.services.dependencies import MAX_DEPENDENCIES, MAX_MANIFESTS, manifest_kind

SEVERITIES = ("critical", "high", "medium", "low", "unknown")
UPDATES = ("up_to_date", "patch", "minor", "major", "unknown")
MAX_CONFLICTS = 50
VULNERABLE_DEPENDENCY_CWE = 1395  # Dependency on Vulnerable Third-Party Component


@dataclass
class DeclaredDependency:
    manifest: str
    ecosystem: str  # npm or python
    name: str
    specifier: str
    scope: str  # runtime, dev, peer, optional or optional:<group>
    line: int | None
    version: str | None
    version_source: str  # pinned, minimum or none
    latest_version: str | None = None
    update: str = "unknown"
    vulnerabilities: list[dict[str, Any]] = field(default_factory=list)
    vulnerability_count: int = 0
    max_severity: str | None = None
    conflict: bool = False

    @property
    def key(self) -> tuple[str, str]:
        return self.ecosystem, normalize_name(self.ecosystem, self.name)


def _line_of(lines: list[str], name: str) -> int | None:
    token = re.compile(rf"(?<![A-Za-z0-9._@/-]){re.escape(name)}(?![A-Za-z0-9._-])", re.I)
    for number, line in enumerate(lines, start=1):
        if token.search(line):
            return number
    return None


class DependencyAnalyzer:
    def __init__(self) -> None:
        self.records: list[DeclaredDependency] = []
        self.manifests: Counter[str] = Counter()
        self.truncated = False
        self.lookups = LookupResult()
        self.checked_at: str | None = None

    def add(self, file: SnapshotFile) -> None:
        name = PurePosixPath(file.path).name
        kind = manifest_kind(name)
        if kind is None or excluded_directory(file.path) is not None:
            return
        if self.manifests.total() >= MAX_MANIFESTS:
            self.truncated = True
            return
        if file.status != "text" or file.text is None:
            self.manifests["unreadable"] += 1
            return
        try:
            entries = list(kind.parse(file.text))
        except (ValueError, RecursionError):  # JSON and TOML errors are ValueErrors
            self.manifests["invalid"] += 1
            return
        self.manifests["parsed"] += 1
        lines = file.text.splitlines()
        declared = python_declared if kind.ecosystem == "python" else npm_declared
        for scope, package, specifier in entries:
            if len(self.records) >= MAX_DEPENDENCIES:
                self.truncated = True
                return
            version = declared(specifier)
            self.records.append(
                DeclaredDependency(
                    manifest=file.path,
                    ecosystem=kind.ecosystem,
                    name=package,
                    specifier=specifier,
                    scope=scope,
                    line=_line_of(lines, package),
                    version=version.version,
                    version_source=version.source,
                )
            )

    def mark_conflicts(self) -> None:
        specifiers: dict[tuple[str, str], set[str]] = defaultdict(set)
        for record in self.records:
            specifiers[record.key].add(record.specifier)
        for record in self.records:
            record.conflict = len(specifiers[record.key]) > 1

    async def check(self, enabled: bool) -> None:
        """Look the declared packages up and fill in versions and vulnerabilities."""
        self.mark_conflicts()
        if not enabled:
            self.lookups = LookupResult(registry="disabled", osv="disabled")
            return
        if not self.records:
            return
        self.lookups = await look_up(
            (record.key for record in self.records),
            (
                (*record.key, record.version)
                for record in self.records
                if record.version is not None
            ),
        )
        self.checked_at = datetime.now(UTC).isoformat()
        for record in self.records:
            record.latest_version = self.lookups.latest.get(record.key)
            record.update = update_level(record.ecosystem, record.version, record.latest_version)
            if record.version is None:
                continue
            advisories = self.lookups.advisories.get((*record.key, record.version), [])
            record.vulnerabilities = [_vulnerability(record, advisory) for advisory in advisories]
            record.vulnerability_count = len(advisories)
            known = [a.severity for a in advisories]
            record.max_severity = min(known, key=SEVERITIES.index) if known else None

    def summary(self) -> dict[str, Any]:
        records = self.records
        vulnerable = [r for r in records if r.vulnerability_count]
        severities: Counter[str] = Counter(
            v["severity"] for r in records for v in r.vulnerabilities
        )
        conflicts: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        for record in records:
            if record.conflict:
                conflicts[record.key].append(
                    {"manifest": record.manifest, "specifier": record.specifier}
                )
        return {
            "manifests": {
                "total": self.manifests.total(),
                "parsed": self.manifests["parsed"],
                "invalid": self.manifests["invalid"],
                "unreadable": self.manifests["unreadable"],
            },
            "dependencies": len(records),
            "truncated": self.truncated,
            "by_ecosystem": {e: sum(r.ecosystem == e for r in records) for e in ("python", "npm")},
            "by_scope": {
                "runtime": sum(r.scope == "runtime" for r in records),
                "dev": sum(r.scope == "dev" for r in records),
                "other": sum(r.scope not in ("runtime", "dev") for r in records),
            },
            "by_version_source": {
                s: sum(r.version_source == s for r in records)
                for s in ("pinned", "minimum", "none")
            },
            "updates": {u: sum(r.update == u for r in records) for u in UPDATES},
            "vulnerable_dependencies": len(vulnerable),
            # Vulnerable declarations by their most severe vulnerability (the health score).
            "vulnerable_by_max_severity": {
                s: sum(r.max_severity == s for r in vulnerable) for s in SEVERITIES
            },
            "vulnerabilities": sum(r.vulnerability_count for r in records),
            "by_severity": {s: severities[s] for s in SEVERITIES},
            "conflicts": [
                {"ecosystem": ecosystem, "name": name, "declarations": declarations}
                for (ecosystem, name), declarations in sorted(conflicts.items())
            ][:MAX_CONFLICTS],
            "lookups": {
                "registry": self.lookups.registry,
                "osv": self.lookups.osv,
                "checked_at": self.checked_at,
            },
        }

    def security_findings(self) -> list[Finding]:
        findings: list[Finding] = []
        for record in self.records:
            for vulnerability in record.vulnerabilities:
                findings.append(_finding(record, vulnerability))
        return findings


def _vulnerability(record: DeclaredDependency, advisory: Advisory) -> dict[str, Any]:
    assert record.version is not None
    return {
        "id": advisory.id,
        "aliases": list(advisory.aliases),
        "summary": advisory.summary,
        "severity": advisory.severity,
        "score": advisory.score,
        "fixed_in": first_fix(record.ecosystem, advisory, record.version),
        "cwe": advisory.cwe,
        "url": advisory.url,
    }


def _display_id(vulnerability: dict[str, Any]) -> str:
    cves = [a for a in vulnerability["aliases"] if a.startswith("CVE-")]
    return f"{cves[0]} ({vulnerability['id']})" if cves else vulnerability["id"]


def _finding(record: DeclaredDependency, vulnerability: dict[str, Any]) -> Finding:
    severity = vulnerability["severity"]
    pinned = record.version_source == "pinned"
    known = severity != "unknown"
    allowed = "is pinned" if pinned else "is the lowest version the declared range allows"
    message = f"{_display_id(vulnerability)}: {vulnerability['summary'] or 'Known vulnerability'}"
    if not known:
        message += " (severity not published)"
    fix = vulnerability["fixed_in"]
    return Finding(
        path=record.manifest,
        line=record.line or 1,
        end_line=record.line or 1,
        tool="osv",
        rule_id=vulnerability["id"][:64],
        title=f"Vulnerable dependency: {record.name} {record.version}"[:300],
        owasp="A06",
        cwe=vulnerability["cwe"] or VULNERABLE_DEPENDENCY_CWE,
        severity=severity if known else "medium",
        confidence="confirmed" if pinned else "potential",
        message=message,
        explanation=(
            f"Version {record.version} of {record.name} {allowed}, and it has a published "
            "vulnerability. Published vulnerabilities in dependencies are exploited widely "
            "because their details are public."
        ),
        recommendation=(
            f"Upgrade {record.name} to {fix} or later."
            if fix
            else "No fixed version is published yet: remove or replace the dependency, or "
            "apply the advisory's workaround."
        ),
        doc_url=vulnerability["url"],
    )
