"""Code chunks for the AI chat (Module 9): the retrieval units of a run.

During a full analysis every text file is split into chunks: Python files by top-level
function and class (``ast``; the code between definitions becomes line windows), other files
by windows of WINDOW_LINES lines. Long definitions are split into windows as well. Chunks are
searched with PostgreSQL full-text search over ``terms``: identifiers are split into words in
Python (``getUserName`` and ``get_user_name`` both give ``get``, ``user``, ``name``), which
the database parser does not do; the chunk's path and symbol count more than its body.

Repository content is untrusted. Nothing here runs it. Committed secrets (the secret scan's
rules, credential assignments and private-key blocks) are masked before a chunk is stored, so
they are never sent to the AI provider, and ``.env`` files are left out entirely.
"""

import ast
import re
from collections.abc import Iterator
from dataclasses import dataclass, field

from app.analysis import python_ast
from app.analysis.security.patterns import _CREDENTIAL, _placeholder, is_env_file
from app.analysis.summary import SnapshotFile
from app.services.secret_scan import RULES as SECRET_RULES

WINDOW_LINES = 60
MAX_DEFINITION_LINES = 120  # longer Python definitions are split into windows
MAX_CHUNK_CHARS = 6000  # longer chunks are cut (the stored text says so)
MAX_FILE_BYTES = 256 * 1024
MAX_CHUNKS = 20000  # per run; files after the limit are not indexed (summary: truncated)
MAX_TERMS = 1500  # distinct search terms per chunk body
MASK = "[secret removed]"
PRIVATE_KEY_MASK = "[private key removed]"
CUT = "\n[... chunk cut ...]"

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+")


def words(text: str) -> Iterator[str]:
    """Lowercase search terms of ``text``: each identifier and the words it is made of
    (camelCase, PascalCase, snake_case), at least two characters, digits alone excluded."""
    for identifier in _IDENTIFIER.findall(text):
        whole = identifier.strip("_").lower()
        if 2 <= len(whole) <= 64:
            yield whole
        for part in identifier.split("_"):
            pieces = _CAMEL.findall(part)
            if len(pieces) < 2 and part.lower() == whole:
                continue  # the identifier itself, already yielded
            for piece in pieces:
                piece = piece.lower()
                if len(piece) >= 2 and not piece.isdigit():
                    yield piece


def terms(text: str, limit: int = MAX_TERMS) -> str:
    """Distinct ``words`` of ``text`` in order of appearance, space separated."""
    seen: dict[str, None] = {}
    for word in words(text):
        if word not in seen:
            seen[word] = None
            if len(seen) >= limit:
                break
    return " ".join(seen)


def mask_secrets(text: str) -> tuple[str, int]:
    """``text`` with committed secrets replaced, and how many were masked."""
    lines = text.split("\n")
    masked = 0
    out: list[str] = []
    in_key = False
    for line in lines:
        if in_key:
            if "-----END" in line:
                in_key = False
            continue
        if "PRIVATE KEY" in line and "-----BEGIN" in line:
            out.append(PRIVATE_KEY_MASK)
            masked += 1
            in_key = "-----END" not in line
            continue
        for rule in SECRET_RULES:
            line, count = rule.pattern.subn(MASK, line)
            masked += count
        line, count = _mask_credentials(line)
        masked += count
        out.append(line)
    return "\n".join(out), masked


def _mask_credentials(line: str) -> tuple[str, int]:
    """Values assigned to password, secret, api_key, ... unless they look like placeholders."""
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        value = match.group(1)
        if _placeholder(value):
            return match.group(0)
        count += 1
        return match.group(0).replace(value, MASK)

    return _CREDENTIAL.sub(replace, line), count


@dataclass(frozen=True)
class Chunk:
    path: str
    language: str | None
    start_line: int
    end_line: int
    symbol: str | None
    content: str
    head_terms: str  # path and symbol terms (weighted higher)
    body_terms: str


def _windows(
    lines: list[str], start: int, end: int, symbol: str | None
) -> Iterator[tuple[int, int, str | None]]:
    """1-based inclusive ranges of at most WINDOW_LINES lines within [start, end], skipping
    windows with only blank lines."""
    for first in range(start, end + 1, WINDOW_LINES):
        last = min(end, first + WINDOW_LINES - 1)
        if any(line.strip() for line in lines[first - 1 : last]):
            yield first, last, symbol


def _definitions(text: str) -> list[tuple[int, int, str]] | None:
    """Top-level functions and classes as (first line incl. decorators, last line, name), or
    None when the file does not parse."""
    try:
        tree = python_ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    found = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            first = min([node.lineno] + [d.lineno for d in node.decorator_list])
            found.append((first, node.end_lineno or node.lineno, node.name))
    return found


def _ranges(text: str, lines: list[str], python: bool) -> Iterator[tuple[int, int, str | None]]:
    definitions = _definitions(text) if python else None
    if not definitions:
        yield from _windows(lines, 1, len(lines), None)
        return
    position = 1
    for first, last, name in definitions:
        if first > position:
            yield from _windows(lines, position, first - 1, None)
        if last - first + 1 > MAX_DEFINITION_LINES:
            yield from _windows(lines, first, last, name)
        else:
            yield first, last, name
        position = last + 1
    if position <= len(lines):
        yield from _windows(lines, position, len(lines), None)


@dataclass
class ChunkBuilder:
    chunks: list[Chunk] = field(default_factory=list)
    files: int = 0
    masked: int = 0
    truncated: bool = False

    def add(self, file: SnapshotFile) -> None:
        if file.status != "text" or file.text is None or is_env_file(file.path):
            return
        if file.size_bytes > MAX_FILE_BYTES or not file.text.strip():
            return
        if self.truncated:
            return
        text, masked = mask_secrets(file.text)
        lines = text.split("\n")
        if lines[-1] == "":
            lines.pop()  # the final newline ends the last line; it does not start another
        ranges = list(_ranges(text, lines, file.path.endswith((".py", ".pyi"))))
        if len(self.chunks) + len(ranges) > MAX_CHUNKS:
            self.truncated = True
            return
        self.files += 1
        self.masked += masked
        path_terms = terms(file.path.replace("/", " ").replace(".", " "))
        for first, last, symbol in ranges:
            content = "\n".join(lines[first - 1 : last])
            if len(content) > MAX_CHUNK_CHARS:
                content = content[:MAX_CHUNK_CHARS] + CUT
            head = " ".join(t for t in (path_terms, terms(symbol) if symbol else "") if t)
            self.chunks.append(
                Chunk(file.path, file.language, first, last, symbol, content, head, terms(content))
            )

    def summary(self) -> dict[str, object]:
        return {
            "chunks": len(self.chunks),
            "files": self.files,
            "masked_secrets": self.masked,
            "truncated": self.truncated,
        }
