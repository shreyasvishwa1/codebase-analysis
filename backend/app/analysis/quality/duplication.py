"""Duplicate code blocks, for every programming language.

Each file is reduced to its *significant* lines: whitespace is collapsed, and blank lines,
comment-only lines, import lines and lines without a letter or digit (lone braces) are
dropped, keeping each kept line's original line number. Every window of ``WINDOW``
consecutive significant lines is hashed; a window seen at two locations is duplicated.
Matching windows at consecutive positions are merged into one block, reported on the later
copy (in path order) with the location of the first. Windows with fewer than
``MIN_DISTINCT_LINES`` different lines (one line repeated, as in data tables) are not compared.

Duplication percentage = significant lines inside any duplicated window / all significant
lines of the analyzed files. Memory is bounded: after ``MAX_INDEXED_LINES`` significant lines
further files are not indexed and the result is marked partial.
"""

import re
from collections import defaultdict
from dataclasses import dataclass

WINDOW = 6  # significant lines: the smallest block reported
MAX_INDEXED_LINES = 400_000
MAX_OCCURRENCES = 20  # locations kept per window (boilerplate repeated everywhere)
MAX_BLOCKS = 1000
MIN_DISTINCT_LINES = 3  # per window

# Languages that are code (data, markup and configuration formats are not compared).
CODE_LANGUAGES = frozenset(
    {
        "C", "C#", "C++", "Clojure", "Dart", "Elixir", "Erlang", "F#", "Go", "Groovy",
        "Haskell", "Java", "JavaScript", "Julia", "Kotlin", "Lua", "Objective-C",
        "Objective-C++", "PHP", "Perl", "PowerShell", "Python", "R", "Ruby", "Rust", "Scala",
        "Shell", "Solidity", "Svelte", "Swift", "TSX", "TypeScript", "Vue", "Zig",
    }
)  # fmt: skip

_SPACE = re.compile(r"\s+")
_WORD = re.compile(r"\w")
_COMMENT_PREFIXES = ("#", "//", "/*", "*", "--", "<!--", ";", "%")
_IMPORT_PREFIXES = ("import ", "from ", "#include", "using ", "package ", "require ", "use ")


@dataclass(frozen=True)
class DuplicateBlock:
    path: str
    line: int
    end_line: int
    original_path: str
    original_line: int
    original_end_line: int
    lines: int  # significant lines in the block


@dataclass(frozen=True)
class DuplicationResult:
    percent: float
    duplicated_lines: int
    significant_lines: int
    files: int
    blocks: list[DuplicateBlock]
    block_count: int
    partial: bool


def significant_lines(text: str) -> list[tuple[int, str]]:
    """(original line number, normalized text) of each line that is compared."""
    kept: list[tuple[int, str]] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = _SPACE.sub(" ", raw).strip()
        if not line or not _WORD.search(line):
            continue
        if line.startswith(_COMMENT_PREFIXES) or line.startswith(_IMPORT_PREFIXES):
            continue
        kept.append((number, line))
    return kept


class DuplicationDetector:
    def __init__(self) -> None:
        self._paths: list[str] = []
        self._lines: list[list[int]] = []  # per file: original line numbers of significant lines
        self._windows: dict[int, list[tuple[int, int]]] = defaultdict(list)
        self._indexed = 0
        self._partial = False

    def add(self, path: str, language: str | None, text: str) -> None:
        if language not in CODE_LANGUAGES:
            return
        kept = significant_lines(text)
        if self._indexed + len(kept) > MAX_INDEXED_LINES:
            self._partial = True
            return
        index = len(self._paths)
        self._paths.append(path)
        self._lines.append([number for number, _ in kept])
        self._indexed += len(kept)
        normalized = [line for _, line in kept]
        for start in range(len(normalized) - WINDOW + 1):
            window = tuple(normalized[start : start + WINDOW])
            if len(set(window)) < MIN_DISTINCT_LINES:
                continue
            occurrences = self._windows[hash(window)]
            if len(occurrences) < MAX_OCCURRENCES:
                occurrences.append((index, start))

    def result(self) -> DuplicationResult:
        covered: list[set[int]] = [set() for _ in self._paths]
        # (first file, copy file, position offset) -> first-file positions of matching windows
        pairs: dict[tuple[int, int, int], list[int]] = defaultdict(list)
        for occurrences in self._windows.values():
            if len(occurrences) < 2:
                continue
            first_file, first_start = occurrences[0]
            for copy_file, copy_start in occurrences[1:]:
                if copy_file == first_file and copy_start - first_start < WINDOW:
                    continue  # overlapping repetition inside one file
                pairs[(first_file, copy_file, copy_start - first_start)].append(first_start)
                for file, start in ((first_file, first_start), (copy_file, copy_start)):
                    covered[file].update(range(start, start + WINDOW))

        blocks: list[DuplicateBlock] = []
        for (first_file, copy_file, offset), starts in pairs.items():
            runs: list[tuple[int, int]] = []  # (first, last) window positions
            for start in sorted(starts):
                if runs and start == runs[-1][1] + 1:
                    runs[-1] = (runs[-1][0], start)
                else:
                    runs.append((start, start))
            for first, last in runs:
                blocks.append(self._block(first_file, copy_file, offset, first, last))
        blocks.sort(key=lambda b: (b.path, b.line, b.original_path, b.original_line))

        duplicated = sum(len(positions) for positions in covered)
        total = self._indexed
        return DuplicationResult(
            percent=round(100 * duplicated / total, 1) if total else 0.0,
            duplicated_lines=duplicated,
            significant_lines=total,
            files=len(self._paths),
            blocks=blocks[:MAX_BLOCKS],
            block_count=len(blocks),
            partial=self._partial,
        )

    def _block(self, first: int, copy: int, offset: int, start: int, last: int) -> DuplicateBlock:
        end = last + WINDOW - 1  # last significant position covered
        first_lines, copy_lines = self._lines[first], self._lines[copy]
        return DuplicateBlock(
            path=self._paths[copy],
            line=copy_lines[start + offset],
            end_line=copy_lines[end + offset],
            original_path=self._paths[first],
            original_line=first_lines[start],
            original_end_line=first_lines[end],
            lines=end - start + 1,
        )
