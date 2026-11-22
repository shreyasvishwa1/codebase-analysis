"""Stored file contents: a repository survives the loss of the server's disk.

Hosts without a persistent disk (Render's free plan) wipe DATA_DIR on every restart, sleep
or redeploy while the database keeps the repository. Ingestion stores every file's bytes in
file_blobs, and the folder is rebuilt from them when it is missing, so a user never has to
upload the same ZIP again.

Unit tests need nothing; API tests use the dedicated throwaway database (TEST_DATABASE_URL,
name ending in "_test") inside a rolled-back transaction, with DATA_DIR in a temporary folder.
"""

import hashlib
import io
import os
import shutil
import uuid
import zipfile
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.analysis.runner import run_full_analysis_job
from app.config import get_settings
from app.database import get_db
from app.main import app
from app.models import File, FileBlob
from app.services import file_store
from app.services.archive import ExtractedFile
from app.services.file_blobs import (
    BATCH_ROWS,
    StoredContentError,
    _batches,
    compress,
    decompress,
    remove_unused_contents,
)
from app.services.maintenance import run_maintenance
from app.workers import queue as queue_module
from tests.test_worker import install_inline_worker

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
requires_db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set TEST_DATABASE_URL to a dedicated, already-migrated test database",
)
PASSWORD = "test-only-Passw0rd!"
UNAVAILABLE = {"detail": "File content is not available; try again later"}
FILES = {
    "src/app.py": b"print('hello')\n",
    "src/copy.py": b"print('hello')\n",  # same bytes: stored once
    "docs/readme.md": b"# Readme\n" * 50,
}


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- Unit tests --------------------------------------------------------------------------


def test_contents_round_trip_only_with_the_exact_size_and_hash() -> None:
    data = b"repository bytes\n" * 100
    assert decompress(compress(data), _sha(data), len(data)) == data
    with pytest.raises(StoredContentError, match="wrong size"):
        decompress(compress(data), _sha(data), len(data) - 1)
    with pytest.raises(StoredContentError, match="wrong size"):
        decompress(compress(data), _sha(data), len(data) + 1)
    with pytest.raises(StoredContentError, match="does not match"):
        decompress(compress(b"x" * len(data)), _sha(data), len(data))
    with pytest.raises(StoredContentError, match="corrupt"):
        decompress(b"not zlib", _sha(data), len(data))


def test_a_hostile_row_cannot_expand_past_its_stated_size() -> None:
    bomb = compress(b"\0" * 50_000_000)
    with pytest.raises(StoredContentError, match="wrong size"):
        decompress(bomb, _sha(b"tiny"), 4)


def test_batches_store_each_content_once_and_stay_bounded() -> None:
    def ef(path: str, data: bytes) -> ExtractedFile:
        return ExtractedFile(path, path.rsplit("/", 1)[-1], None, len(data), _sha(data))

    files = [ef(f"f{i}.txt", str(i % 3).encode()) for i in range(10)]
    assert [len(b) for b in _batches(files)] == [3]  # ten files, three distinct contents
    many = [ef(f"m{i}.txt", str(i).encode()) for i in range(BATCH_ROWS + 5)]
    assert [len(b) for b in _batches(many)] == [BATCH_ROWS, 5]


@pytest.mark.parametrize(
    "path",
    [
        "../escape.txt",
        "/etc/passwd",
        "a/../../b",
        "",
        "a//b",
        "./a",
        r"..\escape.py",
        r"a\..\..\b",
        "C:/x",
        "src/nul.txt",
    ],
)
def test_unsafe_stored_paths_are_refused(tmp_path: Path, path: str) -> None:
    with pytest.raises(StoredContentError, match="unsafe stored path"):
        file_store._safe_target(tmp_path, path)


def test_a_rebuilt_folder_never_replaces_one_that_appeared_meanwhile(tmp_path: Path) -> None:
    staging = tmp_path / ".staging"
    staging.mkdir()
    (staging / "a.txt").write_text("rebuilt")
    root = tmp_path / "repo"
    root.mkdir()
    (root / "a.txt").write_text("newer ingestion")
    assert file_store._install(staging, root) is False
    assert (root / "a.txt").read_text() == "newer ingestion"
    assert not staging.exists()

    staging.mkdir()
    (staging / "a.txt").write_text("rebuilt")
    shutil.rmtree(root)
    assert file_store._install(staging, root) is True
    assert (root / "a.txt").read_text() == "rebuilt"


