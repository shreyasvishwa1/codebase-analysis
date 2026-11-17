"""The Code Health Score (Module 8).

- Unit tests pin each dimension's formula on hand-computed summaries, the caps, the fallbacks
  for runs stored before phase 7, the weighted average and the grades.
- API tests reuse the full-analysis fixtures (the throwaway test database inside rolled-back
  transactions) and cover the run report, history, overview, the user's weights and ownership.
"""

import uuid
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import health
from app.api.v1.routes.health_score import NOT_SCORED
from app.models import AnalysisRun, ArchitectureReport
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
from tests.test_architecture_analysis import ARCHITECTURE_FILES

# The full-analysis fixtures, shared (assigned, so pytest registers them in this module).
db_session = runs_tests.db_session
data_dir = runs_tests.data_dir
client = runs_tests.client
alice = runs_tests.alice
bob = runs_tests.bob

# --- Summaries -----------------------------------------------------------------------------------


def _security(**crossed: tuple[int, int]) -> dict[str, Any]:
    """A security summary from (confirmed, potential) counts per severity."""
    levels = {s: crossed.get(s, (0, 0)) for s in ("critical", "high", "medium", "low")}
    return {
        "findings": sum(c + p for c, p in levels.values()),
        "by_severity": {s: c + p for s, (c, p) in levels.items()},
        "by_severity_confidence": {
            s: {"confirmed": c, "potential": p} for s, (c, p) in levels.items()
        },
    }


def _quality(
    high: int = 0,
    medium: int = 0,
    low: int = 0,
    info: int = 0,
    duplicate_blocks: int = 0,
    duplication: float = 0.0,
    documentation: int = 0,
    python_files: int = 1,
    ruff: str = "completed",
) -> dict[str, Any]:
    return {
        "issues": high + medium + low + info,
        "by_severity": {"high": high, "medium": medium, "low": low, "info": info},
        "by_category": {"duplication": duplicate_blocks, "documentation": documentation},
        "duplication": {"percent": duplication},
        "python_files": python_files,
        "ruff": ruff,
    }


def _complexity(
    functions: int = 10,
    medium: int = 0,
    high: int = 0,
    average: float = 2.0,
    index: float | None = 65.0,
    poor: int = 0,
    top: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "functions": functions,
        "functions_by_rank": {"low": functions - medium - high, "medium": medium, "high": high},
        "average_cyclomatic": average,
        "top_functions": top or [],
        "maintainability_index": index,
        "files_by_maintainability": {"good": 1, "moderate": 0, "poor": poor},
    }


SEVERITIES = ("critical", "high", "medium", "low", "unknown")


def _dependencies(
    total: int = 10,
    worst: dict[str, int] | None = None,
    major: int = 0,
    minor: int = 0,
    conflicts: int = 0,
    invalid: int = 0,
    osv: str = "completed",
    registry: str = "completed",
) -> dict[str, Any]:
    worst = {s: (worst or {}).get(s, 0) for s in SEVERITIES}
    return {
        "dependencies": total,
        "vulnerable_dependencies": sum(worst.values()),
        "vulnerable_by_max_severity": worst,
        "vulnerabilities": sum(worst.values()),
        "updates": {
            "up_to_date": total - major - minor,
            "patch": 0,
            "minor": minor,
            "major": major,
            "unknown": 0,
        },
        "conflicts": [{"name": f"pkg{i}"} for i in range(conflicts)],
        "manifests": {"total": 1 + invalid, "parsed": 1, "invalid": invalid, "unreadable": 0},
        "lookups": {"osv": osv, "registry": registry, "checked_at": None},
    }


def _architecture(components: int = 3, cycles: int = 0, entry_points: int = 1) -> dict[str, Any]:
    return {
        "components": components,
        "cycles": cycles,
        "entry_points": entry_points,
        "has_tests": True,
        "has_ci": True,
        "separated": True,
    }


