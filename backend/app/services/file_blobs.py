"""File contents kept in PostgreSQL, so a repository survives the loss of the server's disk.

Hosts without a persistent disk (Render's free plan) wipe DATA_DIR whenever the service
restarts, sleeps or redeploys, while the database keeps every repository and file row.
Ingestion therefore also stores each file's bytes here, zlib-compressed and keyed by SHA-256
(identical files are stored once), and ``app.services.file_store`` rebuilds a missing
repository folder from these rows. Every restored file is checked against its SHA-256.
"""

import hashlib
import zlib
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from sqlalchemy import and_, delete, exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models import File, FileBlob
from app.services.archive import ExtractedFile

COMPRESSION_LEVEL = 6
# One INSERT holds at most this many rows (3 parameters each, well under PostgreSQL's limit)
# and about this many uncompressed bytes, so memory stays bounded for large repositories.
BATCH_ROWS = 500
BATCH_BYTES = 16 * 1024 * 1024
LOAD_BATCH = 200
# Unreferenced contents are kept this long: an ingestion that reused a row but has not
# committed its files yet must not lose it.
UNUSED_AFTER = timedelta(hours=1)


class StoredContentError(Exception):
    """Stored contents are missing, corrupt or do not match their SHA-256."""


@dataclass(frozen=True)
class _Row:
    sha256: str
    size_bytes: int
    content: bytes


def compress(data: bytes) -> bytes:
    return zlib.compress(data, COMPRESSION_LEVEL)


def decompress(content: bytes, sha256: str, size_bytes: int) -> bytes:
    """The original bytes, or StoredContentError unless they have exactly the stored size and
    SHA-256. Decompression stops one byte past the expected size, so a corrupt or hostile
    row cannot expand without limit."""
    inflater = zlib.decompressobj()
    try:
        data = inflater.decompress(content, size_bytes + 1)
    except zlib.error:
        raise StoredContentError(f"stored content for {sha256} is corrupt") from None
    if len(data) != size_bytes or not inflater.eof or inflater.unconsumed_tail:
        raise StoredContentError(f"stored content for {sha256} has the wrong size")
    if hashlib.sha256(data).hexdigest() != sha256:
        raise StoredContentError(f"stored content for {sha256} does not match its hash")
    return data


def _batches(files: Sequence[ExtractedFile]) -> Iterator[list[ExtractedFile]]:
    """Distinct contents (by SHA-256) in batches bounded by row count and size."""
    seen: set[str] = set()
    batch: list[ExtractedFile] = []
    size = 0
    for f in files:
        if f.sha256 in seen:
            continue
        seen.add(f.sha256)
        if batch and (len(batch) >= BATCH_ROWS or size + f.size_bytes > BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(f)
        size += f.size_bytes
    if batch:
        yield batch


def _read_batch(root: Path, batch: list[ExtractedFile]) -> list[_Row]:
    rows = []
    for f in batch:
        data = (root / f.path).read_bytes()
        if len(data) != f.size_bytes:
            raise StoredContentError(f"{f.path} changed while it was being stored")
        rows.append(_Row(f.sha256, f.size_bytes, compress(data)))
    return rows


async def store_contents(db: AsyncSession, root: Path, files: Sequence[ExtractedFile]) -> None:
    """Store the bytes of ``files`` (extracted under ``root``) in the session's transaction.

    Contents already stored are reused and marked as used now, which keeps them from being
    collected while this ingestion is still in progress.
    """
    for batch in _batches(files):
        rows = await run_in_threadpool(_read_batch, root, batch)
        statement = insert(FileBlob).values(
            [{"sha256": r.sha256, "size_bytes": r.size_bytes, "content": r.content} for r in rows]
        )
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=[FileBlob.sha256], set_={"last_used_at": func.now()}
            )
        )


async def load_contents(db: AsyncSession, hashes: Sequence[str]) -> dict[str, tuple[int, bytes]]:
    """Stored (size_bytes, compressed content) by SHA-256 for one batch of at most LOAD_BATCH
    hashes; hashes without a stored row are left out."""
    if len(hashes) > LOAD_BATCH:
        raise ValueError(f"load at most {LOAD_BATCH} contents at a time")
    result = await db.execute(
        select(FileBlob.sha256, FileBlob.size_bytes, FileBlob.content).where(
            FileBlob.sha256.in_(list(hashes))
        )
    )
    return {row.sha256: (row.size_bytes, row.content) for row in result}


async def remove_unused_contents(db: AsyncSession) -> int:
    """Delete stored contents that no file refers to and nothing used recently; return how
    many rows were removed."""
    result = await db.execute(
        delete(FileBlob).where(
            and_(
                FileBlob.last_used_at < func.now() - UNUSED_AFTER,
                ~exists().where(File.sha256 == FileBlob.sha256),
            )
        )
    )
    await db.commit()
    return result.rowcount or 0