# --- API tests ---------------------------------------------------------------------------


@pytest.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    assert TEST_DATABASE_URL
    url = make_url(TEST_DATABASE_URL)
    if not (url.database or "").endswith("_test"):
        pytest.fail("refusing to use TEST_DATABASE_URL: database name must end with '_test'")
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            session = AsyncSession(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            )
            try:
                yield session
            finally:
                await session.close()
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    path = tmp_path / "data"
    monkeypatch.setattr(get_settings(), "data_dir", path)
    monkeypatch.setattr(get_settings(), "dependency_lookups", False)  # no network
    yield path


@pytest.fixture
async def client(
    db_session: AsyncSession, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    install_inline_worker(monkeypatch, db_session)
    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


@dataclass
class Owner:
    headers: dict[str, str]
    project_id: str
    repository_id: str

    @property
    def base(self) -> str:
        return f"/api/v1/projects/{self.project_id}/repositories/{self.repository_id}"


@pytest.fixture
async def alice(client: httpx.AsyncClient) -> Owner:
    await client.post(
        "/api/v1/auth/register", json={"email": "alice@example.com", "password": PASSWORD}
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    project = (await client.post("/api/v1/projects", json={"name": "P"}, headers=headers)).json()
    repository = await client.post(
        f"/api/v1/projects/{project['id']}/repositories",
        json={"name": "repo", "source_type": "zip"},
        headers=headers,
    )
    owner = Owner(headers, project["id"], repository.json()["id"])
    await _ingest(client, owner, FILES)
    return owner


async def _ingest(client: httpx.AsyncClient, owner: Owner, files: dict[str, bytes]) -> None:
    response = await client.post(
        f"{owner.base}/ingest",
        files={"file": ("repo.zip", _zip(files), "application/zip")},
        headers=owner.headers,
    )
    assert response.status_code == 202, response.text


async def _content(client: httpx.AsyncClient, owner: Owner, path: str) -> httpx.Response:
    return await client.get(
        f"{owner.base}/files/content", params={"path": path}, headers=owner.headers
    )


def _storage(data_dir: Path, owner: Owner) -> Path:
    return data_dir / "repositories" / owner.repository_id


def _wipe_disk(data_dir: Path) -> None:
    """What Render's free plan does on a restart, sleep or redeploy."""
    shutil.rmtree(data_dir)


def _leftovers(data_dir: Path) -> list[str]:
    root = data_dir / "repositories"
    return sorted(p.name for p in root.iterdir() if p.name.startswith(".")) if root.exists() else []


async def _blobs(db: AsyncSession) -> dict[str, FileBlob]:
    db.expire_all()
    return {b.sha256: b for b in await db.scalars(select(FileBlob))}


@requires_db
async def test_ingestion_stores_every_file_once_compressed(
    db_session: AsyncSession, alice: Owner
) -> None:
    blobs = await _blobs(db_session)
    assert set(blobs) == {_sha(data) for data in FILES.values()}  # two paths share one row
    for data in FILES.values():
        blob = blobs[_sha(data)]
        assert blob.size_bytes == len(data)
        assert decompress(blob.content, blob.sha256, blob.size_bytes) == data
    readme = blobs[_sha(FILES["docs/readme.md"])]
    assert len(readme.content) < readme.size_bytes  # compressed


@requires_db
async def test_files_come_back_after_the_disk_is_reset_without_a_new_upload(
    client: httpx.AsyncClient, data_dir: Path, alice: Owner
) -> None:
    _wipe_disk(data_dir)
    response = await _content(client, alice, "src/app.py")
    assert (response.status_code, response.json()["content"]) == (200, "print('hello')\n")
    storage = _storage(data_dir, alice)
    for path, data in FILES.items():
        assert (storage / path).read_bytes() == data
    assert _leftovers(data_dir) == []
    tree = await client.get(f"{alice.base}/tree", headers=alice.headers)
    assert tree.status_code == 200


@requires_db
async def test_a_full_analysis_after_a_disk_reset_reads_the_restored_files(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    data_dir: Path,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outcomes: list[str] = []

    async def enqueue_inline(job_id: uuid.UUID) -> None:
        outcomes.append(await run_full_analysis_job(db_session, job_id))

    monkeypatch.setattr(queue_module, "enqueue_full_analysis_job", enqueue_inline)
    _wipe_disk(data_dir)
    response = await client.post(f"{alice.base}/analysis-runs", headers=alice.headers)
    assert response.status_code == 202, response.text
    assert outcomes == ["completed"]
    runs = (await client.get(f"{alice.base}/analysis-runs", headers=alice.headers)).json()["runs"]
    assert runs[0]["analyzed_file_count"] == len(FILES)  # every file was read back
    assert runs[0]["skipped"]["unavailable"] == 0
    assert (_storage(data_dir, alice) / "src/app.py").read_bytes() == FILES["src/app.py"]


@requires_db
async def test_corrupt_stored_content_is_never_installed(
    client: httpx.AsyncClient, db_session: AsyncSession, data_dir: Path, alice: Owner
) -> None:
    sha = _sha(FILES["src/app.py"])
    forged = b"print('evil!')\n"
    assert len(forged) == len(FILES["src/app.py"])  # right size, wrong hash
    await db_session.execute(
        update(FileBlob).where(FileBlob.sha256 == sha).values(content=compress(forged))
    )
    _wipe_disk(data_dir)
    response = await _content(client, alice, "docs/readme.md")
    assert (response.status_code, response.json()) == (409, UNAVAILABLE)
    assert not _storage(data_dir, alice).exists()
    assert _leftovers(data_dir) == []


@requires_db
async def test_repositories_stored_before_this_change_stay_unavailable(
    client: httpx.AsyncClient, db_session: AsyncSession, data_dir: Path, alice: Owner
) -> None:
    await db_session.execute(FileBlob.__table__.delete())
    _wipe_disk(data_dir)
    response = await _content(client, alice, "src/app.py")
    assert (response.status_code, response.json()) == (409, UNAVAILABLE)
    assert not _storage(data_dir, alice).exists()


@requires_db
async def test_an_unsafe_stored_path_stops_the_whole_restore(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    data_dir: Path,
    alice: Owner,
    tmp_path: Path,
) -> None:
    await db_session.execute(
        update(File)
        .where(File.repository_id == uuid.UUID(alice.repository_id), File.path == "src/copy.py")
        .values(path="../../escape.py")
    )
    _wipe_disk(data_dir)
    response = await _content(client, alice, "src/app.py")
    assert response.status_code == 409
    assert not _storage(data_dir, alice).exists()
    assert not any(p.name == "escape.py" for p in tmp_path.rglob("escape.py"))


@requires_db
async def test_an_existing_folder_is_used_as_it_is(
    client: httpx.AsyncClient, alice: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def no_restore(*args: object) -> None:
        raise AssertionError("an existing folder must not be rebuilt")

    monkeypatch.setattr(file_store, "_restore", no_restore)
    response = await _content(client, alice, "src/app.py")
    assert response.status_code == 200


@requires_db
async def test_uploading_again_reuses_stored_contents(
    client: httpx.AsyncClient, db_session: AsyncSession, alice: Owner
) -> None:
    before = await _blobs(db_session)
    await _ingest(client, alice, {**FILES, "new.txt": b"new\n"})
    after = await _blobs(db_session)
    assert set(after) == set(before) | {_sha(b"new\n")}


@requires_db
async def test_uploading_again_marks_reused_contents_as_used_now(
    client: httpx.AsyncClient, db_session: AsyncSession, alice: Owner
) -> None:
    """An ingestion that reuses stored contents refreshes them, so maintenance cannot remove
    a row that a just-committed (or still running) ingestion depends on."""
    sha = _sha(FILES["src/app.py"])
    await db_session.execute(update(FileBlob).values(last_used_at=func.now() - timedelta(hours=2)))
    stale = (await _blobs(db_session))[sha].last_used_at
    await _ingest(client, alice, FILES)
    assert (await _blobs(db_session))[sha].last_used_at > stale


@requires_db
async def test_maintenance_removes_only_old_unused_contents(
    db_session: AsyncSession, alice: Owner
) -> None:
    old = func.now() - timedelta(hours=2)
    db_session.add_all(
        [
            FileBlob(sha256="a" * 64, size_bytes=1, content=compress(b"a")),
            FileBlob(sha256="b" * 64, size_bytes=1, content=compress(b"b")),
        ]
    )
    await db_session.flush()
    await db_session.execute(
        update(FileBlob).where(FileBlob.sha256 == "a" * 64).values(last_used_at=old)
    )
    # Used by a file, but not stored recently: kept.
    await db_session.execute(
        update(FileBlob)
        .where(FileBlob.sha256 == _sha(FILES["src/app.py"]))
        .values(last_used_at=old)
    )
    report = await run_maintenance(db_session)
    assert report.contents_removed == 1
    remaining = set(await _blobs(db_session))
    assert "a" * 64 not in remaining  # unused and old: removed
    assert "b" * 64 in remaining  # unused but recent: an ingestion may still need it
    assert {_sha(d) for d in FILES.values()} <= remaining
    assert await remove_unused_contents(db_session) == 0


@requires_db
async def test_deleting_a_repository_lets_maintenance_free_its_contents(
    client: httpx.AsyncClient, db_session: AsyncSession, alice: Owner
) -> None:
    deleted = await client.delete(alice.base, headers=alice.headers)
    assert deleted.status_code == 204
    await db_session.execute(update(FileBlob).values(last_used_at=func.now() - timedelta(hours=2)))
    assert await remove_unused_contents(db_session) == len({_sha(d) for d in FILES.values()})
    assert await _blobs(db_session) == {}


# --- Storage status (shown on the repository page) -----------------------------------------


async def _storage_state(client: httpx.AsyncClient, owner: Owner) -> httpx.Response:
    return await client.get(f"{owner.base}/storage", headers=owner.headers)


@requires_db
async def test_storage_status_is_available_and_opening_a_repository_restores_it(
    client: httpx.AsyncClient, data_dir: Path, alice: Owner
) -> None:
    assert (await _storage_state(client, alice)).json() == {"files": "available"}
    _wipe_disk(data_dir)
    response = await _storage_state(client, alice)
    assert (response.status_code, response.json()) == (200, {"files": "available"})
    assert (_storage(data_dir, alice) / "src/app.py").read_bytes() == FILES["src/app.py"]


@requires_db
async def test_storage_status_says_missing_when_nothing_can_be_restored(
    client: httpx.AsyncClient, db_session: AsyncSession, data_dir: Path, alice: Owner
) -> None:
    await db_session.execute(FileBlob.__table__.delete())
    _wipe_disk(data_dir)
    assert (await _storage_state(client, alice)).json() == {"files": "missing"}


@requires_db
async def test_storage_status_before_any_import_and_for_an_empty_repository(
    client: httpx.AsyncClient, data_dir: Path, alice: Owner
) -> None:
    created = await client.post(
        f"/api/v1/projects/{alice.project_id}/repositories",
        json={"name": "empty", "source_type": "zip"},
        headers=alice.headers,
    )
    empty = Owner(alice.headers, alice.project_id, created.json()["id"])
    assert (await _storage_state(client, empty)).json() == {"files": "none"}
    await _ingest(client, empty, {})
    _wipe_disk(data_dir)
    assert (await _storage_state(client, empty)).json() == {"files": "available"}


@requires_db
async def test_storage_status_of_another_users_repository_is_not_found(
    client: httpx.AsyncClient, alice: Owner
) -> None:
    await client.post(
        "/api/v1/auth/register", json={"email": "bob@example.com", "password": PASSWORD}
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "bob@example.com", "password": PASSWORD}
    )
    bob_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    response = await client.get(f"{alice.base}/storage", headers=bob_headers)
    assert (response.status_code, response.json()) == (404, {"detail": "Repository not found"})
    assert (await client.get(f"{alice.base}/storage")).status_code == 401
