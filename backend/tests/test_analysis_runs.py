"""Full-analysis run tests (phase 1 of the repository intelligence pipeline).

- Exclusions, the summary analyzer and the snapshot reader are tested without a database.
- API and worker tests run against the already-migrated throwaway test database
  (TEST_DATABASE_URL, "_test") inside rolled-back transactions; ingestion runs inline and
  full-analysis jobs are either recorded (left pending) or run inline with the real worker
  logic. DATA_DIR is a temporary directory.
"""

import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.analysis import runner, snapshot
from app.analysis.exclusions import excluded_directory, is_generated
from app.analysis.runner import (
    ALREADY_RUNNING,
    CHANGED_MESSAGE,
    INGESTION_IN_PROGRESS,
    INTERNAL_FAILURE_MESSAGE,
    NOT_READY,
    QUEUE_FAILURE_MESSAGE,
    RUN_NOT_FOUND,
    STALE_PENDING_MESSAGE,
    run_full_analysis_job,
)
from app.analysis.snapshot import SnapshotRow, read_file
from app.analysis.summary import SnapshotFile, summarize
from app.config import get_settings
from app.database import get_db
from app.main import app
from app.models import AnalysisJob, AnalysisJobStatus, AnalysisJobType, AnalysisRun
from app.services.file_content import MAX_CONTENT_BYTES
from app.services.job_cancellation import ANALYSIS_CANCELLED_MESSAGE
from app.workers import queue as queue_module
from app.workers.worker import analyze_repository
from tests.test_worker import _zip, install_inline_worker, install_recording_queue

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
requires_db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set TEST_DATABASE_URL to a dedicated, already-migrated test database",
)

PASSWORD = "test-only-Passw0rd!"
FILES: dict[str, bytes] = {
    "src/app.py": b"import os\n\n\ndef main():\n    return 1\n",
    "src/util.py": b"X = 1\n",
    "web/index.js": b"export const a = 1\n\nconsole.log(a)\n",
    "README.md": b"# Demo\n",
    "package-lock.json": b'{"lockfileVersion": 3}\n',
    "web/app.min.js": b"var a=1;\n",
    "node_modules/lib/index.js": b"module.exports = 1\n",
    "dist/bundle.js": b"console.log(1)\n",
    "logo.dat": b"a\x00b",
}
NOT_FOUND = {"detail": "Repository not found"}


# --- Exclusions and summary (no database) ------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "excluded"),
    [
        ("node_modules/react/index.js", "node_modules"),
        ("web/node_modules/x.js", "node_modules"),
        ("dist/app.js", "dist"),
        (".git/config", ".git"),
        ("backend/.venv/lib/site.py", ".venv"),
        ("src/build_tools.py", None),  # a file name, not a directory
        ("src/dist.py", None),
        ("docs/building/guide.md", None),
        ("main.py", None),
    ],
)
def test_excluded_directories(path: str, excluded: str | None) -> None:
    assert excluded_directory(path) == excluded


@pytest.mark.parametrize(
    ("path", "generated"),
    [
        ("package-lock.json", True),
        ("web/yarn.lock", True),
        ("poetry.lock", True),
        ("static/app.min.js", True),
        ("static/app.js.map", True),
        ("src/locker.py", False),
        ("package.json", False),
    ],
)
def test_generated_files(path: str, generated: bool) -> None:
    assert is_generated(path) is generated


def _file(
    path: str, text: str | None, language: str | None = "Python", status: str = "text"
) -> SnapshotFile:
    return SnapshotFile(path, language, len((text or "").encode()), status, text)


