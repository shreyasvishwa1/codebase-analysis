"""PDF reports and the analysis history (Module 10).

- Unit tests: text escaping, file names, colors and the PDF builder on full and empty data
  (built without compression, so the drawn text can be searched in the file).
- Database and API tests reuse the full-analysis fixtures (the throwaway test database inside
  rolled-back transactions).
"""

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes import reports as reports_module
from app.api.v1.routes.reports import REPORT_LIMIT, REPORT_NOT_FOUND, TOO_MANY_REPORTS, filename_of
from app.main import app
from app.models import AnalysisRun, GeneratedReport
from app.reports import data as data_module
from app.reports.data import ReportData, gather
from app.reports.pdf import build_pdf, score_color, severity_label, text
from app.services.rate_limit import Limit, RateLimiter, get_rate_limiter
from tests import test_analysis_runs as runs_tests
from tests.test_analysis_runs import (
    FILES,
    Owner,
    _ingest,
    _new_repository,
    _runs,
    _runs_url,
    inline_analysis,
    requires_db,
)
from tests.test_chat import CHAT_FILES

# The full-analysis fixtures, shared (assigned, so pytest registers them in this module).
db_session = runs_tests.db_session
data_dir = runs_tests.data_dir
client = runs_tests.client
alice = runs_tests.alice
bob = runs_tests.bob

HOSTILE = '<b>bold</b> & <link href="x">y</link> </para>'

# --- Text and names -------------------------------------------------------------------------------


def test_text_is_escaped_and_printable() -> None:
    assert text(HOSTILE) == (
        '&lt;b&gt;bold&lt;/b&gt; &amp; &lt;link href="x"&gt;y&lt;/link&gt; &lt;/para&gt;'
    )
    assert text("a\tb\x00c\nd") == "a b c<br/>d"
    assert text("cafe ↔ 漢字 é") == "cafe ? ?? é"  # outside Windows-1252
    assert text("abcdefghij", 5) == "abcd…"
    assert text(None) == "" and text(42) == "42"


def test_file_names() -> None:
    when = datetime(2026, 11, 18, 9, 5, tzinfo=UTC)
    assert filename_of("Shop API (v2)", when) == "shop-api-v2-report-20261118-0905.pdf"
    assert filename_of("漢字", when) == "repository-report-20261118-0905.pdf"
    assert filename_of("x" * 100, when) == "x" * 60 + "-report-20261118-0905.pdf"


def test_colors() -> None:
    assert [score_color(s).hexval() for s in (85, 84, 70, 69, 55, 54, 40, 39, None)] == [
        "0x059669", "0x65a30d", "0x65a30d", "0xca8a04", "0xca8a04", "0xea580c", "0xea580c",
        "0xdc2626", "0x94a3b8",
    ]  # fmt: skip
    assert severity_label("critical") == '<font color="#b91c1c"><b>critical</b></font>'
    assert severity_label("odd<") == '<font color="#64748b"><b>odd&lt;</b></font>'


# --- The PDF --------------------------------------------------------------------------------------

WHEN = datetime(2026, 11, 18, 10, 0, tzinfo=UTC)


def _data(**overrides: Any) -> ReportData:
    values: dict[str, Any] = {
        "repository": "shop",
        "project": "Demo",
        "run_id": uuid.UUID(int=1),
        "analyzed_at": WHEN,
        "generated_at": WHEN,
        "file_count": 12,
        "analyzed_file_count": 10,
        "excluded_file_count": 2,
        "total_lines": 400,
        "code_lines": 300,
        "languages": [
            {"language": "Python", "files": 8, "code_lines": 250},
            {"language": None, "files": 2, "code_lines": 50},
        ],
    }
    return ReportData(**(values | overrides))


