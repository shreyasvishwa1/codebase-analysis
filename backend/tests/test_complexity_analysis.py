"""Complexity analysis tests (phase 4: Module 5).

- Measurement and the complexity analyzer are tested without a database (Lizard and Radon
  really run, on in-memory text).
- API tests reuse the full-analysis fixtures: the throwaway test database (TEST_DATABASE_URL,
  "_test") inside rolled-back transactions, inline ingestion and inline analysis jobs.
"""

import math
import uuid
from typing import Any

import httpx
import pytest
from radon.metrics import mi_visit
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.complexity import analyzer as analyzer_module
from app.analysis.complexity import measure
from app.analysis.complexity.analyzer import ComplexityAnalyzer, ComplexityResult
from app.analysis.complexity.measure import (
    halstead_volume,
    maintainability_index,
    maintainability_of,
    measurable,
    measure_file,
    rank_of,
)
from app.analysis.summary import SnapshotFile
from app.models import AnalysisRun, ComplexityFile, ComplexityFunction, Repository
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


def _branches(name: str, count: int) -> str:
    """A Python function with cyclomatic complexity ``count + 1`` (``count`` if-statements)."""
    body = "".join(f"    if x == {n}:\n        y += {n}\n" for n in range(count))
    return f"def {name}(x, y=0):\n{body}    return y\n"


PRICING_PY = (
    '"""Pricing rules."""\n\n\n'
    "class Cart:\n"
    '    """A cart."""\n\n'
    "    def total(self, items):\n"
    "        return sum(i.price for i in items if i.price > 0 and not i.free)\n\n\n"
    + _branches("discount", 24)  # cyclomatic 25: high
    + "\n\n"
    + _branches("shipping", 12)  # 13: medium
    + "\n\n"
    + _branches("tax", 2)  # 3: low
)
CART_JS = """class Cart {
  total(items) {
    let sum = 0
    for (const item of items) {
      if (item.price > 0 && !item.free) { sum += item.price } else { sum += 0 }
    }
    return sum > 100 ? sum * 0.9 : sum
  }
}

function label(kind) {
  switch (kind) {
    case 'a': return 'A'
    case 'b': return 'B'
    default: return '?'
  }
}
"""

# --- Measurement -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cyclomatic", "rank"), [(1, "low"), (10, "low"), (11, "medium"), (20, "medium"), (21, "high")]
)
def test_complexity_ranks(cyclomatic: int, rank: str) -> None:
    assert rank_of(cyclomatic) == rank


@pytest.mark.parametrize(
    ("index", "level"),
    [
        (100.0, "good"),
        (20.0, "good"),
        (19.9, "moderate"),
        (10.0, "moderate"),
        (9.9, "poor"),
        (0.0, "poor"),
    ],
)
def test_maintainability_levels(index: float, level: str) -> None:
    assert maintainability_of(index) == level


def test_maintainability_index_formula() -> None:
    assert maintainability_index(1.0, 1, 1) == round((171 - 0.23) * 100 / 171, 1)
    expected = (171 - 5.2 * math.log(500) - 0.23 * 12 - 16.2 * math.log(80)) * 100 / 171
    assert maintainability_index(500.0, 12, 80) == round(expected, 1)
    assert maintainability_index(1e12, 500, 100_000) == 0.0  # never negative
    assert maintainability_index(0.0, 1, 0) == maintainability_index(1.0, 1, 1)  # logs guarded


def test_halstead_volume_counts_tokens() -> None:
    # Tokens a = b + c ; a = c ; : N = 10, n = 6 distinct (a b c = + ;).
    assert halstead_volume("x.js", "a = b + c; a = c;") == pytest.approx(10 * math.log2(6))
    # Comments and blanks are not tokens.
    assert halstead_volume("x.js", "// note\nreturn a\n") == pytest.approx(2 * math.log2(2))
    assert halstead_volume("x.js", "/* block */ a = a") == pytest.approx(3 * math.log2(2))
    assert halstead_volume("x.md", "a = b") == 0.0
    assert halstead_volume("x.js", "a") == 0.0  # one distinct token: no volume


