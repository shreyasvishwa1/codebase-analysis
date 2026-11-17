"""The security analyzer: consumes snapshot files one at a time, then reports findings.

Sources, all static (no repository code is imported or run):

* Bandit on the private Python working copy;
* committed secrets in every text file (the secret-scan rules), and possible hard-coded
  credentials in other languages and configuration files;
* pattern rules for JavaScript/TypeScript (eval, HTML sinks, SQL and shell commands built
  from strings) and for any language (TLS verification off, insecure JWT, CORS wildcard),
  and debug settings in Python settings files;
* committed .env files and Dockerfiles (root user, unpinned base image, remote ADD).

Every finding has a severity, a confidence (confirmed or potential, see rules.py), an OWASP
Top 10 category, a CWE when one applies, an explanation and a recommendation. Findings never
contain matched secret values. All findings are counted; the most severe MAX_STORED are kept.
"""

from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.analysis.exclusions import excluded_directory
from app.analysis.security import patterns
from app.analysis.security.bandit_runner import read_report, run_bandit
from app.analysis.security.rules import (
    BANDIT_DEFAULT_RECOMMENDATION,
    BANDIT_EXPLANATION,
    BANDIT_RECOMMENDATIONS,
    BANDIT_REDACTED,
    BANDIT_TITLES,
    CONFIDENCES,
    OWASP,
    OWASP_KEYS,
    RULES,
    SEVERITIES,
    bandit_owasp,
)
from app.analysis.summary import SnapshotFile, is_analyzable
from app.analysis.tools import ToolStatus
from app.analysis.working_copy import PythonWorkingCopy
from app.services.code_outline import _is_python

MAX_STORED_FINDINGS = 5000
MAX_COLLECTED_FINDINGS = 50_000  # held in memory for ranking; the rest are only counted
MAX_FINDINGS_PER_FILE = 100
TOP_FILES = 10
TOP_RULES = 10
OWN_TOOL = "codebase-analysis"

_SEVERITY_RANK: dict[str, int] = {severity: rank for rank, severity in enumerate(SEVERITIES)}
_CONFIDENCE_RANK: dict[str, int] = {level: rank for rank, level in enumerate(CONFIDENCES)}
_BANDIT_SEVERITY = {"HIGH": "high", "MEDIUM": "medium", "LOW": "low"}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    end_line: int
    tool: str
    rule_id: str
    title: str
    owasp: str
    cwe: int | None
    severity: str
    confidence: str
    message: str
    explanation: str
    recommendation: str
    doc_url: str | None


@dataclass(frozen=True)
class SecurityResult:
    findings: list[Finding]  # the stored findings, most severe first
    summary: dict[str, Any]


def _title(test_name: str) -> str:
    words = test_name.replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else "Bandit finding"