def test_summary_counts_languages_lines_and_skips() -> None:
    summary = summarize(
        [
            _file("a.py", "x = 1\n\ny = 2\n"),
            _file("b.py", "z = 3"),
            _file("c.js", "let a\n", "JavaScript"),
            _file("notes", "hello\n", None),
            _file("node_modules/x.js", "big\n", "JavaScript"),
            _file("package-lock.json", "{}\n", "JSON"),
            _file("img.dat", None, None, "binary"),
            _file("huge.txt", None, None, "too_large"),
            _file("gone.txt", None, None, "unavailable"),
        ]
    )
    assert summary.file_count == 9
    assert summary.excluded_file_count == 1
    assert summary.analyzed_file_count == 4
    assert summary.skipped == {"binary": 1, "too_large": 1, "unavailable": 1, "generated": 1}
    assert (summary.total_lines, summary.code_lines) == (6, 5)
    assert [entry["language"] for entry in summary.languages] == ["Python", "JavaScript", None]
    assert summary.languages[0] == {
        "language": "Python",
        "files": 2,
        "lines": 4,
        "code_lines": 3,
        "bytes": len(b"x = 1\n\ny = 2\n") + len(b"z = 3"),
    }


def test_summary_ties_sort_by_files_then_name_with_unknown_last() -> None:
    summary = summarize(
        [
            _file("u", "a\n", None),
            _file("b.rb", "a\n", "Ruby"),
            _file("a.go", "a\n", "Go"),
            _file("c.go", "", "Go"),
        ]
    )
    assert [e["language"] for e in summary.languages] == ["Go", "Ruby", None]


def test_empty_snapshot() -> None:
    summary = summarize([])
    assert (summary.file_count, summary.total_lines, summary.languages) == (0, 0, [])


