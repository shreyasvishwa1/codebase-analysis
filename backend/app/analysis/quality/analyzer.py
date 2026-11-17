"""The code-quality analyzer: consumes snapshot files one at a time, then reports issues.

Sources, all static (no repository code is imported or run):

* Ruff, on a private working copy of the verified Python files (bug risks, unused code,
  naming, documentation, formatting, simplifications, syntax errors);
* the unreachable-code diagnostic already used by the code explorer (Python AST);
* duplicate blocks, for every programming language;
* TODO / FIXME / HACK / XXX comments and very long files, for every language.

Every issue carries its file, line, category, severity, an explanation and a suggested
correction. All issues are counted; the most severe ``MAX_STORED_ISSUES`` are stored.
"""

import ast
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.analysis.exclusions import excluded_directory
from app.analysis.quality.duplication import DuplicationDetector, DuplicationResult
from app.analysis.quality.rules import CATEGORIES, OWN_RULES, SEVERITIES, RuleInfo, ruff_rule
from app.analysis.quality.ruff_runner import RuffStatus, read_report, run_ruff
from app.analysis.summary import SnapshotFile, is_analyzable
from app.analysis.working_copy import PythonWorkingCopy
from app.services.code_metrics import count_lines

# The unreachable-code diagnostic of the code explorer, reused unchanged.
from app.services.code_outline import _PARSE_ERRORS, MAX_OUTLINE_BYTES, _is_python
from app.services.code_unreachable_code import _regions, _start

MAX_STORED_ISSUES = 5000
MAX_COLLECTED_ISSUES = 50_000  # held in memory for ranking; the rest are only counted
MAX_MARKERS_PER_FILE = 20
LONG_FILE_LINES = 1000
TOP_FILES = 10
TOP_RULES = 10
OWN_TOOL = "codebase-analysis"

_MARKER = re.compile(r"(?:#|//|/\*|<!--|--|^\s*\*)[^\n]*?\b(TODO|FIXME|HACK|XXX)\b")
_RANK: dict[str, int] = {severity: rank for rank, severity in enumerate(SEVERITIES)}
_CAUSES = {
    "return": "the return",
    "raise": "the raise",
    "break": "the break",
    "continue": "the continue",
    "if": "the if/else (every branch leaves)",
    "while": "the endless while loop",
}


@dataclass(frozen=True)
class Issue:
    path: str
    line: int
    column: int | None
    end_line: int
    tool: str
    rule_id: str
    category: str
    severity: str
    message: str
    explanation: str
    suggestion: str
    doc_url: str | None


@dataclass(frozen=True)
class QualityResult:
    issues: list[Issue]  # the stored issues, most severe first
    summary: dict[str, Any]


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