FULL = dict(
    health={
        "overall": 61,
        "grade": "C",
        "dimensions": [
            {"key": "security", "name": "Security", "score": 36, "weight": 25, "explanation": "Security explanation", "improvements": ["Fix the critical finding."]},
            {"key": "dependencies", "name": "Dependency health", "score": None, "weight": 15, "explanation": "Not looked up.", "improvements": []},
        ],
    },
    security={"findings": 40, "by_severity": {"critical": 1, "high": 2, "medium": 3, "low": 34}, "by_confidence": {"confirmed": 30, "potential": 10}, "by_owasp": {"A02": 1, "A03": 0}, "bandit": "completed"},
    findings=[{"severity": "critical", "confidence": "confirmed", "title": HOSTILE, "owasp": "A02", "cwe": 798, "path": "app/settings.py", "line": 3, "recommendation": "Rotate the key."}],
    quality={"issues": 7, "files_analyzed": 9, "ruff": "completed", "by_severity": {"high": 1, "medium": 2, "low": 3, "info": 1}, "by_category": {"style": 4, "bug_risk": 3}, "duplication": {"percent": 4.5}, "top_files": [{"path": "app/views.py", "issues": 5}]},
    issues=[{"severity": "high", "category": "bug_risk", "rule_id": "F821", "path": "app/views.py", "line": 9, "message": "Undefined name `foo`"}],
    complexity={"functions": 50, "files_measured": 9, "average_cyclomatic": 3.2, "max_cyclomatic": 31, "maintainability_index": 48.5, "functions_by_rank": {"low": 45, "medium": 4, "high": 1}, "files_by_maintainability": {"good": 7, "moderate": 1, "poor": 1}},
    functions=[{"name": "process_order", "path": "app/orders.py", "line": 40, "cyclomatic": 31, "nloc": 120, "rank": "high"}],
    poor_files=[{"path": "app/legacy.py", "maintainability_index": 4.2, "nloc": 900}],
    dependencies={"dependencies": 6, "manifests": {"parsed": 2}, "vulnerable_dependencies": 1, "vulnerabilities": 2, "updates": {"major": 1, "minor": 2}, "lookups": {"registry": "completed", "osv": "completed"}, "conflicts": [{"name": "requests"}]},
    vulnerable=[{"name": "flask", "ecosystem": "python", "manifest": "requirements.txt", "line": 2, "specifier": "==2.0.1", "version": "2.0.1", "latest_version": "3.1.0", "update": "major", "vulnerability_count": 2, "max_severity": "high", "fixed_in": "2.2.5", "ids": ["GHSA-m2qf-hxjv-5gpq"]}],
    outdated=[{"name": "django", "ecosystem": "python", "manifest": "requirements.txt", "line": 3, "specifier": ">=3", "version": None, "latest_version": "5.2", "update": "major", "vulnerability_count": 0, "max_severity": None, "fixed_in": None, "ids": []}],
    architecture={"components": 4, "edges": 3, "imports": 9, "routes": 2, "entry_points": 1, "cycles": 1, "technologies": ["FastAPI", "React"], "data_stores": ["PostgreSQL"]},
    document={"cycles": [["app/api", "app/services"]], "observations": [{"title": "Circular dependency", "detail": "2 components import each other.", "evidence": [{"path": "app/api/routes.py", "line": 2}]}], "entry_points": [{"kind": "web application", "path": "app/main.py", "line": 4, "detail": "FastAPI application"}]},
)  # fmt: skip


def drawn(pdf: bytes) -> str:
    """The text drawn by an uncompressed PDF's Tj operators, in order (ReportLab splits a
    line into several strings, for example at hyphens and tags)."""
    pieces = re.findall(rb"\(((?:\\.|[^\\)])*)\) Tj", pdf)
    out = []
    for piece in pieces:
        piece = re.sub(rb"\\([0-7]{3})", lambda m: bytes([int(m.group(1), 8)]), piece)
        out.append(re.sub(rb"\\([()\\])", rb"\1", piece).decode("cp1252"))
    return "".join(out)


def test_full_report() -> None:
    built = build_pdf(_data(**FULL), compress=False)
    pdf = built.content
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert built.pages >= 3 and pdf.count(b"/Type /Page\n") == built.pages
    shown = drawn(pdf)
    for expected in (
        "Repository analysis report",
        "Code health score, grade C",
        "Most severe findings",
        "Rotate the key.",
        "process_order",
        "Files with a poor maintainability index",
        "GHSA-m2qf-hxjv-5gpq",
        "Circular dependency",
        "app/api <-> app/services",
        "it cannot show that",
        "Vulnerable dependencies",
        "Python",
        "Other",
    ):
        assert expected in shown, expected
    assert f"Page 1 of {built.pages}".encode() in pdf  # drawn on the canvas, outside Tj runs
    # Repository text is drawn as text: the tags in HOSTILE are not formatting.
    assert '<b>bold</b> & <link href="x">y</link></para>' in shown
    assert "Security: Fix the critical finding." in shown  # after a bullet (ReportLab code 127)
    assert pdf.count(b"(not scored) Tj") == 2  # the table cell and the bar label