@pytest.mark.parametrize(
    ("path", "language", "expected"),
    [
        ("a.py", "Python", True),
        ("src/a.ts", "TypeScript", True),
        ("App.tsx", "TSX", True),
        ("Main.java", "Java", True),
        ("main.go", "Go", True),
        ("README.md", "Markdown", False),
        ("data.json", "JSON", False),
        ("run.sh", "Shell", False),  # Lizard has no shell reader
        ("a.py", None, False),
        ("notes.txt", "Python", False),  # the extension decides the reader
    ],
)
def test_measurable_files(path: str, language: str | None, expected: bool) -> None:
    assert measurable(path, language) is expected


def test_measure_python_file() -> None:
    file = measure_file("shop/pricing.py", "Python", PRICING_PY)
    by_name = {f.name: f for f in file.functions}
    assert set(by_name) == {"total", "discount", "shipping", "tax"}
    assert (by_name["discount"].cyclomatic, by_name["discount"].rank) == (25, "high")
    assert (by_name["shipping"].cyclomatic, by_name["shipping"].rank) == (13, "medium")
    assert (by_name["tax"].cyclomatic, by_name["tax"].rank) == (3, "low")
    assert by_name["total"].cyclomatic == 4  # comprehension for, if, and
    assert by_name["discount"].parameters == 2
    assert by_name["discount"].line == PRICING_PY.splitlines().index("def discount(x, y=0):") + 1
    assert by_name["discount"].end_line > by_name["discount"].line
    assert file.classes == 1
    assert (file.max_cyclomatic, file.rank) == (25, "high")
    assert file.total_cyclomatic == 25 + 13 + 3 + 4
    assert file.mi_estimated is False
    assert file.maintainability_index == round(mi_visit(PRICING_PY, multi=True), 1)


def test_measure_javascript_file() -> None:
    file = measure_file("web/cart.js", "JavaScript", CART_JS)
    by_name = {f.name: f.cyclomatic for f in file.functions}
    assert by_name == {"total": 5, "label": 3}  # for, if, &&, ?: / two cases
    assert file.classes == 1
    assert file.mi_estimated is True
    assert file.maintainability_index is not None and 0 < file.maintainability_index <= 100


def test_python_classes_come_from_the_syntax_tree() -> None:
    text = 'class A:\n    """\nclass names in this docstring are not classes\n"""\n'
    assert measure_file("a.py", "Python", text).classes == 1


def test_a_file_is_as_complex_as_its_most_complex_function() -> None:
    text = "".join(_branches(f"f{n}", 3) + "\n\n" for n in range(6))  # six functions of 4
    file = measure_file("many.py", "Python", text)
    assert (file.total_cyclomatic, file.max_cyclomatic, file.rank) == (24, 4, "low")


def test_unparsable_python_gets_an_estimated_index() -> None:
    text = "class Broken:\n    def f(self:\n        pass\n"
    file = measure_file("broken.py", "Python", text)
    assert file.mi_estimated is True and file.maintainability_index is not None
    assert file.classes == 1  # counted from the declaration when there is no syntax tree


def test_class_declarations_in_other_languages() -> None:
    java = "public final class A {}\ninterface B {}\nenum C { X }\n  abstract class D {}\n"
    assert measure_file("A.java", "Java", java).classes == 4
    go = "package x\ntype User struct {\n}\ntype Store interface {\n}\ntype ID int\n"
    assert measure_file("x.go", "Go", go).classes == 2
    assert measure_file("x.ts", "TypeScript", "export default class A {}\n").classes == 1
    empty = measure_file("e.py", "Python", "")
    assert (empty.nloc, empty.maintainability_index, empty.functions) == (0, None, [])


# --- Complexity analyzer ---------------------------------------------------------------------------


def _text(path: str, text: str, language: str | None = "Python") -> SnapshotFile:
    return SnapshotFile(path, language, len(text.encode()), "text", text)


SAMPLE = [
    _text("shop/pricing.py", PRICING_PY),
    _text("web/cart.js", CART_JS, "JavaScript"),
    _text("README.md", "# Shop\n", "Markdown"),
    _text("node_modules/lib/index.js", _branches("hidden", 30), "JavaScript"),  # excluded
    _text("static/app.min.js", "function a(){if(x){}}", "JavaScript"),  # generated
    SnapshotFile("logo.png", None, 10, "binary"),
]