# --- Security ------------------------------------------------------------------------------------


def test_security_without_results_or_findings() -> None:
    missing = health.security(None, 1.0)
    assert (missing.score, missing.inputs, missing.improvements) == (None, {}, [])
    clean = health.security(_security(), 1.0)
    assert (clean.score, clean.improvements) == (100, [])
    assert clean.inputs == {
        "findings": 0,
        "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        "weighted_points": 0,
        "per_kloc": 0,
    }


def test_security_density_counts_potential_findings_half() -> None:
    # 10 x 0.5 (potential critical) + 2 (confirmed medium) + 0.5 x 2 x 0.5 (potential lows)
    # = 7.5 points over 2,000 lines = 3.75 per 1,000 -> 100 / (1 + 3.75 / 2) = 34.8
    dimension = health.security(_security(critical=(0, 1), medium=(1, 0), low=(0, 2)), 2.0)
    assert dimension.score == 35
    assert dimension.inputs["weighted_points"] == 7.5
    assert dimension.inputs["per_kloc"] == 3.75
    assert "= 3.75 per 1,000 lines -> 35" in dimension.explanation
    assert "caps" not in dimension.explanation  # only confirmed findings cap the score
    assert dimension.improvements == [
        "Fix the 1 critical finding first (committed secrets and vulnerable dependencies are"
        " usually among them).",
        "Review the remaining confirmed findings on the Security page.",
    ]


@pytest.mark.parametrize(
    ("crossed", "score", "cap_text"),
    [
        ({"critical": (1, 0)}, 40, "A confirmed critical finding caps the score at 40."),
        ({"high": (1, 0)}, 70, "A confirmed high-severity finding caps the score at 70."),
        ({"critical": (1, 0), "high": (3, 0)}, 40, "critical finding caps"),
        ({"high": (0, 1)}, 99, None),  # potential: 2.5 points / 100 -> 98.8, no cap
    ],
)
def test_security_caps_for_confirmed_findings(
    crossed: dict[str, tuple[int, int]], score: int, cap_text: str | None
) -> None:
    dimension = health.security(_security(**crossed), 100.0)
    assert dimension.score == score
    if cap_text:
        assert cap_text in dimension.explanation
    else:
        assert "caps" not in dimension.explanation


def test_security_of_older_runs_counts_every_finding_as_confirmed() -> None:
    summary = _security(critical=(0, 1))
    del summary["by_severity_confidence"]
    dimension = health.security(summary, 100.0)
    assert dimension.score == 40  # 10 points / 100 -> 95, capped as a confirmed critical
    assert dimension.inputs["weighted_points"] == 10


def test_security_improvements_name_high_findings() -> None:
    dimension = health.security(_security(high=(0, 2)), 1.0)
    assert dimension.improvements == ["Fix the 2 high-severity findings."]


# --- Code quality --------------------------------------------------------------------------------


def test_quality_without_results() -> None:
    assert health.quality(None, 1.0).score is None


def test_quality_combines_issue_density_and_duplication() -> None:
    # 5 + 2 x 3 + 0.5 x 2 + 0.1 x 10 = 13, less the duplicate block (2) = 11 per 1,000 lines
    # -> 100 / (1 + 11 / 10) = 47.6; duplication 5% -> 80; 0.75 x 47.6 + 0.25 x 80 = 55.7
    summary = _quality(high=1, medium=3, low=2, info=10, duplicate_blocks=1, duplication=5)
    dimension = health.quality(summary, 1.0)
    assert dimension.score == 56
    assert dimension.inputs == {
        "issues": 16,
        "by_severity": {"high": 1, "medium": 3, "low": 2, "info": 10},
        "per_kloc": 11,
        "duplication_percent": 5.0,
    }
    assert "Issues: 11 weighted points" in dimension.explanation
    assert "-> 48 (50 at 10; 75%). Duplication 5% -> 80 (25%; 0 at 25%)." in dimension.explanation
    assert dimension.improvements == [
        "Fix the 1 high-severity issue (syntax errors and likely bugs).",
        "Fix the 3 medium-severity issues.",
        "Remove duplicated code (5% of lines are duplicated).",
    ]