def test_report_of_a_run_without_results() -> None:
    built = build_pdf(_data(languages=[]), compress=False)
    for drawn in (
        b"This run was stored before the analyses the score uses.",
        b"This run was stored before security analysis existed.",
        b"This run was stored before code-quality analysis existed.",
        b"This run was stored before complexity analysis existed.",
        b"This run was stored before dependency analysis existed.",
        b"This run was stored before architecture analysis existed.",
    ):
        assert drawn in built.content, drawn
    assert built.pages == 2  # the overview and one page of sections
    assert build_pdf(_data()).content.startswith(b"%PDF-")  # compressed by default


def test_lists_say_when_they_are_shortened() -> None:
    pdf = build_pdf(_data(**FULL), compress=False).content
    assert b"The 1 most important of 40 findings are listed." in pdf
    assert b"The 1 most important of 7 issues are listed." in pdf
    assert b"All 1 files are listed." in pdf  # the one poor file: the list is complete
    lookups_off = FULL["dependencies"] | {"lookups": {"registry": "disabled", "osv": "disabled"}}  # type: ignore[operator]
    off = build_pdf(
        _data(**(FULL | {"dependencies": lookups_off, "vulnerable": []})), compress=False
    ).content
    assert b"Vulnerabilities were not looked up for this run, so none are listed." in off


# --- Gathering and the API (database) ------------------------------------------------------------


async def _analyzed(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = CHAT_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


def _create_url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/reports"


@requires_db
async def test_gather_orders_and_bounds_the_lists(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    from app.analysis.health import DEFAULT_WEIGHTS

    run_id = uuid.UUID((await _analyzed(client, alice, monkeypatch, db_session))["id"])
    run = await db_session.get(AnalysisRun, run_id)
    assert run is not None
    data = await gather(db_session, run, "demo-repo", "Demo", DEFAULT_WEIGHTS, WHEN)
    assert (data.repository, data.project, data.run_id, data.generated_at) == (
        "demo-repo",
        "Demo",
        run_id,
        WHEN,
    )
    assert data.code_lines == run.code_lines and data.analyzed_at == run.created_at
    assert data.health is not None and data.health["overall"] is not None
    assert [d["key"] for d in data.health["dimensions"]][0] == "security"
    assert all(d["weight"] == DEFAULT_WEIGHTS[d["key"]] for d in data.health["dimensions"])
    assert data.findings[0]["severity"] == "critical"
    assert data.findings[0]["path"] == "app/auth.py"  # the masked AWS key
    order = ["critical", "high", "medium", "low"]
    assert [order.index(f["severity"]) for f in data.findings] == sorted(
        order.index(f["severity"]) for f in data.findings
    )
    assert data.document is not None and "observations" in data.document
    assert data.security == run.security and data.dependencies == run.dependencies
    # The user's weights decide the score in the report.
    custom = dict.fromkeys(DEFAULT_WEIGHTS, 0) | {"architecture": 1}
    weighted = await gather(db_session, run, "r", "p", custom, WHEN)
    assert weighted.health is not None
    assert {d["key"]: d["weight"] for d in weighted.health["dimensions"]} == custom
    architecture = next(d for d in weighted.health["dimensions"] if d["key"] == "architecture")
    assert weighted.health["overall"] == architecture["score"]
    monkeypatch.setattr(data_module, "TOP_FINDINGS", 1)
    assert len((await gather(db_session, run, "r", "p", DEFAULT_WEIGHTS, WHEN)).findings) == 1
    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == run_id).values(quality=None, security=None)
    )
    db_session.expire_all()
    run = await db_session.get(AnalysisRun, run_id)
    assert run is not None
    older = await gather(db_session, run, "r", "p", DEFAULT_WEIGHTS, WHEN)
    assert (older.health, older.security, older.findings, older.issues) == (None, None, [], [])


