"""Code-quality analysis tests (phase 2: Module 3).

- Rule classification, duplicate detection, the Ruff runner and the quality analyzer are
  tested without a database (Ruff really runs, on temporary directories).
- API tests reuse the full-analysis fixtures: the throwaway test database (TEST_DATABASE_URL,
  "_test") inside rolled-back transactions, inline ingestion and inline analysis jobs.
"""

import subprocess
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.quality import analyzer as analyzer_module
from app.analysis.quality import duplication, ruff_runner
from app.analysis.quality.analyzer import QualityAnalyzer
from app.analysis.quality.duplication import DuplicationDetector, significant_lines
from app.analysis.quality.rules import OWN_RULES, RULES, ruff_rule
from app.analysis.summary import SnapshotFile
from app.models import AnalysisRun, CodeIssue, Repository
from tests import test_analysis_runs as runs_tests
from tests.test_analysis_runs import (
    FILES,
    Owner,
    _ingest,
    _new_repository,
    _repo_url,
    _runs,
    _runs_url,
    inline_analysis,
    requires_db,
)

# The full-analysis fixtures, shared (assigned, so pytest registers them in this module).
db_session = runs_tests.db_session
data_dir = runs_tests.data_dir
client = runs_tests.client
alice = runs_tests.alice
bob = runs_tests.bob

# --- Rule classification ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "category", "severity"),
    [
        (None, "syntax_error", "high"),
        ("F821", "bug_risk", "high"),
        ("F811", "bug_risk", "medium"),
        ("F401", "unused_code", "low"),
        ("F841", "unused_code", "low"),
        ("F632", "bug_risk", "high"),  # F63 prefix
        ("F999", "bug_risk", "medium"),  # F prefix
        ("E722", "bug_risk", "medium"),
        ("E501", "formatting", "info"),
        ("E711", "formatting", "info"),
        ("W291", "formatting", "info"),
        ("N802", "naming", "low"),
        ("D103", "documentation", "info"),
        ("B006", "bug_risk", "high"),
        ("B008", "bug_risk", "medium"),
        ("RET503", "bug_risk", "low"),
        ("RET505", "maintainability", "low"),
        ("SIM108", "maintainability", "low"),
        ("UP035", "maintainability", "info"),
        ("XYZ123", "maintainability", "low"),  # unknown: the generic entry
    ],
)
def test_ruff_rule_classification(code: str | None, category: str, severity: str) -> None:
    info = ruff_rule(code)
    assert (info.category, info.severity) == (category, severity)
    assert info.explanation and info.suggestion


def test_every_rule_has_an_explanation_and_a_suggestion() -> None:
    for info in [*RULES.values(), *OWN_RULES.values()]:
        assert info.explanation.endswith(".") and info.suggestion.endswith(".")


# --- Duplicate blocks --------------------------------------------------------------------------

BLOCK = "\n".join(f"total = compute(total, {n}) + offset_{n}" for n in range(8)) + "\n"


def test_significant_lines_drop_blanks_comments_imports_and_braces() -> None:
    text = "import os\n\n# note\n  x  =   1\n}\n// c\nfrom a import b\n  y = 2  \n"
    assert significant_lines(text) == [(4, "x = 1"), (8, "y = 2")]


def test_duplicate_block_is_reported_on_the_later_file() -> None:
    detector = DuplicationDetector()
    detector.add("a.py", "Python", "def a():\n    pass\n" + BLOCK)
    detector.add("b.py", "Python", BLOCK + "unique_line = 1\n")
    detector.add("notes.md", "Markdown", BLOCK)  # not a programming language
    result = detector.result()
    (block,) = result.blocks
    assert (block.path, block.line, block.end_line) == ("b.py", 1, 8)
    assert (block.original_path, block.original_line, block.original_end_line) == ("a.py", 3, 10)
    assert block.lines == 8
    assert result.files == 2
    assert result.significant_lines == 2 + 8 + 9
    assert result.duplicated_lines == 16
    assert result.percent == round(100 * 16 / 19, 1)
    assert not result.partial