@pytest.mark.parametrize(
    ("duplication", "score"),
    [(0, 100), (2.9, 97), (25, 75), (60, 75)],  # 0.75 x 100 + 0.25 x max(0, 100 - 4 x d)
)
def test_quality_duplication_share(duplication: float, score: int) -> None:
    dimension = health.quality(_quality(duplication=duplication), 1.0)
    assert dimension.score == score
    assert bool(dimension.improvements) == (duplication >= 3)


def test_quality_density_is_per_thousand_lines() -> None:
    # 20 medium issues: 40 points over 2,000 lines = 20 per 1,000 -> 33.3; no duplication
    assert health.quality(_quality(medium=20), 2.0).score == 50  # 0.75 x 33.3 + 25


# --- Complexity ----------------------------------------------------------------------------------


def test_complexity_without_results_or_functions() -> None:
    assert health.complexity(None).score is None
    empty = health.complexity(_complexity(functions=0))
    assert (empty.score, empty.inputs, empty.explanation) == (
        None,
        {"functions": 0},
        "No functions were measured.",
    )


def test_complexity_penalizes_medium_and_high_shares_and_the_average() -> None:
    # 150 x 10% + 400 x 2% + 5 x (7 - 5) = 15 + 8 + 10 = 33
    summary = _complexity(
        functions=100, medium=10, high=2, average=7, top=[{"name": "parse", "cyclomatic": 31}]
    )
    dimension = health.complexity(summary)
    assert dimension.score == 67
    assert dimension.inputs == {"functions": 100, "medium": 10, "high": 2, "average": 7.0}
    assert dimension.explanation == (
        "100 - 150 x 10.0% of functions at medium complexity (11-20) - 400 x 2.0% at high"
        " complexity (above 20) - 5 per point the average complexity (7) is above 5."
    )
    assert dimension.improvements == [
        "Split the 2 functions above complexity 20, starting with parse (31).",
        "Simplify the 10 functions between 11 and 20.",
    ]


def test_complexity_below_the_average_allowance_and_floor() -> None:
    assert health.complexity(_complexity(functions=4, average=5)).score == 100
    assert health.complexity(_complexity(functions=4, high=1, average=4)).score == 0  # -100
    one_high = health.complexity(_complexity(functions=4, high=1, average=4, top=[]))
    assert one_high.improvements == ["Split the 1 function above complexity 20."]


# --- Maintainability -----------------------------------------------------------------------------


def test_maintainability_without_an_index() -> None:
    assert health.maintainability(None, None, 1.0).score is None
    assert health.maintainability(_complexity(index=None), _quality(), 1.0).score is None


def test_maintainability_weighs_the_index_and_documentation() -> None:
    # index 37.5 -> (37.5 - 10) x 100 / 55 = 50; 10 missing docstrings over 2,000 lines = 5
    # per 1,000 -> 100 / 1.5 = 66.7; 0.7 x 50 + 0.3 x 66.7 = 55
    dimension = health.maintainability(
        _complexity(index=37.5, poor=2), _quality(documentation=10), 2.0
    )
    assert dimension.score == 55
    assert dimension.inputs == {
        "maintainability_index": 37.5,
        "missing_docstrings": 10,
        "missing_per_kloc": 5,
    }
    assert dimension.explanation == (
        "Maintainability index 37.5 -> 50 (0 at 10, 100 at 65) (70%); 10 missing docstrings ="
        " 5.00 per 1,000 lines -> 67 (30%)."
    )
    assert dimension.improvements == [
        "Refactor the 2 files with a poor maintainability index (below 10).",
        "Document the public modules, classes and functions (10 docstrings missing).",
    ]