def _analyze(files: list[SnapshotFile]) -> ComplexityResult:
    analyzer = ComplexityAnalyzer()
    for file in files:
        analyzer.add(file)
    return analyzer.result()


def test_complexity_analyzer_summary_files_and_functions() -> None:
    result = _analyze(SAMPLE)
    summary = result.summary
    assert summary["files_measured"] == 2
    assert summary["languages"] == [
        {"language": "JavaScript", "files": 1},
        {"language": "Python", "files": 1},
    ]
    assert summary["functions"] == 6 and summary["classes"] == 2
    assert summary["total_cyclomatic"] == 25 + 13 + 3 + 4 + 5 + 3
    assert summary["average_cyclomatic"] == round(53 / 6, 2)
    assert summary["max_cyclomatic"] == 25
    assert summary["functions_by_rank"] == {"low": 4, "medium": 1, "high": 1}
    assert summary["files_by_rank"] == {"low": 1, "medium": 0, "high": 1}
    indexes = [f.maintainability_index for f in result.files]
    assert summary["maintainability_index"] == round(sum(indexes) / 2, 1)  # type: ignore[arg-type]
    assert summary["maintainability"] == maintainability_of(summary["maintainability_index"])
    assert sum(summary["files_by_maintainability"].values()) == 2
    assert summary["mi_estimated_files"] == 1
    assert summary["nloc"] == sum(f.nloc for f in result.files)
    assert (summary["stored_files"], summary["stored_functions"]) == (2, 6)
    assert summary["files_skipped"] == {"too_large": 0, "unparsable": 0}
    assert [(f["name"], f["cyclomatic"]) for f in summary["top_functions"][:3]] == [
        ("discount", 25),
        ("shipping", 13),
        ("total", 5),
    ]

    pricing, cart = result.files  # most complex first
    assert (pricing.path, pricing.functions, pricing.max_cyclomatic, pricing.rank) == (
        "shop/pricing.py",
        4,
        25,
        "high",
    )
    assert pricing.average_cyclomatic == round(45 / 4, 2)
    assert pricing.maintainability == maintainability_of(pricing.maintainability_index or 0)
    assert (cart.path, cart.mi_estimated, cart.language) == ("web/cart.js", True, "JavaScript")
    assert [f.cyclomatic for f in result.functions] == [25, 13, 5, 4, 3, 3]
    assert {f.path for f in result.functions} == {"shop/pricing.py", "web/cart.js"}


def test_large_and_failing_files_are_counted_not_measured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_MEASURED_BYTES", 100)
    result = _analyze([_text("big.py", PRICING_PY), _text("small.py", "def f():\n    return 1\n")])
    assert result.summary["files_skipped"]["too_large"] == 1
    assert [f.path for f in result.files] == ["small.py"]

    def explode(*args: Any) -> None:
        raise RecursionError

    monkeypatch.setattr(analyzer_module, "measure_file", explode)
    failed = _analyze([_text("small.py", "x = 1\n")])
    assert failed.summary["files_skipped"]["unparsable"] == 1 and failed.files == []


