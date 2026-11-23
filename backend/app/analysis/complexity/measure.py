"""Measuring one source file: functions and their cyclomatic complexity, classes, lines of code
and the maintainability index.

* **Functions** come from Lizard, which parses source text for about twenty languages and
  reports each function's cyclomatic complexity (McCabe: 1 + the number of decision points),
  its lines of code without comments and blanks (NLOC) and its parameters.
* **Maintainability index** (0-100, higher is easier to maintain) uses the formula of Radon
  and Visual Studio: ``max(0, (171 - 5.2 ln V - 0.23 G - 16.2 ln L) * 100 / 171)`` with Halstead
  volume V, cyclomatic complexity G and lines of code L. Python files use Radon's own value
  (which also credits comments). Other languages use the formula with V = N log2 n computed
  from Lizard's tokens (N tokens, n distinct tokens; comments excluded), so their value is
  marked as estimated.
* **Classes** are counted from the Python syntax tree, or from class declarations elsewhere.

Nothing is executed: Lizard tokenizes text and Radon parses a syntax tree.
"""

import math
import re
from dataclasses import dataclass, field
from typing import Literal

from lizard import analyze_file
from lizard_languages import get_reader_for
from radon.metrics import h_visit_ast, mi_compute
from radon.raw import analyze as raw_metrics
from radon.visitors import ComplexityVisitor

from app.analysis import python_ast

Rank = Literal["low", "medium", "high"]
Maintainability = Literal["good", "moderate", "poor"]

MEDIUM_FROM = 11  # cyclomatic complexity: 1-10 low, 11-20 medium, 21+ high
HIGH_FROM = 21
MODERATE_BELOW = 20  # maintainability index: 20-100 good, 10-19 moderate, 0-9 poor
POOR_BELOW = 10
MAX_MEASURED_BYTES = 512 * 1024  # larger files are counted as skipped
MAX_NAME_CHARS = 300

# Programming languages measured (data, markup and configuration formats are not).
MEASURED_LANGUAGES = frozenset(
    {
        "C", "C#", "C++", "Dart", "Erlang", "Go", "Java", "JavaScript", "Kotlin", "Lua",
        "Objective-C", "PHP", "Perl", "Python", "R", "Ruby", "Rust", "Scala", "Solidity",
        "Swift", "TSX", "TypeScript", "Vue", "Zig",
    }
)  # fmt: skip

_CLASS = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?"
    r"(?:(?:abstract|public|private|protected|internal|final|sealed|static|data|open|partial)\s+)*"
    r"(?:class|interface|struct|enum|trait|object)\s+[A-Za-z_$]",
    re.M,
)
_GO_TYPE = re.compile(r"^\s*type\s+\w+\s+(?:struct|interface)\b", re.M)
_COMMENT_PREFIXES = ("//", "/*", "#", "--", "<!--")


@dataclass(frozen=True)
class FunctionComplexity:
    name: str
    line: int
    end_line: int
    cyclomatic: int
    nloc: int
    parameters: int
    rank: Rank


@dataclass
class FileComplexity:
    path: str
    language: str
    nloc: int
    classes: int
    functions: list[FunctionComplexity] = field(default_factory=list)
    maintainability_index: float | None = None
    mi_estimated: bool = False

    @property
    def total_cyclomatic(self) -> int:
        return sum(f.cyclomatic for f in self.functions)

    @property
    def max_cyclomatic(self) -> int:
        return max((f.cyclomatic for f in self.functions), default=0)

    @property
    def rank(self) -> Rank:
        """A file is as complex as its most complex function."""
        return rank_of(self.max_cyclomatic)


def rank_of(cyclomatic: int) -> Rank:
    if cyclomatic >= HIGH_FROM:
        return "high"
    return "medium" if cyclomatic >= MEDIUM_FROM else "low"


def maintainability_of(index: float) -> Maintainability:
    if index < POOR_BELOW:
        return "poor"
    return "moderate" if index < MODERATE_BELOW else "good"


def measurable(path: str, language: str | None) -> bool:
    return language in MEASURED_LANGUAGES and get_reader_for(path) is not None


def maintainability_index(volume: float, cyclomatic: int, nloc: int) -> float:
    """The maintainability index (0-100) for Halstead volume, complexity and lines of code."""
    raw = 171 - 5.2 * math.log(max(volume, 1.0)) - 0.23 * cyclomatic - 16.2 * math.log(max(nloc, 1))
    return round(max(0.0, raw * 100 / 171), 1)


def halstead_volume(path: str, text: str) -> float:
    """Halstead volume N log2 n from Lizard's tokens: N tokens in total, n distinct tokens
    (operators and operands together; comments and whitespace are not tokens)."""
    reader = get_reader_for(path)
    if reader is None:
        return 0.0
    counts: dict[str, int] = {}
    for token in reader.generate_tokens(text):
        stripped = token.strip()
        if not stripped or stripped.startswith(_COMMENT_PREFIXES):
            continue
        counts[stripped] = counts.get(stripped, 0) + 1
    length = sum(counts.values())
    return length * math.log2(len(counts)) if len(counts) > 1 else 0.0


def _python_classes(text: str) -> int | None:
    try:
        tree = python_ast.parse(text)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return None
    return python_ast.count_classes(tree)


def _radon_mi(text: str) -> float:
    """Radon's ``mi_visit(text, multi=True)``, computed as its ``mi_parameters`` does but
    from the syntax tree the other analyzers share, instead of parsing the file again."""
    tree = python_ast.parse(text)
    raw = raw_metrics(text)
    comments = (raw.comments + raw.multi) / float(raw.sloc) * 100 if raw.sloc != 0 else 0
    volume = h_visit_ast(tree).total.volume
    complexity = ComplexityVisitor.from_ast(tree).total_complexity
    return float(mi_compute(volume, complexity, raw.lloc, comments))


def _python_mi(text: str) -> float | None:
    try:
        return round(max(0.0, _radon_mi(text)), 1)
    except (SyntaxError, ValueError, RecursionError, MemoryError, TypeError):
        return None


def measure_file(path: str, language: str, text: str) -> FileComplexity:
    """Complexity of one measurable file (see ``measurable``)."""
    result = analyze_file.analyze_source_code(path, text)
    functions = [
        FunctionComplexity(
            name=(f.name or f.long_name)[:MAX_NAME_CHARS],
            line=max(1, f.start_line),
            end_line=max(f.start_line, f.end_line, 1),
            cyclomatic=f.cyclomatic_complexity,
            nloc=f.nloc,
            parameters=len(f.parameters),
            rank=rank_of(f.cyclomatic_complexity),
        )
        for f in result.function_list
    ]
    python = language == "Python"
    classes = _python_classes(text) if python else None
    if classes is None:
        classes = len(_CLASS.findall(text)) + len(_GO_TYPE.findall(text))
    file = FileComplexity(
        path=path, language=language, nloc=result.nloc, classes=classes, functions=functions
    )
    if result.nloc > 0:
        mi = _python_mi(text) if python else None
        if mi is None:
            file.mi_estimated = True
            mi = maintainability_index(
                halstead_volume(path, text), max(1, file.total_cyclomatic), result.nloc
            )
        file.maintainability_index = mi
    return file