@pytest.mark.parametrize(
    "quality",
    [None, _quality(python_files=0, documentation=50), _quality(ruff="failed", documentation=50)],
)
def test_maintainability_uses_only_the_index_without_measured_docstrings(
    quality: dict[str, Any] | None,
) -> None:
    dimension = health.maintainability(_complexity(index=37.5), quality, 1.0)
    assert dimension.score == 50
    assert dimension.inputs == {"maintainability_index": 37.5}
    assert dimension.explanation.endswith("; documentation is measured for Python only.")
    assert dimension.improvements == []


@pytest.mark.parametrize(("index", "score"), [(5, 0), (10, 0), (65, 100), (90, 100)])
def test_maintainability_index_is_clamped(index: float, score: int) -> None:
    assert health.maintainability(_complexity(index=index), None, 1.0).score == score


def test_maintainability_clamps_the_index_before_weighing_documentation() -> None:
    # index 90 counts as 100, not 145: 0.7 x 100 + 0.3 x 100 = 100
    assert health.maintainability(_complexity(index=90), _quality(), 1.0).score == 100
    # ... so an excellent index cannot hide missing documentation: 1,000 missing docstrings
    # per 1,000 lines -> 1; 0.7 x 100 + 0.3 x 1 = 70 (unclamped: 0.7 x 145 + 0.3 -> 100)
    undocumented = _quality(documentation=1000)
    assert health.maintainability(_complexity(index=90), undocumented, 1.0).score == 70
    # and a poor one counts as 0, not below: 0.7 x 0 + 0.3 x 100 = 30
    assert health.maintainability(_complexity(index=0), _quality(), 1.0).score == 30


# --- Dependency health ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("summary", "explanation"),
    [
        (None, "This run has no dependency results."),
        (_dependencies(total=0), "No dependencies are declared."),
        (_dependencies(osv="disabled"), "could not be looked up"),
        (_dependencies(registry="failed"), "could not be looked up"),
    ],
)
def test_dependencies_not_scored(summary: dict[str, Any] | None, explanation: str) -> None:
    dimension = health.dependencies(summary)
    assert dimension.score is None
    assert explanation in dimension.explanation


def test_dependencies_penalties() -> None:
    # vulnerable: 200 x 0.4 / 10 = 8; outdated: 20 x 2/10 + 5 x 2/10 = 5; 1 conflict 5; 1
    # invalid manifest 5 -> 77
    summary = _dependencies(worst={"medium": 1}, major=2, minor=2, conflicts=1, invalid=1)
    dimension = health.dependencies(summary)
    assert dimension.score == 77
    assert dimension.inputs == {
        "dependencies": 10,
        "vulnerabilities": 1,
        "vulnerable_by_max_severity": summary["vulnerable_by_max_severity"],
        "major_behind": 2,
        "minor_behind": 2,
        "conflicts": 1,
    }
    assert dimension.explanation.startswith("100 - 8.0 for vulnerable dependencies (200 x 4.0%")
    assert dimension.explanation.endswith(
        "- 5.0 for outdated versions - 5 for conflicts - 5 for unparsable manifests."
    )
    assert dimension.improvements == [
        "Upgrade the 1 vulnerable dependency to versions with the fixes.",
        "Plan upgrades for the 2 dependencies a major version behind.",
        "Declare one version for the 1 conflicting package.",
    ]


@pytest.mark.parametrize(
    ("worst", "score", "cap_text"),
    [
        ({"critical": 1}, 60, "a critical vulnerability caps it at 60."),
        ({"high": 1}, 80, "a high-severity vulnerability caps it at 80."),
        ({"low": 1}, 100, None),  # 200 x 0.15 / 100 = 0.3
        ({"unknown": 1}, 99, None),  # 200 x 0.4 / 100 = 0.8
    ],
)
def test_dependencies_caps_for_severe_vulnerabilities(
    worst: dict[str, int], score: int, cap_text: str | None
) -> None:
    dimension = health.dependencies(_dependencies(total=100, worst=worst))
    assert dimension.score == score
    assert dimension.explanation.endswith(cap_text or "manifests.")