def test_storage_keeps_the_most_complex(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_STORED_FUNCTIONS", 2)
    monkeypatch.setattr(analyzer_module, "MAX_STORED_FILES", 1)
    result = _analyze(SAMPLE)
    assert [f.cyclomatic for f in result.functions] == [25, 13]
    assert [f.path for f in result.files] == ["shop/pricing.py"]
    assert result.summary["functions"] == 6 and result.summary["files_measured"] == 2
    assert (result.summary["stored_functions"], result.summary["stored_files"]) == (2, 1)


def test_empty_snapshot() -> None:
    summary = _analyze([]).summary
    assert (summary["functions"], summary["max_cyclomatic"], summary["average_cyclomatic"]) == (
        0,
        0,
        0.0,
    )
    assert (summary["maintainability_index"], summary["maintainability"]) == (None, None)


def test_measure_constants_are_the_documented_thresholds() -> None:
    assert (measure.MEDIUM_FROM, measure.HIGH_FROM) == (11, 21)
    assert (measure.MODERATE_BELOW, measure.POOR_BELOW) == (20, 10)


# --- API -----------------------------------------------------------------------------------------

COMPLEXITY_FILES: dict[str, bytes] = {
    **FILES,
    "shop/pricing.py": PRICING_PY.encode(),
    "web/cart.js": CART_JS.encode(),
    "node_modules/x/index.js": _branches("hidden", 30).encode(),
}


def _url(owner: Owner, run_id: str, kind: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/complexity/{kind}"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = COMPLEXITY_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


async def _get(
    client: httpx.AsyncClient, owner: Owner, run_id: str, kind: str, **params: Any
) -> dict[str, Any]:
    response = await client.get(_url(owner, run_id, kind), params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


@requires_db
async def test_run_stores_complexity_summary_files_and_functions(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    summary = run["complexity"]
    # FILES adds src/app.py (main), src/util.py and web/index.js (no functions).
    assert summary["files_measured"] == 5
    assert summary["max_cyclomatic"] == 25
    assert summary["functions_by_rank"] == {"low": 5, "medium": 1, "high": 1}
    assert run["quality"] is not None and run["security"] is not None  # one pass, all analyses
    run_id = uuid.UUID(run["id"])
    stored_files = await db_session.scalar(
        select(func.count()).select_from(ComplexityFile).where(ComplexityFile.run_id == run_id)
    )
    stored_functions = await db_session.scalar(
        select(func.count())
        .select_from(ComplexityFunction)
        .where(ComplexityFunction.run_id == run_id)
    )
    assert (stored_files, stored_functions) == (5, summary["functions"])

    files = await _get(client, alice, run["id"], "files")
    assert [f["path"] for f in files["items"][:2]] == ["shop/pricing.py", "web/cart.js"]
    first = files["items"][0]
    assert (first["max_cyclomatic"], first["rank"], first["functions"], first["classes"]) == (
        25,
        "high",
        4,
        1,
    )
    assert set(first) == {
        "id", "path", "language", "nloc", "functions", "classes", "total_cyclomatic",
        "max_cyclomatic", "average_cyclomatic", "rank", "maintainability_index",
        "maintainability", "mi_estimated",
    }  # fmt: skip
    functions = await _get(client, alice, run["id"], "functions")
    assert [(f["name"], f["cyclomatic"], f["rank"]) for f in functions["items"][:2]] == [
        ("discount", 25, "high"),
        ("shipping", 13, "medium"),
    ]
    assert set(functions["items"][0]) == {
        "id", "path", "name", "line", "end_line", "cyclomatic", "nloc", "parameters", "rank",
    }  # fmt: skip
    assert not any(f["path"].startswith("node_modules/") for f in functions["items"])


@requires_db
async def test_file_and_function_filters_sorting_and_paging(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = run["id"]

    high = await _get(client, alice, run_id, "files", rank="high")
    assert [f["path"] for f in high["items"]] == ["shop/pricing.py"]
    by_path = await _get(client, alice, run_id, "files", sort="path")
    assert [f["path"] for f in by_path["items"]] == sorted(f["path"] for f in by_path["items"])
    by_size = await _get(client, alice, run_id, "files", sort="size")
    sizes = [f["nloc"] for f in by_size["items"]]
    assert sizes == sorted(sizes, reverse=True)
    by_mi = await _get(client, alice, run_id, "files", sort="maintainability")
    indexes = [
        f["maintainability_index"] for f in by_mi["items"] if f["maintainability_index"] is not None
    ]
    assert indexes == sorted(indexes)
    assert [f["maintainability_index"] for f in by_mi["items"]][len(indexes) :] == [None] * (
        len(by_mi["items"]) - len(indexes)
    )  # files without an index last
    good = await _get(client, alice, run_id, "files", maintainability="good")
    assert good["total"] >= 1 and all(f["maintainability"] == "good" for f in good["items"])
    searched = await _get(client, alice, run_id, "files", q="CART")
    assert [f["path"] for f in searched["items"]] == ["web/cart.js"]
    assert (await _get(client, alice, run_id, "files", q="%"))["total"] == 0

    medium = await _get(client, alice, run_id, "functions", rank="medium")
    assert [f["name"] for f in medium["items"]] == ["shipping"]
    in_file = await _get(client, alice, run_id, "functions", path="web/cart.js")
    assert [f["name"] for f in in_file["items"]] == ["total", "label"]
    named = await _get(client, alice, run_id, "functions", q="DISC")
    assert [f["name"] for f in named["items"]] == ["discount"]
    by_file = await _get(client, alice, run_id, "functions", q="pricing")
    assert {f["path"] for f in by_file["items"]} == {"shop/pricing.py"}

    everything = await _get(client, alice, run_id, "functions", page_size=200)
    page_one = await _get(client, alice, run_id, "functions", page_size=2)
    page_two = await _get(client, alice, run_id, "functions", page_size=2, page=2)
    assert [f["id"] for f in page_one["items"] + page_two["items"]] == [
        f["id"] for f in everything["items"][:4]
    ]
    assert page_one["total"] == everything["total"] == run["complexity"]["functions"]
    cyclomatic = [f["cyclomatic"] for f in everything["items"]]
    assert cyclomatic == sorted(cyclomatic, reverse=True)


@requires_db
@pytest.mark.parametrize(
    ("kind", "params"),
    [
        ("files", {"rank": "extreme"}),
        ("files", {"maintainability": "bad"}),
        ("files", {"sort": "name"}),
        ("files", {"page": 0}),
        ("functions", {"rank": "x"}),
        ("functions", {"page_size": 201}),
        ("functions", {"q": "x" * 201}),
    ],
)
async def test_invalid_complexity_filters_are_rejected(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    kind: str,
    params: dict[str, Any],
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    response = await client.get(_url(alice, run["id"], kind), params=params, headers=alice.headers)
    assert response.status_code == 422


@requires_db
async def test_other_users_and_repositories_cannot_read_complexity(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    for kind in ("files", "functions"):
        url = _url(alice, run["id"], kind)
        assert (await client.get(url)).status_code == 401
        as_bob = await client.get(url, headers=bob.headers)
        assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
        via_bob = await client.get(_url(bob, run["id"], kind), headers=bob.headers)
        assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    other = await _new_repository(client, alice, "other")
    elsewhere = await client.get(_url(alice, run["id"], "files", other), headers=alice.headers)
    assert elsewhere.status_code == 404
    assert (await client.get("/api/v1/complexity", headers=bob.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_complexity_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    assert (await client.get("/api/v1/complexity", headers=alice.headers)).json() == {
        "repositories": []
    }
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)
    (entry,) = (await client.get("/api/v1/complexity", headers=alice.headers)).json()[
        "repositories"
    ]
    assert entry["run_id"] == latest["id"] != first["id"]
    assert (entry["repository_name"], entry["project_name"]) == ("demo-repo", "Demo")
    assert entry["complexity"] == latest["complexity"]
    assert entry["code_lines"] == latest["code_lines"]

    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == uuid.UUID(latest["id"])).values(complexity=None)
    )
    assert (await client.get("/api/v1/complexity", headers=alice.headers)).json() == {
        "repositories": []
    }
    legacy = next(r for r in (await _runs(client, alice))["runs"] if r["id"] == latest["id"])
    assert legacy["complexity"] is None


@requires_db
async def test_complexity_is_removed_with_its_repository(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = uuid.UUID(run["id"])
    files = select(func.count()).select_from(ComplexityFile).where(ComplexityFile.run_id == run_id)
    functions = (
        select(func.count())
        .select_from(ComplexityFunction)
        .where(ComplexityFunction.run_id == run_id)
    )
    assert (await db_session.scalar(files) or 0) > 0 and (
        await db_session.scalar(functions) or 0
    ) > 0
    await db_session.execute(
        delete(Repository).where(Repository.id == uuid.UUID(alice.repository_id))
    )
    assert (await db_session.scalar(files), await db_session.scalar(functions)) == (0, 0)
    assert (await client.get(_repo_url(alice), headers=alice.headers)).status_code == 404
