"""Reading a captured snapshot for analysis.

Files are read only through the verified reader (links refused, containment checked, size
bounded, SHA-256 verified) and decoded with its strict UTF-8 decoder. Files in excluded
directories are never opened. Repository content is data only: nothing is executed.
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

from app.analysis.exclusions import excluded_directory
from app.analysis.summary import SnapshotFile

# The verified reader and decoder, reused unchanged (never duplicated).
from app.services.file_content import MAX_CONTENT_BYTES, _decode, _read_verified, _Unavailable


@dataclass(frozen=True)
class SnapshotRow:
    path: str
    language: str | None
    size_bytes: int
    sha256: str | None


def read_file(root: Path, row: SnapshotRow) -> SnapshotFile:
    def snapshot(status: str, text: str | None = None) -> SnapshotFile:
        return SnapshotFile(row.path, row.language, row.size_bytes, status, text)

    if excluded_directory(row.path) is not None:
        return snapshot("excluded")
    if row.size_bytes > MAX_CONTENT_BYTES:
        return snapshot("too_large")  # never opened
    try:
        data = _read_verified(root, row.path, row.sha256)
    except _Unavailable:
        return snapshot("unavailable")
    text = _decode(data)
    return snapshot("binary") if text is None else snapshot("text", text)


def iter_snapshot(root: Path, rows: Sequence[SnapshotRow]) -> Iterator[SnapshotFile]:
    """Each snapshot file in path order, read lazily (one file in memory at a time)."""
    for row in sorted(rows, key=lambda r: r.path):
        yield read_file(root, row)
