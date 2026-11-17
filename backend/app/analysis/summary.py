"""Summary analyzer: what a snapshot contains (files, languages, lines of code).

Lines are counted like the code-metrics analysis (CRLF and CR are line breaks, a final line
without a newline counts). ``code_lines`` are the non-blank lines. Files in excluded
directories are counted as excluded and never read; generated files (lock files, minified
bundles), binary files and files that cannot be read are counted as skipped, by reason.

The builder consumes files one at a time, so a run never holds the whole repository's text
in memory.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from app.analysis.exclusions import excluded_directory, is_generated
from app.services.code_metrics import count_lines

SKIP_REASONS = ("binary", "too_large", "unavailable", "generated")


@dataclass(frozen=True)
class SnapshotFile:
    """One file of the captured snapshot, with its decoded text when it was read."""

    path: str
    language: str | None
    size_bytes: int
    status: str  # "text", "binary", "too_large", "unavailable" or "excluded"
    text: str | None = None


@dataclass
class Summary:
    file_count: int = 0
    analyzed_file_count: int = 0
    excluded_file_count: int = 0
    total_bytes: int = 0
    total_lines: int = 0
    code_lines: int = 0
    languages: list[dict[str, Any]] = field(default_factory=list)
    skipped: dict[str, int] = field(default_factory=lambda: dict.fromkeys(SKIP_REASONS, 0))


def is_analyzable(file: SnapshotFile) -> bool:
    """Readable text that is the project's own code (neither excluded nor generated)."""
    return file.status == "text" and file.text is not None and not is_generated(file.path)


class SummaryBuilder:
    def __init__(self) -> None:
        self._summary = Summary()
        self._languages: dict[str | None, dict[str, Any]] = {}

    def add(self, file: SnapshotFile) -> None:
        summary = self._summary
        summary.file_count += 1
        summary.total_bytes += file.size_bytes
        if file.status == "excluded" or excluded_directory(file.path) is not None:
            summary.excluded_file_count += 1
            return
        if file.status != "text" or file.text is None:
            reason = file.status if file.status in SKIP_REASONS else "unavailable"
            summary.skipped[reason] += 1
            return
        if is_generated(file.path):
            summary.skipped["generated"] += 1
            return
        lines, blank = count_lines(file.text)
        summary.analyzed_file_count += 1
        summary.total_lines += lines
        summary.code_lines += lines - blank
        entry = self._languages.setdefault(
            file.language,
            {"language": file.language, "files": 0, "lines": 0, "code_lines": 0, "bytes": 0},
        )
        entry["files"] += 1
        entry["lines"] += lines
        entry["code_lines"] += lines - blank
        entry["bytes"] += file.size_bytes

    def result(self) -> Summary:
        self._summary.languages = sorted(
            self._languages.values(),
            # Most code first; ties by files, then name (unknown language last).
            key=lambda e: (
                -e["code_lines"],
                -e["files"],
                e["language"] is None,
                e["language"] or "",
            ),
        )
        return self._summary


def summarize(files: Iterable[SnapshotFile]) -> Summary:
    builder = SummaryBuilder()
    for file in files:
        builder.add(file)
    return builder.result()