def test_dependencies_floor_conflict_cap_and_partial_lookups() -> None:
    assert health.dependencies(_dependencies(total=2, worst={"critical": 1})).score == 0
    conflicts = health.dependencies(_dependencies(conflicts=6, osv="partial"))
    assert conflicts.score == 80  # conflicts capped at 20
    assert "- 20 for conflicts" in conflicts.explanation
    assert "(lookups were incomplete)" in conflicts.explanation


def test_dependencies_of_older_runs_count_vulnerable_ones_as_high() -> None:
    summary = _dependencies(total=100, worst={"critical": 1})
    del summary["vulnerable_by_max_severity"]
    dimension = health.dependencies(summary)
    assert dimension.score == 80  # 200 x 0.7 / 100 = 1.4, capped as high
    assert dimension.inputs["vulnerable_by_max_severity"] == {
        "critical": 0, "high": 1, "medium": 0, "low": 0, "unknown": 0
    }  # fmt: skip


# --- Architecture --------------------------------------------------------------------------------


def test_architecture_without_components() -> None:
    assert health.architecture(None, True, True, True).score is None
    assert health.architecture(_architecture(components=0), True, True, True).score is None


def test_architecture_checks() -> None:
    full = health.architecture(_architecture(), True, True, True)
    assert (full.score, full.improvements) == (100, [])
    assert full.explanation == (
        "automated tests 30/30; no circular dependencies 25/25; entry points identified 15/15;"
        " continuous integration 15/15; separated layers 15/15."
    )
    cycles = health.architecture(_architecture(cycles=2), True, True, True)
    assert cycles.score == 80  # 25 - 2 x 10
    assert cycles.inputs["checks"]["no_cycles"] is False
    assert cycles.improvements == ["Break the 2 dependency cycles between components."]
    bare = health.architecture(_architecture(cycles=3, entry_points=0), False, False, False)
    assert bare.score == 0
    assert bare.improvements == [
        "Add automated tests.",
        "Break the 3 dependency cycles between components.",
        "Run the tests in continuous integration (for example GitHub Actions).",
        "Separate the API, business logic and data access into their own modules.",
    ]


def test_architecture_facts_from_the_summary_or_the_report() -> None:
    summary = _architecture() | {"has_tests": False, "separated": True, "has_ci": False}
    assert health.architecture_facts(summary, None) == (False, True, False)
    older = {k: v for k, v in summary.items() if k not in ("has_tests", "has_ci", "separated")}
    report = {
        "components": [
            {"id": "app/api", "role": "api", "roles": ["api"]},
            {"id": "app/db", "role": "data", "roles": ["data", "test"]},
        ],
        "observations": [],
        "infrastructure": [{"kind": "ci"}],
    }
    assert health.architecture_facts(older, report) == (True, True, True)
    assert health.architecture_facts(older, None) == (False, False, False)
    one_role = {
        "components": [{"id": "web", "role": "ui", "roles": ["ui"]}],
        "observations": [{"title": "Frontend and backend in one repository"}],
        "infrastructure": [{"kind": "docker"}],
    }
    assert health.architecture_facts(older, one_role) == (False, True, False)


def test_needs_report_only_for_older_architecture_summaries() -> None:
    assert health.needs_report(SimpleNamespace(architecture=None)) is False
    assert health.needs_report(SimpleNamespace(architecture=_architecture())) is False
    assert health.needs_report(SimpleNamespace(architecture={"components": 1})) is True


# --- Overall -------------------------------------------------------------------------------------


