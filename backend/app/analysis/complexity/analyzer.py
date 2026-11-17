"""The complexity analyzer: consumes snapshot files one at a time, then reports file and
function metrics and a repository summary.

Every measurable source file (a programming language Lizard supports, not excluded, not
generated, at most MAX_MEASURED_BYTES) is measured; the others are counted as not measured.
All files are stored (at most MAX_STORED_FILES, the most complex first) and the
MAX_STORED_FUNCTIONS most complex functions; the summary always covers everything measured.
"""

from collections import Counter
from dataclasses import dataclass
from typing import Any

from app.analysis.complexity.measure import (
    MAX_MEASURED_BYTES,
    FileComplexity,
    FunctionComplexity,
    maintainability_of,
    measurable,
    measure_file,
)
from app.analysis.exclusions import excluded_directory
from app.analysis.summary import SnapshotFile, is_analyzable

MAX_STORED_FILES = 20_000
MAX_STORED_FUNCTIONS = 10_000
TOP = 10
RANKS = ("low", "medium", "high")
MAINTAINABILITY = ("good", "moderate", "poor")


@dataclass(frozen=True)
class FileRecord:
    path: str
    language: str
    nloc: int
    functions: int
    classes: int
    total_cyclomatic: int
    max_cyclomatic: int
    average_cyclomatic: float
    rank: str
    maintainability_index: float | None
    maintainability: str | None
    mi_estimated: bool


@dataclass(frozen=True)
class FunctionRecord:
    path: str
    name: str
    line: int
    end_line: int
    cyclomatic: int
    nloc: int
    parameters: int
    rank: str


@dataclass(frozen=True)
class ComplexityResult:
    files: list[FileRecord]  # stored, most complex first
    functions: list[FunctionRecord]  # stored, most complex first
    summary: dict[str, Any]


def _average(total: int, count: int) -> float:
    return round(total / count, 2) if count else 0.0


def _file_record(file: FileComplexity) -> FileRecord:
    mi = file.maintainability_index
    return FileRecord(
        path=file.path,
        language=file.language,
        nloc=file.nloc,
        functions=len(file.functions),
        classes=file.classes,
        total_cyclomatic=file.total_cyclomatic,
        max_cyclomatic=file.max_cyclomatic,
        average_cyclomatic=_average(file.total_cyclomatic, len(file.functions)),
        rank=file.rank,
        maintainability_index=mi,
        maintainability=maintainability_of(mi) if mi is not None else None,
        mi_estimated=file.mi_estimated and mi is not None,
    )


def _function_record(path: str, function: FunctionComplexity) -> FunctionRecord:
    return FunctionRecord(
        path=path,
        name=function.name,
        line=function.line,
        end_line=function.end_line,
        cyclomatic=function.cyclomatic,
        nloc=function.nloc,
        parameters=function.parameters,
        rank=function.rank,
    )


class ComplexityAnalyzer:
    def __init__(self) -> None:
        self._files: list[FileRecord] = []
        self._functions: list[FunctionRecord] = []
        self._skipped: Counter[str] = Counter()

    def add(self, file: SnapshotFile) -> None:
        if not is_analyzable(file) or file.text is None or excluded_directory(file.path):
            return
        if file.language is None or not measurable(file.path, file.language):
            return
        if len(file.text.encode("utf-8")) > MAX_MEASURED_BYTES:
            self._skipped["too_large"] += 1
            return
        try:
            measured = measure_file(file.path, file.language, file.text)
        except (RecursionError, MemoryError, ValueError, IndexError, KeyError, TypeError):
            self._skipped["unparsable"] += 1  # a tool failure on one file never fails the run
            return
        self._files.append(_file_record(measured))
        self._functions.extend(_function_record(file.path, f) for f in measured.functions)

    def result(self) -> ComplexityResult:
        files = sorted(self._files, key=lambda f: (-f.max_cyclomatic, -f.nloc, f.path))
        functions = sorted(self._functions, key=lambda f: (-f.cyclomatic, f.path, f.line))
        total_cc = sum(f.cyclomatic for f in functions)
        # The repository's index is the mean over files (as Radon reports it), so a few very
        # long files cannot hide how maintainable the rest of the code base is.
        indexes = [f.maintainability_index for f in files if f.maintainability_index is not None]
        index = round(sum(indexes) / len(indexes), 1) if indexes else None
        languages = Counter(f.language for f in files)
        summary: dict[str, Any] = {
            "files_measured": len(files),
            "files_skipped": {
                "too_large": self._skipped["too_large"],
                "unparsable": self._skipped["unparsable"],
            },
            "languages": [
                {"language": language, "files": count}
                for language, count in sorted(languages.items(), key=lambda i: (-i[1], i[0]))
            ],
            "nloc": sum(f.nloc for f in files),
            "functions": len(functions),
            "classes": sum(f.classes for f in files),
            "total_cyclomatic": total_cc,
            "average_cyclomatic": _average(total_cc, len(functions)),
            "max_cyclomatic": functions[0].cyclomatic if functions else 0,
            "functions_by_rank": {rank: sum(f.rank == rank for f in functions) for rank in RANKS},
            "files_by_rank": {rank: sum(f.rank == rank for f in files) for rank in RANKS},
            "maintainability_index": index,
            "maintainability": maintainability_of(index) if index is not None else None,
            "files_by_maintainability": {
                level: sum(f.maintainability == level for f in files) for level in MAINTAINABILITY
            },
            "mi_estimated_files": sum(f.mi_estimated for f in files),
            "stored_files": min(len(files), MAX_STORED_FILES),
            "stored_functions": min(len(functions), MAX_STORED_FUNCTIONS),
            "top_functions": [
                {
                    "path": f.path,
                    "name": f.name,
                    "line": f.line,
                    "cyclomatic": f.cyclomatic,
                    "nloc": f.nloc,
                    "rank": f.rank,
                }
                for f in functions[:TOP]
            ],
        }
        return ComplexityResult(
            files=files[:MAX_STORED_FILES],
            functions=functions[:MAX_STORED_FUNCTIONS],
            summary=summary,
        )