def test_excluded_files_are_never_opened(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def must_not_read(*args: Any) -> bytes:
        raise AssertionError("excluded files must not be read")

    monkeypatch.setattr(snapshot, "_read_verified", must_not_read)
    row = SnapshotRow("node_modules/pkg/index.js", "JavaScript", 10, None)
    assert read_file(tmp_path, row).status == "excluded"
    big = SnapshotRow("big.txt", None, MAX_CONTENT_BYTES + 1, None)
    assert read_file(tmp_path, big).status == "too_large"


async def test_worker_task_rejects_non_uuid_payload() -> None:
    assert await analyze_repository({"session_factory": None}, "../../etc/passwd") == "invalid"


# --- Fixtures and helpers ----------------------------------------------------------------------


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
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "data"
    monkeypatch.setattr(get_settings(), "data_dir", path)
    return path


@pytest.fixture
async def client(db_session: AsyncSession, data_dir: Path) -> AsyncIterator[httpx.AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

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


def _repo_url(owner: Owner, repository_id: str | None = None) -> str:
    return (
        f"/api/v1/projects/{owner.project_id}/repositories/{repository_id or owner.repository_id}"
    )


def _runs_url(owner: Owner, repository_id: str | None = None) -> str:
    return f"{_repo_url(owner, repository_id)}/analysis-runs"


async def _new_repository(client: httpx.AsyncClient, owner: Owner, name: str = "") -> str:
    response = await client.post(
        f"/api/v1/projects/{owner.project_id}/repositories",
        json={"name": name or f"repo-{uuid.uuid4().hex[:8]}", "source_type": "zip"},
        headers=owner.headers,
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def _ingest(
    client: httpx.AsyncClient,
    owner: Owner,
    files: dict[str, bytes],
    repository_id: str | None = None,
) -> None:
    response = await client.post(
        f"{_repo_url(owner, repository_id)}/ingest",
        files={"file": ("repo.zip", _zip(files), "application/zip")},
        headers=owner.headers,
    )
    assert response.status_code == 202


async def _make_owner(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, session: AsyncSession, email: str
) -> Owner:
    assert (
        await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    ).status_code == 201
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    project = (await client.post("/api/v1/projects", json={"name": "Demo"}, headers=headers)).json()
    owner = Owner(headers, project["id"], "")
    owner.repository_id = await _new_repository(client, owner, "demo-repo")
    install_inline_worker(monkeypatch, session)
    await _ingest(client, owner, FILES)
    return owner


@pytest.fixture
async def alice(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> Owner:
    return await _make_owner(client, monkeypatch, db_session, "alice@example.com")


@pytest.fixture
async def bob(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> Owner:
    return await _make_owner(client, monkeypatch, db_session, "bob@example.com")


def inline_analysis(monkeypatch: pytest.MonkeyPatch, session: AsyncSession) -> list[str]:
    outcomes: list[str] = []

    async def enqueue_inline(job_id: uuid.UUID) -> None:
        outcomes.append(await run_full_analysis_job(session, job_id))

    monkeypatch.setattr(queue_module, "enqueue_full_analysis_job", enqueue_inline)
    return outcomes


def record_analysis(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    queued: list[str] = []

    async def enqueue_only(job_id: uuid.UUID) -> None:
        queued.append(str(job_id))

    monkeypatch.setattr(queue_module, "enqueue_full_analysis_job", enqueue_only)
    return queued


async def _job(db: AsyncSession, job_id: str | uuid.UUID) -> AnalysisJob:
    db.expire_all()
    job = await db.get(AnalysisJob, uuid.UUID(str(job_id)))
    assert job is not None
    return job


async def _runs(client: httpx.AsyncClient, owner: Owner) -> dict[str, Any]:
    response = await client.get(_runs_url(owner), headers=owner.headers)
    assert response.status_code == 200
    return dict(response.json())


# --- Running an analysis -------------------------------------------------------------------------


@requires_db
async def test_full_analysis_end_to_end(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    outcomes = inline_analysis(monkeypatch, db_session)
    started = await client.post(_runs_url(alice), headers=alice.headers)
    assert started.status_code == 202
    body = started.json()
    assert (body["repository_id"], body["status"]) == (alice.repository_id, "pending")
    assert outcomes == ["completed"]

    data = await _runs(client, alice)
    assert data["job"]["job_type"] == "full_analysis"
    assert (data["job"]["status"], data["job"]["progress"]) == ("completed", 100)
    (run,) = data["runs"]
    assert run["analysis_job_id"] == body["job_id"]
    assert run["file_count"] == len(FILES)
    assert run["excluded_file_count"] == 2  # node_modules/, dist/
    assert run["analyzed_file_count"] == 4  # two .py, index.js, README.md
    assert run["skipped"] == {"binary": 1, "too_large": 0, "unavailable": 0, "generated": 2}
    assert (run["total_lines"], run["code_lines"]) == (5 + 1 + 3 + 1, 3 + 1 + 2 + 1)
    assert [entry["language"] for entry in run["languages"]] == ["Python", "JavaScript", "Markdown"]
    assert run["total_bytes"] == sum(len(data_) for data_ in FILES.values())

    detail = await client.get(f"{_runs_url(alice)}/{run['id']}", headers=alice.headers)
    assert detail.status_code == 200
    assert detail.json() == run


@requires_db
async def test_history_keeps_earlier_runs_newest_first(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    inline_analysis(monkeypatch, db_session)
    await client.post(_runs_url(alice), headers=alice.headers)
    await _ingest(client, alice, {"only.py": b"a = 1\nb = 2\n"})  # re-ingest: a new snapshot
    await client.post(_runs_url(alice), headers=alice.headers)
    runs = (await _runs(client, alice))["runs"]
    assert [run["file_count"] for run in runs] == [1, len(FILES)]  # newest first, both kept
    assert runs[0]["total_lines"] == 2


@requires_db
async def test_repository_must_be_ready(
    client: httpx.AsyncClient, alice: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    record_analysis(monkeypatch)
    fresh = await _new_repository(client, alice)
    response = await client.post(_runs_url(alice, fresh), headers=alice.headers)
    assert (response.status_code, response.json()) == (409, {"detail": NOT_READY})

    install_recording_queue(monkeypatch)  # the next ingestion stays pending
    await _ingest(client, alice, {"a.py": b"x = 1\n"})
    response = await client.post(_runs_url(alice), headers=alice.headers)
    assert (response.status_code, response.json()) == (409, {"detail": INGESTION_IN_PROGRESS})


@requires_db
async def test_one_active_analysis_per_repository(
    client: httpx.AsyncClient, alice: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    queued = record_analysis(monkeypatch)
    assert (await client.post(_runs_url(alice), headers=alice.headers)).status_code == 202
    second = await client.post(_runs_url(alice), headers=alice.headers)
    assert (second.status_code, second.json()) == (409, {"detail": ALREADY_RUNNING})
    assert len(queued) == 1


@requires_db
async def test_queue_failure_fails_the_job(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    async def broken(job_id: uuid.UUID) -> None:
        raise ConnectionError("redis down")

    monkeypatch.setattr(queue_module, "enqueue_full_analysis_job", broken)
    response = await client.post(_runs_url(alice), headers=alice.headers)
    assert (response.status_code, response.json()) == (503, {"detail": QUEUE_FAILURE_MESSAGE})
    job = (await _runs(client, alice))["job"]
    assert (job["status"], job["error_message"]) == ("failed", QUEUE_FAILURE_MESSAGE)


@requires_db
async def test_stale_pending_job_is_recovered_on_start(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    queued = record_analysis(monkeypatch)
    await client.post(_runs_url(alice), headers=alice.headers)
    await db_session.execute(
        update(AnalysisJob)
        .where(AnalysisJob.id == uuid.UUID(queued[0]))
        .values(created_at=func.now() - runner.PENDING_STALE_AFTER - timedelta(minutes=1))
    )
    await db_session.commit()
    assert (await client.post(_runs_url(alice), headers=alice.headers)).status_code == 202
    stale = await _job(db_session, queued[0])
    assert (stale.status, stale.error_message) == (AnalysisJobStatus.FAILED, STALE_PENDING_MESSAGE)
    assert len(queued) == 2


@requires_db
async def test_pending_analysis_can_be_cancelled(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    queued = record_analysis(monkeypatch)
    await client.post(_runs_url(alice), headers=alice.headers)
    cancel = await client.post(f"{_repo_url(alice)}/jobs/{queued[0]}/cancel", headers=alice.headers)
    assert cancel.status_code == 200
    job = await _job(db_session, queued[0])
    assert (job.status, job.error_message) == (AnalysisJobStatus.FAILED, ANALYSIS_CANCELLED_MESSAGE)
    assert await run_full_analysis_job(db_session, job.id) == "skipped"  # never runs afterwards


# --- Worker edge cases ---------------------------------------------------------------------------


@requires_db
async def test_changed_snapshot_fails_without_a_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    async def replaced(db: AsyncSession, repository_id: uuid.UUID) -> set[uuid.UUID]:
        return {uuid.uuid4()}  # the files rows were replaced by a re-ingestion

    monkeypatch.setattr(runner, "_lock_current_snapshot", replaced)
    outcomes = inline_analysis(monkeypatch, db_session)
    started = await client.post(_runs_url(alice), headers=alice.headers)
    assert outcomes == ["failed"]
    job = await _job(db_session, started.json()["job_id"])
    assert (job.status, job.error_message) == (AnalysisJobStatus.FAILED, CHANGED_MESSAGE)
    assert (await _runs(client, alice))["runs"] == []


@requires_db
async def test_analyzer_errors_fail_with_a_fixed_message(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    def explode(root: Path, rows: list[SnapshotRow]) -> None:
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(runner, "analyze_snapshot", explode)
    outcomes = inline_analysis(monkeypatch, db_session)
    started = await client.post(_runs_url(alice), headers=alice.headers)
    assert outcomes == ["failed"]
    job = await _job(db_session, started.json()["job_id"])
    assert job.error_message == INTERNAL_FAILURE_MESSAGE
    assert "secret" not in (job.error_message or "")


@requires_db
async def test_job_finished_elsewhere_is_not_overwritten(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    queued = record_analysis(monkeypatch)
    await client.post(_runs_url(alice), headers=alice.headers)
    job_id = uuid.UUID(queued[0])
    real_lock = runner._lock_current_snapshot

    async def recovered_meanwhile(db: AsyncSession, repository_id: uuid.UUID) -> Any:
        # Another process (maintenance or a cancel) fails the job and commits.
        await db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(status=AnalysisJobStatus.FAILED, error_message="recovered")
        )
        await db.commit()
        return await real_lock(db, repository_id)

    monkeypatch.setattr(runner, "_lock_current_snapshot", recovered_meanwhile)
    assert await run_full_analysis_job(db_session, job_id) == "skipped"
    assert (await _job(db_session, job_id)).error_message == "recovered"
    count = await db_session.scalar(select(func.count(AnalysisRun.id)))
    assert count == 0


@requires_db
async def test_worker_ignores_missing_and_other_job_types(
    client: httpx.AsyncClient, alice: Owner, db_session: AsyncSession
) -> None:
    assert await run_full_analysis_job(db_session, uuid.uuid4()) == "missing"
    ingestion_job = await db_session.scalar(
        select(AnalysisJob.id).where(AnalysisJob.job_type == AnalysisJobType.INGESTION).limit(1)
    )
    assert ingestion_job is not None
    assert await run_full_analysis_job(db_session, ingestion_job) == "invalid"


# --- Ownership -------------------------------------------------------------------------------------


@requires_db
async def test_other_users_cannot_start_list_or_read_runs(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    inline_analysis(monkeypatch, db_session)
    await client.post(_runs_url(alice), headers=alice.headers)
    run_id = (await _runs(client, alice))["runs"][0]["id"]

    as_bob = {"headers": bob.headers}
    for response in (
        await client.post(_runs_url(alice), **as_bob),
        await client.get(_runs_url(alice), **as_bob),
        await client.get(f"{_runs_url(alice)}/{run_id}", **as_bob),
    ):
        assert (response.status_code, response.json()) == (404, NOT_FOUND)
    # A real run id under bob's own repository is not found either.
    cross = await client.get(f"{_runs_url(bob)}/{run_id}", headers=bob.headers)
    assert (cross.status_code, cross.json()) == (404, {"detail": RUN_NOT_FOUND})
    assert (await client.get(_runs_url(alice))).status_code == 401


# --- Dashboard ---------------------------------------------------------------------------------------


@requires_db
async def test_dashboard_totals_come_from_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    inline_analysis(monkeypatch, db_session)
    await client.post(_runs_url(bob), headers=bob.headers)  # bob's data must never appear
    second = await _new_repository(client, alice, "second-repo")
    await _ingest(client, alice, {"a.py": b"one = 1\n", "b.go": b"package main\n"}, second)
    await client.post(_runs_url(alice), headers=alice.headers)
    await client.post(_runs_url(alice, second), headers=alice.headers)
    await client.post(_runs_url(alice, second), headers=alice.headers)  # a newer run of it

    response = await client.get("/api/v1/dashboard", headers=alice.headers)
    assert response.status_code == 200
    data = response.json()
    assert (data["projects"], data["repositories"], data["ready_repositories"]) == (1, 2, 2)
    assert (data["analyzed_repositories"], data["total_runs"], data["active_jobs"]) == (2, 3, 0)
    assert data["analyzed_files"] == 4 + 2  # latest runs only, not the older duplicate
    assert data["code_lines"] == (3 + 1 + 2 + 1) + (1 + 1)
    by_language = {e["language"]: e for e in data["languages"]}
    assert by_language["Python"]["files"] == 3
    assert by_language["Go"]["code_lines"] == 1
    recent = data["recent_runs"]
    assert len(recent) == 3
    assert recent[0]["repository_name"] == "second-repo"
    assert {r["project_name"] for r in recent} == {"Demo"}
    assert (await client.get("/api/v1/dashboard")).status_code == 401


@requires_db
async def test_dashboard_for_a_new_user_is_empty(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register", json={"email": "new@example.com", "password": PASSWORD}
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "new@example.com", "password": PASSWORD}
    )
    response = await client.get(
        "/api/v1/dashboard", headers={"Authorization": f"Bearer {login.json()['access_token']}"}
    )
    assert response.json() == {
        "projects": 0,
        "repositories": 0,
        "ready_repositories": 0,
        "analyzed_repositories": 0,
        "total_runs": 0,
        "active_jobs": 0,
        "analyzed_files": 0,
        "code_lines": 0,
        "languages": [],
        "recent_runs": [],
    }