def test_short_and_overlapping_repetition_is_not_duplication() -> None:
    detector = DuplicationDetector()
    five = "\n".join(f"value_{n} = {n}" for n in range(5)) + "\n"
    detector.add("a.py", "Python", five)
    detector.add("b.py", "Python", five)  # 5 lines: below the 6-line window
    detector.add("c.py", "Python", "x = x + 1\n" * 12)  # one line repeated (a data table)
    # A 3-line pattern repeated 3 times: its two equal windows overlap (3 lines apart).
    detector.add("d.py", "Python", "first()\nsecond()\nthird()\n" * 3)
    result = detector.result()
    assert result.blocks == [] and result.duplicated_lines == 0


def test_duplicate_within_one_file() -> None:
    detector = DuplicationDetector()
    detector.add("a.js", "JavaScript", BLOCK + "middle()\n" + BLOCK)
    (block,) = detector.result().blocks
    assert (block.path, block.line, block.original_path, block.original_line) == (
        "a.js",
        10,
        "a.js",
        1,
    )


def test_indexing_stops_at_the_line_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(duplication, "MAX_INDEXED_LINES", 10)
    detector = DuplicationDetector()
    detector.add("a.py", "Python", BLOCK)
    detector.add("b.py", "Python", BLOCK)  # would exceed the budget
    result = detector.result()
    assert result.partial and result.files == 1 and result.blocks == []


# --- Quality analyzer (Ruff really runs) --------------------------------------------------------

MAIN_PY = (
    "import os\n"
    "\n"
    "\n"
    "def first():\n"
    "    return 1\n"
    "    print('never')\n"
    "\n"
    "\n"
    "def second():\n"
    "    return missing_name\n"
)


def _text(path: str, text: str, language: str | None = "Python") -> SnapshotFile:
    return SnapshotFile(path, language, len(text.encode()), "text", text)


def _analyze(tmp_path: Path, files: list[SnapshotFile]) -> analyzer_module.QualityResult:
    quality = QualityAnalyzer(tmp_path / "work")
    for file in files:
        quality.add(file)
    return quality.result()


def _by_rule(result: analyzer_module.QualityResult) -> dict[str, list[analyzer_module.Issue]]:
    found: dict[str, list[analyzer_module.Issue]] = {}
    for issue in result.issues:
        found.setdefault(issue.rule_id, []).append(issue)
    return found


def test_quality_analyzer_reports_every_source(tmp_path: Path) -> None:
    result = _analyze(
        tmp_path,
        [
            _text("app/main.py", MAIN_PY),
            _text("app/broken.py", "def (:\n"),
            _text("web/a.js", BLOCK, "JavaScript"),
            _text("web/b.js", BLOCK, "JavaScript"),
            _text("web/todo.js", "// TODO: remove the fallback\nconst x = 1\n", "JavaScript"),
            _text("data/big.py", "VALUE = 1\n" * 1000),
            _text("node_modules/lib/x.py", "import os\n"),  # excluded directory
            _text("static/app.min.js", "// TODO\n", "JavaScript"),  # generated
            SnapshotFile("logo.png", None, 10, "binary"),
        ],
    )
    rules = _by_rule(result)
    summary = result.summary
    assert summary["ruff"] == "completed"
    assert (summary["files_analyzed"], summary["python_files"]) == (6, 3)

    (unused,) = rules["F401"]
    assert (unused.path, unused.line, unused.column, unused.tool) == ("app/main.py", 1, 8, "ruff")
    assert unused.message == "`os` imported but unused"
    assert unused.suggestion == "Remove unused import: `os`"  # Ruff's own fix message
    assert unused.doc_url == "https://docs.astral.sh/ruff/rules/unused-import"
    (undefined,) = rules["F821"]
    assert (undefined.line, undefined.severity, undefined.category) == (10, "high", "bug_risk")
    assert undefined.suggestion == RULES["F821"].suggestion  # no fix offered: the table's
    (syntax,) = rules["syntax-error"]
    assert (syntax.path, syntax.category, syntax.severity) == (
        "app/broken.py",
        "syntax_error",
        "high",
    )
    (dead,) = rules["unreachable-code"]
    assert (dead.path, dead.line, dead.end_line, dead.tool) == (
        "app/main.py",
        6,
        6,
        "codebase-analysis",
    )
    assert dead.message == "1 unreachable statement after the return on line 5."
    (dup,) = rules["duplicate-code"]
    assert (dup.path, dup.line, dup.end_line) == ("web/b.js", 1, 8)
    assert dup.message == "Lines 1–8 duplicate web/a.js lines 1–8 (8 significant lines)."
    (todo,) = rules["todo-marker"]
    assert (todo.path, todo.line) == ("web/todo.js", 1)
    assert todo.message == "TODO comment: // TODO: remove the fallback"
    (long_file,) = rules["long-file"]
    assert (long_file.path, long_file.end_line) == ("data/big.py", 1000)
    assert {issue.path for issue in result.issues}.isdisjoint(
        {"node_modules/lib/x.py", "static/app.min.js", "logo.png"}
    )

    # Most severe first; counts cover every issue.
    ranks = ["high", "medium", "low", "info"]
    assert [ranks.index(i.severity) for i in result.issues] == sorted(
        ranks.index(i.severity) for i in result.issues
    )
    assert summary["issues"] == summary["stored_issues"] == len(result.issues)
    assert sum(summary["by_severity"].values()) == summary["issues"]
    assert sum(summary["by_category"].values()) == summary["issues"]
    assert summary["by_severity"]["high"] == 2  # F821 and the syntax error
    assert summary["duplication"]["blocks"] == 1
    assert summary["top_files"][0]["path"] == "app/main.py"
    top_rule = summary["top_rules"][0]
    assert set(top_rule) == {"rule_id", "count", "category", "severity"}