class QualityAnalyzer:
    def __init__(self, workdir: Path, copy: PythonWorkingCopy | None = None) -> None:
        # The Python working copy may be shared with other analyzers of the same run.
        self._copy = copy if copy is not None else PythonWorkingCopy(workdir)
        self._report = workdir / "ruff.jsonl"
        self._duplication = DuplicationDetector()
        self._issues: list[Issue] = []
        self._total = 0
        self._severity: Counter[str] = Counter()
        self._category: Counter[str] = Counter()
        self._rules: Counter[str] = Counter()
        self._rule_info: dict[str, RuleInfo] = {}
        self._files: Counter[str] = Counter()
        self._file_severity: dict[str, Counter[str]] = {}
        self._analyzed = 0
        self._python = 0

    # --- collection -----------------------------------------------------------------------

    def _record(self, issue: Issue, info: RuleInfo) -> None:
        self._total += 1
        self._severity[issue.severity] += 1
        self._category[issue.category] += 1
        self._rules[issue.rule_id] += 1
        self._rule_info.setdefault(issue.rule_id, info)
        self._files[issue.path] += 1
        self._file_severity.setdefault(issue.path, Counter())[issue.severity] += 1
        if len(self._issues) < MAX_COLLECTED_ISSUES:
            self._issues.append(issue)

    def _own(self, rule_id: str, path: str, line: int, end_line: int, message: str) -> None:
        info = OWN_RULES[rule_id]
        issue = Issue(
            path=path,
            line=line,
            column=None,
            end_line=end_line,
            tool=OWN_TOOL,
            rule_id=rule_id,
            category=info.category,
            severity=info.severity,
            message=message,
            explanation=info.explanation,
            suggestion=info.suggestion,
            doc_url=None,
        )
        self._record(issue, info)

    def add(self, file: SnapshotFile) -> None:
        if not is_analyzable(file) or file.text is None or excluded_directory(file.path):
            return
        text = file.text
        self._analyzed += 1
        lines, _ = count_lines(text)
        if lines >= LONG_FILE_LINES:
            self._own("long-file", file.path, 1, lines, f"The file has {lines:,} lines.")
        self._markers(file.path, text)
        self._duplication.add(file.path, file.language, text)
        if _is_python(file.language, PurePosixPath(file.path).suffix.lstrip(".")):
            self._python += 1
            self._copy.add(file.path, text)
            self._unreachable(file.path, text)

    def _markers(self, path: str, text: str) -> None:
        found = 0
        for number, line in enumerate(text.splitlines(), start=1):
            match = _MARKER.search(line)
            if match is None:
                continue
            found += 1
            if found > MAX_MARKERS_PER_FILE:
                return
            note = line.strip()
            note = note if len(note) <= 160 else note[:157] + "…"
            self._own("todo-marker", path, number, number, f"{match.group(1)} comment: {note}")

    def _unreachable(self, path: str, text: str) -> None:
        if len(text.encode("utf-8")) > MAX_OUTLINE_BYTES:
            return
        try:
            tree = ast.parse(text)  # a syntax tree only; nothing is compiled or run
        except _PARSE_ERRORS:
            return  # Ruff reports the syntax error
        for region in _regions(tree):
            first, last = region.statements[0], region.statements[-1]
            count = _plural(len(region.statements), "unreachable statement")
            cause = _CAUSES.get(region.cause, f"the {region.cause}")
            self._own(
                "unreachable-code",
                path,
                _start(first)[0],
                last.end_lineno or last.lineno,
                f"{count} after {cause} on line {region.cause_line}.",
            )

    # --- results --------------------------------------------------------------------------

    def _ruff(self) -> RuffStatus:
        if not len(self._copy):
            return "skipped"
        status = run_ruff(self._copy.source, self._report)
        if status != "completed":
            return status
        unparsable: set[str] = set()
        for finding in read_report(self._copy.source, self._report):
            path = self._copy.snapshot_path(finding.path)
            if path is None:
                continue
            if not finding.code:
                # Ruff recovers after a syntax error and reports the errors that follow from
                # it; only the first one (in source order) is a separate problem.
                if path in unparsable:
                    continue
                unparsable.add(path)
            info = ruff_rule(finding.code)
            rule_id = finding.code or "syntax-error"
            self._record(
                Issue(
                    path=path,
                    line=finding.line,
                    column=finding.column,
                    end_line=finding.end_line,
                    tool="ruff",
                    rule_id=rule_id,
                    category=info.category,
                    severity=info.severity,
                    message=finding.message,
                    explanation=info.explanation,
                    suggestion=finding.fix or info.suggestion,
                    doc_url=finding.url,
                ),
                info,
            )
        return "completed"

    def _duplicates(self) -> DuplicationResult:
        result = self._duplication.result()
        for block in result.blocks:
            self._own(
                "duplicate-code",
                block.path,
                block.line,
                block.end_line,
                f"Lines {block.line}–{block.end_line} duplicate {block.original_path} lines "
                f"{block.original_line}–{block.original_end_line} "
                f"({_plural(block.lines, 'significant line')}).",
            )
        return result

    def result(self) -> QualityResult:
        ruff_status = self._ruff()
        duplication = self._duplicates()
        ranked = sorted(self._issues, key=lambda i: (_RANK[i.severity], i.path, i.line, i.rule_id))
        stored = ranked[:MAX_STORED_ISSUES]
        top_files = sorted(self._files.items(), key=lambda item: (-item[1], item[0]))[:TOP_FILES]
        top_rules = sorted(self._rules.items(), key=lambda item: (-item[1], item[0]))[:TOP_RULES]
        summary: dict[str, Any] = {
            "files_analyzed": self._analyzed,
            "python_files": self._python,
            "ruff": ruff_status,
            "issues": self._total,
            "stored_issues": len(stored),
            "by_severity": {severity: self._severity[severity] for severity in SEVERITIES},
            "by_category": {category: self._category[category] for category in CATEGORIES},
            "duplication": {
                "percent": duplication.percent,
                "duplicated_lines": duplication.duplicated_lines,
                "significant_lines": duplication.significant_lines,
                "files": duplication.files,
                "blocks": duplication.block_count,
                "partial": duplication.partial,
            },
            "top_files": [
                {
                    "path": path,
                    "issues": count,
                    **{s: self._file_severity[path][s] for s in SEVERITIES},
                }
                for path, count in top_files
            ],
            "top_rules": [
                {
                    "rule_id": rule_id,
                    "count": count,
                    "category": self._rule_info[rule_id].category,
                    "severity": self._rule_info[rule_id].severity,
                }
                for rule_id, count in top_rules
            ],
        }
        return QualityResult(issues=stored, summary=summary)
