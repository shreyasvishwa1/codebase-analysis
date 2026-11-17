"""Running Bandit over the Python working copy.

Bandit is a static security linter: it parses Python source into a syntax tree and never
imports or runs it. It runs on the private working copy (app.analysis.working_copy), never
on repository storage, through app.analysis.tools (minimal environment, timeout, report
size cap). ``--ignore-nosec`` reports findings even where the code says ``# nosec``: an
audit should not be silenced by the code it audits.
"""

import json
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from app.analysis.security.rules import BANDIT_SKIP
from app.analysis.tools import ToolStatus, run_tool

BANDIT_TIMEOUT_SECONDS = 300
MAX_REPORT_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class BanditFinding:
    path: str  # relative to the working copy, '/'-separated
    test_id: str
    test_name: str
    message: str
    severity: str  # HIGH, MEDIUM or LOW
    confidence: str  # HIGH, MEDIUM or LOW
    cwe: int | None
    line: int
    end_line: int
    url: str | None


def bandit_command(source_dir: Path, report: Path) -> list[str]:
    return [
        sys.executable,
        "-m",
        "bandit",
        "--recursive",
        "--format",
        "json",
        "--output",
        str(report),
        "--quiet",
        "--exit-zero",
        "--ignore-nosec",
        "--skip",
        ",".join(BANDIT_SKIP),
        str(source_dir),
    ]


def run_bandit(source_dir: Path, report: Path) -> ToolStatus:
    return run_tool(
        bandit_command(source_dir, report),
        source_dir,
        report,
        timeout=BANDIT_TIMEOUT_SECONDS,
        max_report_bytes=MAX_REPORT_BYTES,
        report_on_stdout=False,
    )


def _int(value: object, default: int) -> int:
    return value if isinstance(value, int) and value >= 1 else default


def read_report(source_dir: Path, report: Path) -> Iterator[BanditFinding]:
    """The findings of a completed report; entries that are not findings are skipped."""
    base = source_dir.resolve()
    try:
        results = json.loads(report.read_text(encoding="utf-8", errors="replace"))["results"]
    except (ValueError, KeyError, TypeError):
        return
    if not isinstance(results, list):
        return
    for entry in results:
        try:
            line = _int(entry.get("line_number"), 1)
            lines = entry.get("line_range")
            last = max(lines) if isinstance(lines, list) and lines else line
            cwe = entry.get("issue_cwe")
            finding = BanditFinding(
                path=Path(entry["filename"]).resolve().relative_to(base).as_posix(),
                test_id=str(entry["test_id"]),
                test_name=str(entry.get("test_name") or entry["test_id"]),
                message=str(entry.get("issue_text") or ""),
                severity=str(entry.get("issue_severity") or "LOW").upper(),
                confidence=str(entry.get("issue_confidence") or "LOW").upper(),
                cwe=cwe.get("id")
                if isinstance(cwe, dict) and isinstance(cwe.get("id"), int)
                else None,
                line=line,
                end_line=max(line, _int(last, line)),
                url=entry.get("more_info") or None,
            )
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
        yield finding