def test_only_the_most_severe_issues_are_stored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_STORED_ISSUES", 2)
    result = _analyze(tmp_path, [_text("app/main.py", MAIN_PY)])
    assert result.summary["issues"] > 2
    assert result.summary["stored_issues"] == 2
    assert [issue.severity for issue in result.issues] == ["high", "medium"]


def test_markers_are_limited_per_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_MARKERS_PER_FILE", 3)
    text = "# TODO one\n" * 5 + "todo_list = 1  # not a marker word: TODOS\n"
    result = _analyze(tmp_path, [_text("notes.sh", text, "Shell")])
    assert len(_by_rule(result)["todo-marker"]) == 3


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (subprocess.TimeoutExpired(cmd="ruff", timeout=1), "timeout"),
        (FileNotFoundError("no python"), "unavailable"),
    ],
)
def test_ruff_failures_keep_the_other_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception, status: str
) -> None:
    def fail(*args: Any, **kwargs: Any) -> None:
        raise failure

    monkeypatch.setattr(ruff_runner.subprocess, "run", fail)
    result = _analyze(tmp_path, [_text("app/main.py", MAIN_PY)])
    assert result.summary["ruff"] == status
    assert {issue.tool for issue in result.issues} == {"codebase-analysis"}  # unreachable code


