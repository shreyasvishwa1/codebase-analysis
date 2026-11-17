"""Running an external static-analysis tool (Ruff, Bandit) as a subprocess.

The tool gets a fixed argument list (no shell), the working copy as its current directory,
no standard input, a minimal environment (no application secrets such as SECRET_KEY or
database URLs) and a timeout. Its report goes to a file whose size is checked before it is
parsed. The tools parse source text and never import or run it.
"""

import os
import subprocess
from pathlib import Path
from typing import Literal

ToolStatus = Literal["completed", "timeout", "unavailable", "failed", "too_large", "skipped"]

_ENVIRONMENT = ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG")


def minimal_environment() -> dict[str, str]:
    return {key: value for key in _ENVIRONMENT if (value := os.environ.get(key)) is not None}


def run_tool(
    command: list[str],
    cwd: Path,
    report: Path,
    *,
    timeout: int,
    max_report_bytes: int,
    report_on_stdout: bool,
) -> ToolStatus:
    """Run ``command``. With ``report_on_stdout`` its standard output is the report;
    otherwise the command writes ``report`` itself. A non-zero exit is a failure (the tools
    are run with --exit-zero, so findings never fail them)."""
    try:
        with report.open("wb") as out:
            completed = subprocess.run(  # noqa: S603 - fixed argument list, no shell
                command,
                cwd=cwd,
                env=minimal_environment(),
                stdin=subprocess.DEVNULL,
                stdout=out if report_on_stdout else subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                check=False,
            )
    except subprocess.TimeoutExpired:
        return "timeout"
    except OSError:
        return "unavailable"
    if completed.returncode != 0:
        return "failed"  # includes "No module named ..."
    if report.stat().st_size > max_report_bytes:
        return "too_large"
    return "completed"