class SecurityAnalyzer:
    def __init__(self, workdir: Path, copy: PythonWorkingCopy | None = None) -> None:
        # The Python working copy may be shared with other analyzers of the same run.
        self._copy = copy if copy is not None else PythonWorkingCopy(workdir)
        self._report = workdir / "bandit.json"
        self._findings: list[Finding] = []
        self._seen: set[tuple[str, int, str]] = set()
        self._per_file: Counter[str] = Counter()
        self._total = 0
        self._severity: Counter[str] = Counter()
        self._confidence: Counter[str] = Counter()
        self._owasp: Counter[str] = Counter()
        self._rules: Counter[str] = Counter()
        self._rule_titles: dict[str, tuple[str, str]] = {}
        self._files: Counter[str] = Counter()
        self._file_severity: dict[str, Counter[str]] = {}
        self._scanned = 0
        self._python = 0

    # --- collection -----------------------------------------------------------------------

    def _record(self, finding: Finding) -> None:
        key = (finding.path, finding.line, finding.rule_id)
        if key in self._seen:
            return
        self._seen.add(key)
        self._total += 1
        self._severity[finding.severity] += 1
        self._confidence[finding.confidence] += 1
        self._owasp[finding.owasp] += 1
        self._rules[finding.rule_id] += 1
        self._rule_titles.setdefault(finding.rule_id, (finding.title, finding.severity))
        self._files[finding.path] += 1
        self._file_severity.setdefault(finding.path, Counter())[finding.severity] += 1
        if len(self._findings) < MAX_COLLECTED_FINDINGS:
            self._findings.append(finding)

    def _own(self, path: str, match: patterns.Match) -> None:
        if self._per_file[path] >= MAX_FINDINGS_PER_FILE:
            return
        self._per_file[path] += 1
        rule = RULES[match.rule_id]
        self._record(
            Finding(
                path=path,
                line=match.line,
                end_line=match.line,
                tool=OWN_TOOL,
                rule_id=match.rule_id,
                title=rule.title,
                owasp=rule.owasp,
                cwe=rule.cwe,
                severity=rule.severity,
                confidence=rule.confidence,
                message=match.message,
                explanation=rule.explanation,
                recommendation=rule.recommendation,
                doc_url=None,
            )
        )

    def add(self, file: SnapshotFile) -> None:
        if not is_analyzable(file) or file.text is None or excluded_directory(file.path):
            return
        text = file.text
        self._scanned += 1
        for match in patterns.scan_lines(file.path, file.language, text):
            self._own(file.path, match)
        if patterns.is_env_file(file.path):
            env = patterns.scan_env_file(text)
            if env is not None:
                self._own(file.path, env)
        if patterns.is_dockerfile(file.path):
            for match in patterns.scan_dockerfile(text):
                self._own(file.path, match)
        if _is_python(file.language, PurePosixPath(file.path).suffix.lstrip(".")):
            self._python += 1
            self._copy.add(file.path, text)

    # --- results --------------------------------------------------------------------------

    def _bandit(self) -> ToolStatus:
        if not len(self._copy):
            return "skipped"
        status = run_bandit(self._copy.source, self._report)
        if status != "completed":
            return status
        for found in read_report(self._copy.source, self._report):
            path = self._copy.snapshot_path(found.path)
            if path is None:
                continue
            owasp = bandit_owasp(found.test_id)
            self._record(
                Finding(
                    path=path,
                    line=found.line,
                    end_line=found.end_line,
                    tool="bandit",
                    rule_id=found.test_id,
                    title=BANDIT_TITLES.get(found.test_id) or _title(found.test_name),
                    owasp=owasp,
                    cwe=found.cwe,
                    severity=_BANDIT_SEVERITY.get(found.severity, "low"),
                    confidence="confirmed" if found.confidence == "HIGH" else "potential",
                    message=BANDIT_REDACTED.get(found.test_id, found.message),
                    explanation=f"{BANDIT_EXPLANATION} ({owasp}: {OWASP[owasp]}).",
                    recommendation=BANDIT_RECOMMENDATIONS.get(owasp, BANDIT_DEFAULT_RECOMMENDATION),
                    doc_url=found.url,
                )
            )
        return "completed"

    def result(self) -> SecurityResult:
        bandit_status = self._bandit()
        ranked = sorted(
            self._findings,
            key=lambda f: (
                _SEVERITY_RANK[f.severity],
                _CONFIDENCE_RANK[f.confidence],
                f.path,
                f.line,
                f.rule_id,
            ),
        )
        stored = ranked[:MAX_STORED_FINDINGS]
        top_files = sorted(self._files.items(), key=lambda item: (-item[1], item[0]))[:TOP_FILES]
        top_rules = sorted(self._rules.items(), key=lambda item: (-item[1], item[0]))[:TOP_RULES]
        summary: dict[str, Any] = {
            "files_scanned": self._scanned,
            "python_files": self._python,
            "bandit": bandit_status,
            "findings": self._total,
            "stored_findings": len(stored),
            "by_severity": {severity: self._severity[severity] for severity in SEVERITIES},
            "by_confidence": {level: self._confidence[level] for level in CONFIDENCES},
            "by_owasp": {key: self._owasp[key] for key in OWASP_KEYS},
            "top_files": [
                {
                    "path": path,
                    "findings": count,
                    **{s: self._file_severity[path][s] for s in SEVERITIES},
                }
                for path, count in top_files
            ],
            "top_rules": [
                {
                    "rule_id": rule_id,
                    "count": count,
                    "title": self._rule_titles[rule_id][0],
                    "severity": self._rule_titles[rule_id][1],
                }
                for rule_id, count in top_rules
            ],
        }
        return SecurityResult(findings=stored, summary=summary)
