"""Running Ruff over a repository's Python files.

Ruff is a static analyzer: it parses source text and never imports or runs it. It is run on a
private working copy that holds only the snapshot's verified, readable Python files (written
by the quality analyzer), never on repository storage, so excluded directories, links and
configuration files in the repository can not influence it. ``--isolated`` ignores every
configuration file; the rule selection is ours.

The process gets a minimal environment, a timeout and a cap on its output; its JSON-lines
report goes to a file and is parsed one line at a time.
"""

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.analysis.quality.rules import RUFF_IGNORE, RUFF_SELECT

RUFF_TIMEOUT_SECONDS = 240
MAX_REPORT_BYTES = 64 * 1024 * 1024
LINE_LENGTH = 100

RuffStatus = Literal["completed", "timeout", "unavailable", "failed", "too_large", "skipped"]


@dataclass(frozen=True)
class RuffFinding:
    path: str  # relative to the working copy, with forward slashes
    code: str | None
    message: str
    line: int
    column: int
    end_line: int
    fix: str | None
    url: str | None


def ruff_command(source_dir: Path) -> list[str]:
    return [
        sys.executable,
        "-m",
        "ruff",
        "check",
        "--isolated",
        "--no-cache",
        "--exit-zero",
        "--output-format",
        "json-lines",
        "--target-version",
        "py312",
        "--line-length",
        str(LINE_LENGTH),
        "--select",
        ",".join(RUFF_SELECT),
        "--ignore",
        ",".join(RUFF_IGNORE),
        str(source_dir),
    ]


def _environment() -> dict[str, str]:
    keep = ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG")
    return {key: value for key in keep if (value := os.environ.get(key)) is not None}


def run_ruff(source_dir: Path, report: Path) -> RuffStatus:
    """Run Ruff on ``source_dir``, writing its report to ``report``."""
    try:
        with report.open("wb") as out:
            completed = subprocess.run(  # noqa: S603 - fixed argument list, no shell
                ruff_command(source_dir),
                cwd=source_dir,
                env=_environment(),
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=subprocess.DEVNULL,
                timeout=RUFF_TIMEOUT_SECONDS,
                check=False,
            )
    except subprocess.TimeoutExpired:
        return "timeout"
    except OSError:
        return "unavailable"
    if completed.returncode != 0:
        # --exit-zero: a non-zero exit is a Ruff failure, including "No module named ruff".
        return "failed"
    if report.stat().st_size > MAX_REPORT_BYTES:
        return "too_large"
    return "completed"


def read_report(source_dir: Path, report: Path) -> Iterator[RuffFinding]:
    """The findings of a completed report; lines that are not findings are skipped."""
    base = source_dir.resolve()
    with report.open(encoding="utf-8", errors="replace") as lines:
        for raw in lines:
            try:
                entry = json.loads(raw)
                location = entry["location"]
                end = entry.get("end_location") or location
                fix = entry.get("fix")
                line = int(location.get("row") or 1)
                finding = RuffFinding(
                    path=Path(entry["filename"]).resolve().relative_to(base).as_posix(),
                    code=entry.get("code") or None,
                    message=str(entry.get("message") or ""),
                    line=line,
                    column=int(location.get("column") or 1),
                    end_line=max(line, int(end.get("row") or line)),
                    fix=fix.get("message") if isinstance(fix, dict) else None,
                    url=entry.get("url") or None,
                )
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
            yield finding
