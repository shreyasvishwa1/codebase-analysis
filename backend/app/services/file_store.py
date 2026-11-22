"""The repository folder on disk, rebuilt from the database when the server's disk was reset.

Every feature that reads repository files asks ``repository_files_dir`` for the folder. While
it exists (the normal case) that costs one directory check. When it is missing, for example
after Render's free plan wiped the disk on a restart, sleep or redeploy, the folder is rebuilt
from the stored contents (``app.services.file_blobs``) of the repository's current file rows:

- every file is checked against its stored size and SHA-256 before it is written;
- paths are re-checked to stay inside the folder;
- the rebuild happens in a staging directory that replaces the missing folder in one rename,
  so a reader never sees half a repository, and a folder that appeared meanwhile (another
  process restored it, or a new ingestion was swapped in) is never replaced.

If nothing can be restored (no file rows, or contents stored before this existed), nothing is
created and the callers report the files as unavailable, exactly as before.
"""

import asyncio
import logging
import os
import shutil
import uuid
from collections import defaultdict
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.models import File
from app.services.archive import ArchiveError, normalize_member_path
from app.services.file_blobs import LOAD_BATCH, StoredContentError, decompress, load_contents
from app.services.ingestion import new_staging_dir, repository_storage_dir

logger = logging.getLogger(__name__)

# One rebuild at a time per repository within a process; across processes (the API and the
# worker) the final rename decides, and the loser discards its copy.
_locks: defaultdict[uuid.UUID, asyncio.Lock] = defaultdict(asyncio.Lock)


async def repository_files_dir(db: AsyncSession, repository_id: uuid.UUID) -> Path:
    """The repository's folder of stored files, rebuilt first if it is missing.

    Callers handle a folder that still does not exist (nothing could be restored) the same
    way as before: those files are reported as unavailable.
    """
    root = repository_storage_dir(get_settings(), repository_id)
    if await run_in_threadpool(_exists, root):
        return root
    async with _locks[repository_id]:
        if not await run_in_threadpool(_exists, root):
            await _restore(db, repository_id, root)
    return root


def _exists(path: Path) -> bool:
    return os.path.lexists(path)


def _safe_target(staging: Path, path: str) -> Path:
    """Where ``path`` goes under ``staging``. The path must be exactly what ingestion's own
    validation produces (relative, canonical, no "..", backslash, drive or reserved name)."""
    try:
        canonical = normalize_member_path(path)
    except ArchiveError:
        canonical = None
    if canonical != path:
        raise StoredContentError(f"unsafe stored path {path!r}")
    return staging.joinpath(*PurePosixPath(path).parts)


def _write_files(staging: Path, files: list[tuple[str, bytes]]) -> None:
    for path, data in files:
        target = _safe_target(staging, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "xb") as out:  # never overwrites (duplicate paths cannot exist)
            out.write(data)


def _install(staging: Path, root: Path) -> bool:
    """Move the rebuilt folder into place unless a folder appeared meanwhile."""
    if os.path.lexists(root):
        shutil.rmtree(staging, ignore_errors=True)
        return False
    try:
        os.rename(staging, root)  # fails rather than replacing a folder created just now
    except OSError:
        shutil.rmtree(staging, ignore_errors=True)
        if os.path.lexists(root):
            return False
        raise
    return True


async def _restore(db: AsyncSession, repository_id: uuid.UUID, root: Path) -> None:
    rows = (
        await db.execute(
            select(File.path, File.size_bytes, File.sha256).where(
                File.repository_id == repository_id
            )
        )
    ).all()
    if not rows or any(row.sha256 is None for row in rows):
        return
    paths_by_hash: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        paths_by_hash[row.sha256].append(row.path)
    hashes = sorted(paths_by_hash)

    settings = get_settings()
    staging = await run_in_threadpool(new_staging_dir, settings, repository_id)
    try:
        for start in range(0, len(hashes), LOAD_BATCH):
            chunk = hashes[start : start + LOAD_BATCH]
            stored = await load_contents(db, chunk)
            files: list[tuple[str, bytes]] = []
            for sha256 in chunk:
                if sha256 not in stored:
                    raise StoredContentError(f"no stored content for {sha256}")
                size_bytes, content = stored[sha256]
                data = decompress(content, sha256, size_bytes)
                files.extend((path, data) for path in paths_by_hash[sha256])
            await run_in_threadpool(_write_files, staging, files)
        installed = await run_in_threadpool(_install, staging, root)
    except (StoredContentError, OSError) as exc:
        await run_in_threadpool(shutil.rmtree, staging, True)
        logger.warning("repository %s files could not be restored: %s", repository_id, exc)
        return
    if installed:
        logger.info(
            "repository %s files restored from the database (%d files)", repository_id, len(rows)
        )