@requires_db
async def test_reports_are_created_downloaded_listed_and_deleted(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed(client, alice, monkeypatch, db_session)
    response = await client.post(_create_url(alice, run["id"]), headers=alice.headers)
    assert response.status_code == 201
    report = response.json()
    assert (report["repository_name"], report["project_name"], report["run_id"], report["run_created_at"]) == (
        "demo-repo", "Demo", run["id"], run["created_at"],
    )  # fmt: skip
    assert report["filename"].startswith("demo-repo-report-") and report["filename"].endswith(
        ".pdf"
    )
    assert report["pages"] >= 3
    download = await client.get(f"/api/v1/reports/{report['id']}/download", headers=alice.headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers["content-disposition"] == f'attachment; filename="{report["filename"]}"'
    assert (download.headers["cache-control"], download.headers["x-content-type-options"]) == (
        "no-store",
        "nosniff",
    )
    assert download.content.startswith(b"%PDF-")
    assert (len(download.content), hashlib.sha256(download.content).hexdigest()) == (
        report["size_bytes"],
        report["sha256"],
    )

    listed = (await client.get("/api/v1/reports", headers=alice.headers)).json()["reports"]
    assert [r["id"] for r in listed] == [report["id"]]
    other = await _new_repository(client, alice, "other")
    assert (
        await client.get(f"/api/v1/reports?repository_id={other}", headers=alice.headers)
    ).json() == {"reports": []}
    same = (
        await client.get(
            f"/api/v1/reports?repository_id={alice.repository_id}", headers=alice.headers
        )
    ).json()
    assert [r["id"] for r in same["reports"]] == [report["id"]]
    second = (await client.post(_create_url(alice, run["id"]), headers=alice.headers)).json()
    assert second["created_at"] > report["created_at"]  # wall-clock times, even in one transaction
    assert [
        r["id"]
        for r in (await client.get("/api/v1/reports", headers=alice.headers)).json()["reports"]
    ] == [second["id"], report["id"]]

    deleted = await client.delete(f"/api/v1/reports/{report['id']}", headers=alice.headers)
    assert (deleted.status_code, deleted.content) == (204, b"")
    gone = await client.get(f"/api/v1/reports/{report['id']}/download", headers=alice.headers)
    assert (gone.status_code, gone.json()) == (404, {"detail": REPORT_NOT_FOUND})
    assert (
        await client.delete(f"/api/v1/reports/{report['id']}", headers=alice.headers)
    ).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(GeneratedReport)) == 1


@requires_db
async def test_reports_of_older_runs(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed(client, alice, monkeypatch, db_session, FILES)
    await db_session.execute(
        update(AnalysisRun)
        .where(AnalysisRun.id == uuid.UUID(run["id"]))
        .values(
            quality=None,
            security=None,
            complexity=None,
            dependencies=None,
            architecture=None,
            chat_index=None,
        )
    )
    db_session.expire_all()
    response = await client.post(_create_url(alice, run["id"]), headers=alice.headers)
    assert response.status_code == 201 and response.json()["pages"] == 2


@requires_db
async def test_reports_are_private(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed(client, alice, monkeypatch, db_session)
    report = (await client.post(_create_url(alice, run["id"]), headers=alice.headers)).json()
    for method, path in (
        ("POST", _create_url(alice, run["id"])),
        ("GET", "/api/v1/reports"),
        ("GET", f"/api/v1/reports/{report['id']}/download"),
        ("DELETE", f"/api/v1/reports/{report['id']}"),
        ("GET", "/api/v1/analysis-history"),
    ):
        assert (await client.request(method, path)).status_code == 401
    as_bob = await client.post(_create_url(alice, run["id"]), headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    via_bob = await client.post(_create_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    for method, path in (
        ("GET", f"/api/v1/reports/{report['id']}/download"),
        ("DELETE", f"/api/v1/reports/{report['id']}"),
    ):
        response = await client.request(method, path, headers=bob.headers)
        assert (response.status_code, response.json()) == (404, {"detail": REPORT_NOT_FOUND})
    assert (await client.get("/api/v1/reports", headers=bob.headers)).json() == {"reports": []}
    assert (await client.get("/api/v1/analysis-history", headers=bob.headers)).json() == {
        "entries": [],
        "total": 0,
    }
    assert await db_session.scalar(select(func.count()).select_from(GeneratedReport)) == 1


class RecordingLimiter(RateLimiter):
    def __init__(self, refuse: bool = False) -> None:
        super().__init__(None)
        self.hits: list[tuple[Limit, str]] = []
        self.refuse = refuse

    async def hit(self, limit: Limit, value: str) -> None:
        self.hits.append((limit, value))
        if self.refuse:
            raise HTTPException(status_code=429, detail="Too many requests")


@requires_db
async def test_reports_are_limited(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed(client, alice, monkeypatch, db_session)
    limiter = RecordingLimiter()
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    assert (
        await client.post(_create_url(alice, run["id"]), headers=alice.headers)
    ).status_code == 201
    me = (await client.get("/api/v1/auth/me", headers=alice.headers)).json()
    assert limiter.hits == [(REPORT_LIMIT, me["id"])]
    assert (REPORT_LIMIT.max_requests, REPORT_LIMIT.window_seconds) == (10, 3600)
    app.dependency_overrides[get_rate_limiter] = lambda: RecordingLimiter(refuse=True)
    assert (
        await client.post(_create_url(alice, run["id"]), headers=alice.headers)
    ).status_code == 429
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    monkeypatch.setattr(reports_module, "MAX_REPORTS", 1)
    full = await client.post(_create_url(alice, run["id"]), headers=alice.headers)
    assert (full.status_code, full.json()) == (409, {"detail": TOO_MANY_REPORTS})
    assert len(limiter.hits) == 1  # refused before counting
    assert await db_session.scalar(select(func.count()).select_from(GeneratedReport)) == 1


@requires_db
async def test_analysis_history(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    assert (await client.get("/api/v1/analysis-history", headers=alice.headers)).json() == {
        "entries": [],
        "total": 0,
    }
    first = await _analyzed(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed(client, alice, monkeypatch, db_session)
    await client.post(_create_url(alice, latest["id"]), headers=alice.headers)
    other = await _new_repository(client, alice, "other")
    await _ingest(client, alice, FILES, other)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(alice, other), headers=alice.headers)).status_code == 202
    assert outcomes[-1] == "completed"

    history = (await client.get("/api/v1/analysis-history", headers=alice.headers)).json()
    assert history["total"] == 3
    newest, middle, oldest = history["entries"]
    assert newest["repository_id"] == other and newest["repository_name"] == "other"
    assert (middle["run_id"], oldest["run_id"]) == (latest["id"], first["id"])
    health = (
        await client.get(f"{_runs_url(alice)}/{latest['id']}/health", headers=alice.headers)
    ).json()
    security = latest["security"]
    assert middle == {
        "run_id": latest["id"],
        "project_id": alice.project_id,
        "project_name": "Demo",
        "repository_id": alice.repository_id,
        "repository_name": "demo-repo",
        "created_at": latest["created_at"],
        "analyzed_file_count": latest["analyzed_file_count"],
        "code_lines": latest["code_lines"],
        "overall": health["overall"],
        "grade": health["grade"],
        "security_findings": security["findings"],
        "critical_findings": security["by_severity"]["critical"],
        "high_findings": security["by_severity"]["high"],
        "quality_issues": latest["quality"]["issues"],
        "complex_functions": latest["complexity"]["functions_by_rank"]["high"],
        "vulnerable_dependencies": latest["dependencies"]["vulnerable_dependencies"],
        "chat_ready": True,
        "reports": 1,
    }
    assert oldest["reports"] == 0
    filtered = (
        await client.get(
            f"/api/v1/analysis-history?repository_id={alice.repository_id}&limit=1",
            headers=alice.headers,
        )
    ).json()
    assert (filtered["total"], [e["run_id"] for e in filtered["entries"]]) == (2, [latest["id"]])
    await db_session.execute(
        update(AnalysisRun)
        .where(AnalysisRun.id == uuid.UUID(first["id"]))
        .values(quality=None, security=None, complexity=None, dependencies=None, chat_index=None)
    )
    db_session.expire_all()
    old = (await client.get("/api/v1/analysis-history", headers=alice.headers)).json()["entries"][2]
    assert (old["overall"], old["grade"], old["security_findings"], old["critical_findings"]) == (
        None,
        None,
        None,
        None,
    )
    assert (
        old["quality_issues"],
        old["complex_functions"],
        old["vulnerable_dependencies"],
        old["chat_ready"],
    ) == (None, None, None, False)
    for limit in (0, 201):
        assert (
            await client.get(f"/api/v1/analysis-history?limit={limit}", headers=alice.headers)
        ).status_code == 422