def test_dimensions_of_a_run() -> None:
    run = SimpleNamespace(
        code_lines=2000,
        security=_security(),
        quality=_quality(medium=20),
        complexity=_complexity(),
        dependencies=None,
        architecture=_architecture(),
    )
    dimensions = health.dimensions(run)
    assert [d.key for d in dimensions] == list(health.DIMENSION_KEYS)
    assert [d.name for d in dimensions] == [name for _, name in health.DIMENSIONS]
    assert [d.score for d in dimensions] == [100, 50, 100, 100, None, 100]
    small = SimpleNamespace(**{**vars(run), "code_lines": 10})  # at least 1,000 lines
    assert health.dimensions(small)[1].score == 40  # 40 per 1,000 -> 0.75 x 20 + 25
    assert dimensions[0].as_dict() == {
        "key": "security",
        "name": "Security",
        "score": 100,
        "inputs": dimensions[0].inputs,
        "explanation": dimensions[0].explanation,
        "improvements": [],
    }


def test_overall_is_the_weighted_average_of_scored_dimensions() -> None:
    weights = health.DEFAULT_WEIGHTS
    scores: dict[str, int | None] = dict.fromkeys(health.DIMENSION_KEYS, 100)
    assert health.overall(scores, weights) == 100
    scores |= {"security": 0, "dependencies": None}
    assert health.overall(scores, weights) == 71  # 100 x 60 / 85 = 70.6
    only = dict.fromkeys(health.DIMENSION_KEYS, None) | {"security": 0, "quality": 100}
    assert health.overall(only, weights) == 44  # 2,000 / 45
    assert health.overall(dict.fromkeys(health.DIMENSION_KEYS), weights) is None
    zero = dict.fromkeys(health.DIMENSION_KEYS, 0) | {"architecture": 50}
    assert health.overall(only, zero) is None  # the scored dimensions all weigh 0
    assert health.overall(dict.fromkeys(health.DIMENSION_KEYS, 80), zero) == 80


@pytest.mark.parametrize(
    ("score", "grade"),
    [
        (100, "A"), (85, "A"), (84, "B"), (70, "B"), (69, "C"), (55, "C"), (54, "D"), (40, "D"),
        (39, "F"), (0, "F"), (None, None),
    ],
)  # fmt: skip
def test_grades(score: int | None, grade: str | None) -> None:
    assert health.grade(score) == grade


def test_default_weights_cover_every_dimension() -> None:
    assert tuple(health.DEFAULT_WEIGHTS) == health.DIMENSION_KEYS
    assert sum(health.DEFAULT_WEIGHTS.values()) == 100
    assert sum(health.ARCHITECTURE_CHECKS.values()) == 100


# --- API -----------------------------------------------------------------------------------------

WEIGHTS_URL = "/api/v1/health-score/weights"
OVERVIEW_URL = "/api/v1/health-score"


def _health_url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/health"


def _history_url(owner: Owner, repository_id: str | None = None) -> str:
    return f"/api/v1/projects/{owner.project_id}/repositories/{repository_id or owner.repository_id}/health-history"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = ARCHITECTURE_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


async def _report(client: httpx.AsyncClient, owner: Owner, run_id: str) -> dict[str, Any]:
    response = await client.get(_health_url(owner, run_id), headers=owner.headers)
    assert response.status_code == 200
    return dict(response.json())


def _expected_overall(report: dict[str, Any]) -> int | None:
    return health.overall(
        {d["key"]: d["score"] for d in report["dimensions"]},
        {d["key"]: d["weight"] for d in report["dimensions"]},
    )