def test_ruff_nonzero_exit_and_oversized_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def exit_two(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(args, 2)

    monkeypatch.setattr(ruff_runner.subprocess, "run", exit_two)
    assert _analyze(tmp_path / "a", [_text("m.py", "x = 1\n")]).summary["ruff"] == "failed"

    monkeypatch.undo()
    monkeypatch.setattr(ruff_runner, "MAX_REPORT_BYTES", 10)
    oversized = _analyze(tmp_path / "b", [_text("m.py", "import os\n")])
    assert oversized.summary["ruff"] == "too_large" and oversized.issues == []


def test_ruff_is_skipped_without_python_files(tmp_path: Path) -> None:
    result = _analyze(tmp_path, [_text("a.js", "const a = 1\n", "JavaScript")])
    assert result.summary["ruff"] == "skipped"


def test_ruff_runs_isolated_with_a_minimal_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def record(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen["command"], seen["kwargs"] = command, kwargs
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setenv("SECRET_KEY", "must-not-leak")
    monkeypatch.setattr(ruff_runner.subprocess, "run", record)
    _analyze(tmp_path, [_text("m.py", "x = 1\n")])
    command, kwargs = seen["command"], seen["kwargs"]
    assert command[1:4] == ["-m", "ruff", "check"]
    assert {"--isolated", "--no-cache", "--exit-zero"} <= set(command)
    assert "SECRET_KEY" not in kwargs["env"]
    assert set(kwargs["env"]) <= {
        "PATH",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
        "LANG",
    }
    assert kwargs["stdin"] == subprocess.DEVNULL
    assert kwargs["timeout"] == ruff_runner.RUFF_TIMEOUT_SECONDS
    assert "shell" not in kwargs


def test_working_copy_holds_only_safe_paths(tmp_path: Path) -> None:
    quality = QualityAnalyzer(tmp_path / "work")
    quality.add(_text("pkg/Mod.py", "x = 1\n"))
    quality.add(_text("pkg/mod.py", "y = 2\n"))  # differs only by case: not copied
    quality.add(_text("../escape.py", "z = 3\n"))
    copied = sorted(
        p.relative_to(tmp_path / "work" / "src").as_posix()
        for p in (tmp_path / "work" / "src").rglob("*.py")
    )
    assert copied == ["pkg/Mod.py"]
    assert not (tmp_path / "escape.py").exists()


def test_report_lines_that_are_not_findings_are_skipped(tmp_path: Path) -> None:
    source = tmp_path / "src"
    source.mkdir()
    report = tmp_path / "report.jsonl"
    inside = str(source / "a.py")
    outside = str(tmp_path / "other.py")
    report.write_text(
        "not json\n"
        '{"filename": "' + outside.replace("\\", "\\\\") + '", "location": {"row": 1}}\n'
        '{"filename": "' + inside.replace("\\", "\\\\") + '", "code": "F401", "message": "m",'
        ' "location": {"row": 3, "column": 2}, "end_location": {"row": 1}, "fix": null}\n'
        '{"location": {"row": 1}}\n',
        encoding="utf-8",
    )
    (finding,) = list(ruff_runner.read_report(source, report))
    assert (finding.path, finding.code, finding.line, finding.end_line) == ("a.py", "F401", 3, 3)
    assert finding.fix is None and finding.url is None


# --- API -----------------------------------------------------------------------------------------

QUALITY_FILES: dict[str, bytes] = {
    **FILES,
    "src/main.py": MAIN_PY.encode(),
    "src/broken.py": b"def (:\n",
    "web/a.js": BLOCK.encode(),
    "web/b.js": BLOCK.encode(),
    "node_modules/lib/bad.py": b"import os\n",
}


def _issues_url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/issues"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = QUALITY_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


async def _get_issues(
    client: httpx.AsyncClient, owner: Owner, run_id: str, **params: Any
) -> dict[str, Any]:
    response = await client.get(_issues_url(owner, run_id), params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


@requires_db
async def test_run_stores_quality_summary_and_issues(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    quality = run["quality"]
    assert quality["ruff"] == "completed"
    assert quality["by_severity"]["high"] == 2  # undefined name, syntax error
    assert quality["duplication"]["blocks"] == 1
    stored = await db_session.scalar(
        select(func.count()).select_from(CodeIssue).where(CodeIssue.run_id == uuid.UUID(run["id"]))
    )
    assert stored == quality["stored_issues"] == quality["issues"]

    page = await _get_issues(client, alice, run["id"])
    assert page["total"] == quality["issues"]
    assert (page["page"], page["page_size"]) == (1, 50)
    first, second = page["items"][:2]
    assert {first["path"], second["path"]} == {"src/broken.py", "src/main.py"}
    assert first["severity"] == second["severity"] == "high"
    assert not any(item["path"].startswith("node_modules/") for item in page["items"])
    undefined = next(item for item in page["items"] if item["rule_id"] == "F821")
    assert undefined["category"] == "bug_risk"
    assert undefined["explanation"] and undefined["suggestion"]
    assert set(undefined) == {
        "id", "path", "line", "column", "end_line", "tool", "rule_id", "category",
        "severity", "message", "explanation", "suggestion", "doc_url",
    }  # fmt: skip


@requires_db
async def test_issue_filters_search_and_paging(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = run["id"]

    high = await _get_issues(client, alice, run_id, severity="high")
    assert high["total"] == 2 and {i["severity"] for i in high["items"]} == {"high"}
    dead = await _get_issues(client, alice, run_id, category="dead_code")
    assert [i["rule_id"] for i in dead["items"]] == ["unreachable-code"]
    in_file = await _get_issues(client, alice, run_id, path="web/b.js")
    assert [i["rule_id"] for i in in_file["items"]] == ["duplicate-code"]
    search = await _get_issues(client, alice, run_id, q="MISSING_NAME")  # case-insensitive
    assert [i["rule_id"] for i in search["items"]] == ["F821"]
    by_rule = await _get_issues(client, alice, run_id, q="f401")
    assert {i["rule_id"] for i in by_rule["items"]} == {"F401"}
    literal = await _get_issues(client, alice, run_id, q="%")  # LIKE wildcards are literal
    assert literal["total"] == 0
    combined = await _get_issues(client, alice, run_id, severity="low", category="unused_code")
    assert combined["total"] == 2 and {i["rule_id"] for i in combined["items"]} == {"F401"}

    everything = await _get_issues(client, alice, run_id, page_size=200)
    page_one = await _get_issues(client, alice, run_id, page_size=3)
    page_two = await _get_issues(client, alice, run_id, page_size=3, page=2)
    assert page_one["total"] == page_two["total"] == everything["total"]
    assert [i["id"] for i in page_one["items"] + page_two["items"]] == [
        i["id"] for i in everything["items"][:6]
    ]
    beyond = await _get_issues(client, alice, run_id, page=99)
    assert beyond["items"] == [] and beyond["total"] == everything["total"]


@requires_db
@pytest.mark.parametrize(
    "params",
    [
        {"severity": "critical"},
        {"category": "style"},
        {"page": 0},
        {"page_size": 201},
        {"q": "x" * 201},
    ],
)
async def test_invalid_issue_filters_are_rejected(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    params: dict[str, Any],
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    response = await client.get(_issues_url(alice, run["id"]), params=params, headers=alice.headers)
    assert response.status_code == 422


@requires_db
async def test_other_users_and_repositories_cannot_read_issues(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    url = _issues_url(alice, run["id"])
    assert (await client.get(url)).status_code == 401
    as_bob = await client.get(url, headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    # Bob's own repository with Alice's run id: the run is not his.
    via_bob = await client.get(_issues_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    # Another repository of Alice's: runs belong to one repository.
    other = await _new_repository(client, alice, "other")
    elsewhere = await client.get(_issues_url(alice, run["id"], other), headers=alice.headers)
    assert elsewhere.status_code == 404
    assert (await client.get("/api/v1/code-quality", headers=bob.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_quality_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    empty = await client.get("/api/v1/code-quality", headers=alice.headers)
    assert empty.json() == {"repositories": []}
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)

    overview = (await client.get("/api/v1/code-quality", headers=alice.headers)).json()
    (entry,) = overview["repositories"]
    assert entry["run_id"] == latest["id"] != first["id"]
    assert (entry["repository_id"], entry["project_id"]) == (alice.repository_id, alice.project_id)
    assert (entry["repository_name"], entry["project_name"]) == ("demo-repo", "Demo")
    assert entry["quality"] == latest["quality"]
    assert entry["analyzed_file_count"] == latest["analyzed_file_count"]

    # A latest run stored before code-quality analysis existed is not listed.
    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == uuid.UUID(latest["id"])).values(quality=None)
    )
    assert (await client.get("/api/v1/code-quality", headers=alice.headers)).json() == {
        "repositories": []
    }
    legacy = next(r for r in (await _runs(client, alice))["runs"] if r["id"] == latest["id"])
    assert legacy["quality"] is None


@requires_db
async def test_issues_are_removed_with_their_repository(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = uuid.UUID(run["id"])
    count = select(func.count()).select_from(CodeIssue).where(CodeIssue.run_id == run_id)
    assert (await db_session.scalar(count) or 0) > 0
    await db_session.execute(
        delete(Repository).where(Repository.id == uuid.UUID(alice.repository_id))
    )
    assert await db_session.scalar(count) == 0
    assert (await client.get(_repo_url(alice), headers=alice.headers)).status_code == 404