@requires_db
async def test_run_health_report(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    report = await _report(client, alice, run["id"])
    assert (report["run_id"], report["created_at"]) == (run["id"], run["created_at"])
    assert report["weights"] == health.DEFAULT_WEIGHTS
    assert [d["key"] for d in report["dimensions"]] == list(health.DIMENSION_KEYS)
    assert all(d["weight"] == health.DEFAULT_WEIGHTS[d["key"]] for d in report["dimensions"])
    by_key = {d["key"]: d for d in report["dimensions"]}
    # Tests set DEPENDENCY_LOOKUPS=false, so dependency health is not scored.
    assert by_key["dependencies"]["score"] is None
    assert by_key["architecture"]["score"] == 90  # tests, CI, layers; one cycle (-10)
    assert all(by_key[k]["score"] is not None for k in ("security", "quality", "complexity"))
    assert report["overall"] == _expected_overall(report) is not None
    assert report["grade"] == health.grade(report["overall"])


@requires_db
async def test_older_runs_score_architecture_from_the_stored_report(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = uuid.UUID(run["id"])
    older = {
        k: v
        for k, v in run["architecture"].items()
        if k not in ("has_tests", "has_ci", "separated")
    }
    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == run_id).values(architecture=older)
    )
    db_session.expire_all()
    architecture = (await _report(client, alice, run["id"]))["dimensions"][5]
    assert architecture["score"] == 90  # the same facts, read from the document
    await db_session.execute(delete(ArchitectureReport).where(ArchitectureReport.run_id == run_id))
    db_session.expire_all()
    architecture = (await _report(client, alice, run["id"]))["dimensions"][5]
    assert architecture["score"] == 30  # no document: only cycles (15) and entry points (15)


@requires_db
async def test_runs_without_quality_results_are_not_scored(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    second = await _analyzed_run(client, alice, monkeypatch, db_session)
    third = await _analyzed_run(client, alice, monkeypatch, db_session)
    history = (await client.get(_history_url(alice), headers=alice.headers)).json()["points"]
    assert [p["run_id"] for p in history] == [first["id"], second["id"], third["id"]]
    for point in history:
        report = await _report(client, alice, point["run_id"])
        assert (point["overall"], point["grade"], point["created_at"]) == (
            report["overall"],
            report["grade"],
            report["created_at"],
        )
        assert point["scores"] == {d["key"]: d["score"] for d in report["dimensions"]}
    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == uuid.UUID(second["id"])).values(quality=None)
    )
    db_session.expire_all()
    response = await client.get(_health_url(alice, second["id"]), headers=alice.headers)
    assert (response.status_code, response.json()) == (404, {"detail": NOT_SCORED})
    history = (await client.get(_history_url(alice), headers=alice.headers)).json()["points"]
    assert [p["run_id"] for p in history] == [first["id"], third["id"]]


@requires_db
async def test_weights_can_be_changed_and_reset(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    assert (await client.get(WEIGHTS_URL, headers=alice.headers)).json() == {
        "weights": health.DEFAULT_WEIGHTS,
        "defaults": True,
    }
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    custom = dict.fromkeys(health.DIMENSION_KEYS, 0) | {"complexity": 3, "architecture": 1}
    response = await client.put(WEIGHTS_URL, json=custom, headers=alice.headers)
    assert (response.status_code, response.json()) == (200, {"weights": custom, "defaults": False})
    assert (await client.get(WEIGHTS_URL, headers=alice.headers)).json()["weights"] == custom
    assert (await client.get(WEIGHTS_URL, headers=bob.headers)).json()["defaults"] is True
    report = await _report(client, alice, run["id"])
    assert report["weights"] == custom
    scores = {d["key"]: d["score"] for d in report["dimensions"]}
    assert report["overall"] == round((3 * scores["complexity"] + scores["architecture"]) / 4)
    overview = (await client.get(OVERVIEW_URL, headers=alice.headers)).json()
    assert overview["weights"] == custom
    assert overview["repositories"][0]["overall"] == report["overall"]
    history = (await client.get(_history_url(alice), headers=alice.headers)).json()["points"]
    assert history[-1]["overall"] == report["overall"]
    reset = await client.delete(WEIGHTS_URL, headers=alice.headers)  # custom weights stored
    assert (reset.status_code, reset.content) == (204, b"")
    assert (await client.get(WEIGHTS_URL, headers=alice.headers)).json() == {
        "weights": health.DEFAULT_WEIGHTS,
        "defaults": True,
    }
    assert (await _report(client, alice, run["id"]))["weights"] == health.DEFAULT_WEIGHTS
    same = await client.put(WEIGHTS_URL, json=health.DEFAULT_WEIGHTS, headers=alice.headers)
    assert same.json()["defaults"] is True  # saving the defaults reads as the defaults


@pytest.mark.parametrize(
    "body",
    [
        dict.fromkeys(health.DIMENSION_KEYS, 0),
        health.DEFAULT_WEIGHTS | {"security": 101},
        health.DEFAULT_WEIGHTS | {"security": -1},
        {k: v for k, v in health.DEFAULT_WEIGHTS.items() if k != "architecture"},
        health.DEFAULT_WEIGHTS | {"security": "high"},
    ],
)
@requires_db
async def test_invalid_weights_are_rejected(
    client: httpx.AsyncClient, alice: Owner, body: dict[str, Any]
) -> None:
    response = await client.put(WEIGHTS_URL, json=body, headers=alice.headers)
    assert response.status_code == 422
    assert (await client.get(WEIGHTS_URL, headers=alice.headers)).json()["defaults"] is True


@requires_db
async def test_unusable_stored_weights_fall_back_to_the_defaults(
    client: httpx.AsyncClient, alice: Owner, db_session: AsyncSession
) -> None:
    from app.models import User

    await db_session.execute(
        update(User).where(User.email == "alice@example.com").values(health_weights={"security": 5})
    )
    db_session.expire_all()
    assert (await client.get(WEIGHTS_URL, headers=alice.headers)).json() == {
        "weights": health.DEFAULT_WEIGHTS,
        "defaults": True,
    }


@requires_db
async def test_health_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    assert (await client.get(OVERVIEW_URL, headers=alice.headers)).json() == {
        "weights": health.DEFAULT_WEIGHTS,
        "repositories": [],
    }
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)
    (entry,) = (await client.get(OVERVIEW_URL, headers=alice.headers)).json()["repositories"]
    report = await _report(client, alice, latest["id"])
    assert entry == {
        "project_id": alice.project_id,
        "project_name": "Demo",
        "repository_id": alice.repository_id,
        "repository_name": "demo-repo",
        "run_id": latest["id"],
        "created_at": latest["created_at"],
        "overall": report["overall"],
        "grade": report["grade"],
        "scores": {d["key"]: d["score"] for d in report["dimensions"]},
    }
    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == uuid.UUID(latest["id"])).values(quality=None)
    )
    db_session.expire_all()
    # Like the other overviews: a repository whose latest run cannot be scored is not listed.
    assert (await client.get(OVERVIEW_URL, headers=alice.headers)).json()["repositories"] == []
    assert first["id"] != latest["id"]


@requires_db
async def test_other_users_cannot_read_health(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    url = _health_url(alice, run["id"])
    for path in (url, _history_url(alice), OVERVIEW_URL, WEIGHTS_URL):
        assert (await client.get(path)).status_code == 401
    assert (await client.put(WEIGHTS_URL, json=health.DEFAULT_WEIGHTS)).status_code == 401
    assert (await client.delete(WEIGHTS_URL)).status_code == 401
    as_bob = await client.get(url, headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    history = await client.get(_history_url(alice), headers=bob.headers)
    assert (history.status_code, history.json()) == (404, {"detail": "Repository not found"})
    via_bob = await client.get(_health_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    other = await _new_repository(client, alice, "other")
    assert (
        await client.get(_health_url(alice, run["id"], other), headers=alice.headers)
    ).status_code == 404
    assert (await client.get(_history_url(alice, other), headers=alice.headers)).json() == {
        "points": []
    }
    assert (await client.get(OVERVIEW_URL, headers=bob.headers)).json()["repositories"] == []
