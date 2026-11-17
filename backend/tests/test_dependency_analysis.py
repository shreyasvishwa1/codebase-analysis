"""Dependency analysis tests (phase 5: Module 6).

PyPI, npm and OSV.dev are never contacted: every lookup goes to respx mocks of those exact
hosts. API tests reuse the full-analysis fixtures (the throwaway test database inside
rolled-back transactions, inline ingestion and inline analysis jobs).
"""

import asyncio
import json
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.dependencies import analyzer as analyzer_module
from app.analysis.dependencies import lookups
from app.analysis.dependencies.analyzer import DependencyAnalyzer
from app.analysis.dependencies.cvss import base_score, severity_of_score
from app.analysis.dependencies.lookups import Advisory, first_fix, merge_duplicates, registry_url
from app.analysis.dependencies.versions import (
    is_newer,
    normalize_name,
    npm_declared,
    python_declared,
    update_level,
)
from app.analysis.security.analyzer import Finding, SecurityAnalyzer, with_extra_findings
from app.analysis.summary import SnapshotFile
from app.config import get_settings
from app.models import AnalysisRun, DependencyRecord, Repository
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

CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"  # 9.8
HIGH_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"  # 7.5

# --- Versions ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("specifier", "version", "source"),
    [
        ("==2.25.0", "2.25.0", "pinned"),
        ("===1.0", "1.0", "pinned"),
        (">=2.25", "2.25", "minimum"),
        ("~=3.2", "3.2", "minimum"),
        (">=1.0,<2", "1.0", "minimum"),
        (">=1.0,>=1.5", "1.5", "minimum"),
        ("[security]>=2.0; python_version > '3'", "2.0", "minimum"),
        ("", None, "none"),
        ("<3", None, "none"),
        ("==2.*", None, "none"),
        ("@ https://example.com/x.whl", None, "none"),
        ("!!invalid", None, "none"),
    ],
)
def test_python_declared_versions(specifier: str, version: str | None, source: str) -> None:
    declared = python_declared(specifier)
    assert (declared.version, declared.source) == (version, source)


@pytest.mark.parametrize(
    ("specifier", "version", "source"),
    [
        ("1.2.3", "1.2.3", "pinned"),
        ("=1.2.3", "1.2.3", "pinned"),
        ("v2.0.0", "2.0.0", "pinned"),
        ("1.0.0-rc.1", "1.0.0-rc.1", "pinned"),
        ("^4.17.1", "4.17.1", "minimum"),
        ("~1.2", "1.2.0", "minimum"),
        (">=1.2.3 <2", "1.2.3", "minimum"),
        ("1.x", "1.0.0", "minimum"),
        ("1.2.3 - 2.0.0", "1.2.3", "minimum"),
        ("^2 || ^3", "2.0.0", "minimum"),
        ("*", None, "none"),
        ("latest", None, "none"),
        ("", None, "none"),
        ("git+https://github.com/a/b.git", None, "none"),
        ("workspace:*", None, "none"),
        ("file:../local", None, "none"),
        ("npm:other@1.0.0", None, "none"),
    ],
)
def test_npm_declared_versions(specifier: str, version: str | None, source: str) -> None:
    declared = npm_declared(specifier)
    assert (declared.version, declared.source) == (version, source)


@pytest.mark.parametrize(
    ("ecosystem", "declared", "latest", "level"),
    [
        ("python", "2.25.0", "2.32.3", "minor"),
        ("python", "2.25.0", "3.0", "major"),
        ("python", "2.25.0", "2.25.1", "patch"),
        ("python", "2.25", "2.25.0", "up_to_date"),  # equal in PEP 440
        ("python", "3.0", "2.32", "up_to_date"),  # declared is newer
        ("python", "1.0", "1.0.post1", "patch"),
        ("npm", "4.17.1", "4.21.2", "minor"),
        ("npm", "8.5.1", "9.0.3", "major"),
        ("npm", "1.0.0-rc.1", "1.0.0", "patch"),
        ("npm", "1.0.0", "1.0.0", "up_to_date"),
        ("npm", "1.0.0", None, "unknown"),
        ("npm", None, "1.0.0", "unknown"),
        ("npm", "not-a-version", "1.0.0", "unknown"),
        ("python", "1.0", "not a version", "unknown"),
    ],
)
def test_update_levels(
    ecosystem: str, declared: str | None, latest: str | None, level: str
) -> None:
    assert update_level(ecosystem, declared, latest) == level


def test_names_and_ordering() -> None:
    assert normalize_name("python", "Django_REST.framework") == "django-rest-framework"
    assert normalize_name("npm", "@Types/Node") == "@types/node"
    assert is_newer("python", "2.31.0", "2.25") and not is_newer("python", "2.25", "2.25.0")
    assert is_newer("npm", "1.10.0", "1.9.0") and not is_newer("npm", "x", "1.0.0")


# --- CVSS ------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("vector", "score"),
    [
        ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0),
        (CRITICAL_VECTOR, 9.8),
        ("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8),
        (HIGH_VECTOR, 7.5),
        ("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:N/A:N", 6.1),
        ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N", 5.3),
        ("CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N", 1.6),
        ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0.0),
        ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", None),
        ("CVSS:3.1/AV:N/AC:L", None),  # incomplete
        ("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", None),  # invalid value
        ("", None),
    ],
)
def test_cvss_base_scores(vector: str, score: float | None) -> None:
    assert base_score(vector) == score


@pytest.mark.parametrize(
    ("score", "severity"),
    [
        (10.0, "critical"),
        (9.0, "critical"),
        (8.9, "high"),
        (7.0, "high"),
        (6.9, "medium"),
        (4.0, "medium"),
        (3.9, "low"),
        (0.1, "low"),
    ],
)
def test_cvss_ratings(score: float, severity: str) -> None:
    assert severity_of_score(score) == severity


# --- Mocked services -----------------------------------------------------------------------------

LATEST = {
    "pypi": {"flask": "3.1.3", "requests": "2.34.2", "leftpad": "1.0.0"},
    "npm": {"jsonwebtoken": "9.0.3", "@types/node": "20.1.5", "vitest": "2.0.0"},
}


def _advisory(
    advisory_id: str,
    ecosystem: str,
    name: str,
    fixed: list[str],
    *,
    aliases: list[str] | None = None,
    vector: str | None = None,
    word: str | None = None,
    cwe: str | None = None,
    summary: str = "",
) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "id": advisory_id,
        "aliases": aliases or [],
        "summary": summary or f"{name} problem {advisory_id}",
        "affected": [
            {
                "package": {"name": name, "ecosystem": ecosystem},
                "ranges": [
                    {
                        "type": "ECOSYSTEM",
                        "events": [{"introduced": "0"}, *({"fixed": f} for f in fixed)],
                    }
                ],
            },
            # Another package's ranges must not leak into this one's fixed versions.
            {
                "package": {"name": "other", "ecosystem": ecosystem},
                "ranges": [{"events": [{"fixed": "99.0"}]}],
            },
        ],
    }
    if vector:
        raw["severity"] = [{"type": "CVSS_V3", "score": vector}]
    if word or cwe:
        raw["database_specific"] = {"severity": word, "cwe_ids": [cwe] if cwe else []}
    return raw


ADVISORIES = {
    # flask 2.0.1: a PYSEC and a GHSA record of the same CVE (merged into one).
    "PYSEC-2023-62": _advisory(
        "PYSEC-2023-62",
        "PyPI",
        "Flask",
        ["2.2.5"],
        aliases=["CVE-2023-30861", "GHSA-m2qf-hxjv-5gpq"],
    ),
    "GHSA-m2qf-hxjv-5gpq": _advisory(
        "GHSA-m2qf-hxjv-5gpq",
        "PyPI",
        "flask",
        ["2.2.5", "2.3.2"],
        aliases=["CVE-2023-30861"],
        vector=HIGH_VECTOR,
        word="MODERATE",  # the CVSS score (high) wins over the database word
        cwe="CWE-539",
        summary="Session cookie disclosure",
    ),
    # requests >=2.25 (the minimum is checked): severity from the advisory database only.
    "GHSA-j8r2-6x86-q33q": _advisory(
        "GHSA-j8r2-6x86-q33q",
        "PyPI",
        "requests",
        ["2.31.0"],
        aliases=["CVE-2023-32681"],
        word="MODERATE",
    ),
    # jsonwebtoken 8.5.1: a critical one and one without any severity.
    "GHSA-8cf7-32gw-wr33": _advisory(
        "GHSA-8cf7-32gw-wr33",
        "npm",
        "jsonwebtoken",
        ["9.0.0"],
        vector=CRITICAL_VECTOR,
        cwe="CWE-327",
    ),
    "GHSA-nosv-0000-0000": _advisory("GHSA-nosv-0000-0000", "npm", "jsonwebtoken", []),
}
OSV_HITS = {
    ("PyPI", "flask", "2.0.1"): ["PYSEC-2023-62", "GHSA-m2qf-hxjv-5gpq"],
    ("PyPI", "requests", "2.25"): ["GHSA-j8r2-6x86-q33q"],
    ("npm", "jsonwebtoken", "8.5.1"): ["GHSA-8cf7-32gw-wr33", "GHSA-nosv-0000-0000"],
}


@pytest.fixture
def services() -> Iterator[dict[str, list[Any]]]:
    """respx mocks of PyPI, npm and OSV.dev; records what each was asked."""
    seen: dict[str, list[Any]] = {"pypi": [], "npm": [], "osv": [], "vulns": []}

    def pypi(request: httpx.Request, name: str) -> httpx.Response:
        seen["pypi"].append(name)
        version = LATEST["pypi"].get(name)
        return (
            httpx.Response(200, json={"info": {"version": version}})
            if version
            else httpx.Response(404)
        )

    def npm(request: httpx.Request) -> httpx.Response:
        name = request.url.raw_path.decode().removeprefix("/").removesuffix("/latest")
        name = name.replace("%2F", "/").replace("%40", "@")
        seen["npm"].append(name)
        version = LATEST["npm"].get(name)
        return httpx.Response(200, json={"version": version}) if version else httpx.Response(404)

    def osv(request: httpx.Request) -> httpx.Response:
        queries = json.loads(request.content)["queries"]
        seen["osv"].append(queries)
        results = []
        for q in queries:
            ids = OSV_HITS.get((q["package"]["ecosystem"], q["package"]["name"], q["version"]), [])
            results.append(
                {"vulns": [{"id": i, "modified": "2026-01-01T00:00:00Z"} for i in ids]}
                if ids
                else {}
            )
        return httpx.Response(200, json={"results": results})

    def vuln(request: httpx.Request, advisory_id: str) -> httpx.Response:
        seen["vulns"].append(advisory_id)
        return httpx.Response(200, json=ADVISORIES[advisory_id])

    with respx.mock(assert_all_called=False) as router:
        router.get(url__regex=r"^https://pypi\.org/pypi/(?P<name>[^/]+)/json$").mock(
            side_effect=pypi
        )
        router.get(url__regex=r"^https://registry\.npmjs\.org/.+/latest$").mock(side_effect=npm)
        router.post("https://api.osv.dev/v1/querybatch").mock(side_effect=osv)
        router.get(url__regex=r"^https://api\.osv\.dev/v1/vulns/(?P<advisory_id>[^/]+)$").mock(
            side_effect=vuln
        )
        yield seen


# --- Lookups ------------------------------------------------------------------------------------------


def test_registry_urls_are_built_from_quoted_names() -> None:
    assert registry_url("python", "flask") == "https://pypi.org/pypi/flask/json"
    assert registry_url("npm", "react") == "https://registry.npmjs.org/react/latest"
    assert registry_url("npm", "@types/node") == "https://registry.npmjs.org/@types/node/latest"


def test_lookups_fill_latest_versions_and_merged_advisories(services: dict[str, list[Any]]) -> None:
    result = asyncio.run(
        lookups.look_up(
            [
                ("python", "flask"),
                ("python", "requests"),
                ("npm", "@types/node"),
                ("python", "missing-pkg"),
            ],
            [
                ("python", "flask", "2.0.1"),
                ("python", "requests", "2.25"),
                ("npm", "@types/node", "20.1.0"),
            ],
        )
    )
    assert (result.registry, result.osv) == ("completed", "completed")
    assert result.latest == {
        ("python", "flask"): "3.1.3",
        ("python", "requests"): "2.34.2",
        ("npm", "@types/node"): "20.1.5",
    }  # an unknown package (404) has no latest version
    (flask,) = result.advisories[("python", "flask", "2.0.1")]
    assert flask.id == "GHSA-m2qf-hxjv-5gpq"  # the GHSA record with a severity wins
    assert flask.aliases == ("CVE-2023-30861", "PYSEC-2023-62")
    assert (flask.severity, flask.score, flask.cwe) == ("high", 7.5, 539)
    assert flask.fixed == ("2.2.5", "2.3.2")  # union; never the other package's 99.0
    assert flask.url == "https://osv.dev/vulnerability/GHSA-m2qf-hxjv-5gpq"
    (requests,) = result.advisories[("python", "requests", "2.25")]
    assert (requests.severity, requests.score) == ("medium", None)  # MODERATE in the database
    assert ("npm", "@types/node", "20.1.0") not in result.advisories
    assert sorted(services["vulns"]) == [
        "GHSA-j8r2-6x86-q33q",
        "GHSA-m2qf-hxjv-5gpq",
        "PYSEC-2023-62",
    ]
    (batch,) = services["osv"]
    assert {"package": {"name": "flask", "ecosystem": "PyPI"}, "version": "2.0.1"} in batch


def test_lookups_skip_invalid_names_and_report_failures() -> None:
    with respx.mock(assert_all_called=False) as router:
        router.get(url__regex=r"^https://pypi\.org/.*").mock(return_value=httpx.Response(500))
        router.get(url__regex=r"^https://registry\.npmjs\.org/.*").mock(
            return_value=httpx.Response(301, headers={"Location": "https://evil.example/"})
        )
        router.post("https://api.osv.dev/v1/querybatch").mock(
            side_effect=httpx.ConnectError("down")
        )
        result = asyncio.run(
            lookups.look_up(
                [
                    ("python", "flask"),
                    ("npm", "react"),
                    ("python", "../etc/passwd"),
                    ("npm", "UPPER CASE"),
                ],
                [("python", "flask", "1.0")],
            )
        )
        called = [str(call.request.url) for call in router.calls]
    assert result.registry == "failed" and result.osv == "failed"
    assert result.latest == {} and result.advisories == {}
    assert not any("passwd" in url or "UPPER" in url or "evil" in url for url in called)


def test_partial_lookups_and_size_limits(
    monkeypatch: pytest.MonkeyPatch, services: dict[str, list[Any]]
) -> None:
    monkeypatch.setattr(lookups, "MAX_PACKAGES", 1)
    monkeypatch.setattr(lookups, "MAX_REGISTRY_BYTES", 10)  # every registry answer is too large
    result = asyncio.run(lookups.look_up([("python", "flask"), ("python", "requests")], []))
    assert result.registry == "failed"  # the one package looked up failed
    monkeypatch.setattr(lookups, "MAX_REGISTRY_BYTES", 1_000_000)
    partial = asyncio.run(lookups.look_up([("python", "flask"), ("python", "requests")], []))
    assert partial.registry == "partial" and list(partial.latest) == [("python", "flask")]
    assert partial.osv == "skipped"


def test_lookups_stop_at_the_time_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lookups, "TOTAL_SECONDS", 0.2)

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200, json={"info": {"version": "1.0"}})

    with respx.mock(assert_all_called=False) as router:
        router.get(url__regex=r"^https://pypi\.org/.*").mock(side_effect=slow)
        result = asyncio.run(lookups.look_up([("python", "flask")], [("python", "flask", "1.0")]))
    assert (result.registry, result.osv) == ("partial", "partial")


def test_merging_and_first_fix() -> None:
    def adv(
        advisory_id: str, aliases: tuple[str, ...], severity: str, fixed: tuple[str, ...] = ()
    ) -> Advisory:
        return Advisory(advisory_id, aliases, "s", severity, None, fixed, None, "u")

    merged = merge_duplicates(
        [
            adv("PYSEC-1", ("CVE-1",), "unknown", ("1.2",)),
            adv("GHSA-a", ("CVE-1",), "high", ("1.3",)),
            adv("OSV-2", ("CVE-1", "CVE-2"), "unknown"),  # links CVE-2 into the same group
            adv("GHSA-b", ("CVE-9",), "low"),
        ]
    )
    assert [(a.id, a.severity) for a in merged] == [("GHSA-a", "high"), ("GHSA-b", "low")]
    # A rated record wins over an unrated GHSA record of the same vulnerability.
    rated = merge_duplicates(
        [adv("GHSA-z", ("CVE-7",), "unknown"), adv("PYSEC-7", ("CVE-7",), "medium")]
    )
    assert [(a.id, a.severity) for a in rated] == [("PYSEC-7", "medium")]
    assert merged[0].aliases == ("CVE-1", "CVE-2", "OSV-2", "PYSEC-1")
    assert merged[0].fixed == ("1.2", "1.3")
    fix = adv("X", (), "high", ("1.2.0", "2.0.0", "1.10.0"))
    assert first_fix("npm", fix, "1.5.0") == "1.10.0"
    assert first_fix("npm", fix, "2.0.0") is None


# --- Analyzer ----------------------------------------------------------------------------------------

REQUIREMENTS = "# app\nflask==2.0.1\nrequests>=2.25\nleftpad\n"
BACKEND_REQUIREMENTS = "requests==2.31.0\n"
PACKAGE_JSON = json.dumps(
    {
        "name": "shop",
        "dependencies": {"jsonwebtoken": "8.5.1", "@types/node": "^20.1.0"},
        "devDependencies": {"vitest": "latest"},
    },
    indent=2,
)


def _text(path: str, text: str) -> SnapshotFile:
    return SnapshotFile(path, None, len(text.encode()), "text", text)


MANIFESTS = [
    _text("requirements.txt", REQUIREMENTS),
    _text("backend/requirements.txt", BACKEND_REQUIREMENTS),
    _text("web/package.json", PACKAGE_JSON),
    _text("node_modules/lib/package.json", '{"dependencies": {"x": "1.0.0"}}'),  # excluded
    _text("broken/package.json", "{not json"),
    _text("README.md", "flask==1.0"),
]


def _analyzer(files: list[SnapshotFile] = MANIFESTS) -> DependencyAnalyzer:
    analyzer = DependencyAnalyzer()
    for file in files:
        analyzer.add(file)
    return analyzer


def test_declarations_lines_and_conflicts() -> None:
    analyzer = _analyzer()
    analyzer.mark_conflicts()
    rows = {(r.manifest, r.name): r for r in analyzer.records}
    assert set(rows) == {
        ("requirements.txt", "flask"),
        ("requirements.txt", "requests"),
        ("requirements.txt", "leftpad"),
        ("backend/requirements.txt", "requests"),
        ("web/package.json", "jsonwebtoken"),
        ("web/package.json", "@types/node"),
        ("web/package.json", "vitest"),
    }
    flask = rows[("requirements.txt", "flask")]
    assert (flask.ecosystem, flask.scope, flask.line, flask.version, flask.version_source) == (
        "python", "runtime", 2, "2.0.1", "pinned",
    )  # fmt: skip
    assert rows[("requirements.txt", "requests")].version_source == "minimum"
    assert rows[("requirements.txt", "leftpad")].version_source == "none"
    jwt = rows[("web/package.json", "jsonwebtoken")]
    assert (jwt.ecosystem, jwt.line, jwt.version_source) == ("npm", 4, "pinned")
    assert rows[("web/package.json", "@types/node")].line == 5
    assert rows[("web/package.json", "vitest")].scope == "dev"
    assert {r.name for r in analyzer.records if r.conflict} == {"requests"}  # >=2.25 vs ==2.31.0
    assert analyzer.manifests == {"parsed": 3, "invalid": 1}


def test_conflicts_within_one_manifest() -> None:
    text = json.dumps(
        {
            "dependencies": {"left": "1.0.0", "same": "2.0.0"},
            "devDependencies": {"left": "^2.0.0", "same": "2.0.0"},
        }
    )
    analyzer = _analyzer([_text("package.json", text)])
    analyzer.mark_conflicts()
    assert sorted((r.name, r.conflict) for r in analyzer.records) == [
        ("left", True), ("left", True), ("same", False), ("same", False),
    ]  # fmt: skip


def test_limits_on_manifests_and_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_MANIFESTS", 1)
    analyzer = _analyzer()
    assert analyzer.truncated and analyzer.manifests.total() == 1
    monkeypatch.setattr(analyzer_module, "MAX_MANIFESTS", 50)
    monkeypatch.setattr(analyzer_module, "MAX_DEPENDENCIES", 2)
    capped = _analyzer()
    assert capped.truncated and len(capped.records) == 2


def test_lookups_disabled_send_nothing() -> None:
    analyzer = _analyzer()
    with respx.mock(assert_all_called=False) as router:
        asyncio.run(analyzer.check(enabled=False))
        assert router.calls.call_count == 0
    summary = analyzer.summary()
    assert summary["lookups"] == {"registry": "disabled", "osv": "disabled", "checked_at": None}
    assert summary["updates"]["unknown"] == 7 and summary["vulnerabilities"] == 0
    assert analyzer.security_findings() == []
    assert [c["name"] for c in summary["conflicts"]] == ["requests"]  # conflicts need no lookup


def test_check_fills_records_summary_and_security_findings(services: dict[str, list[Any]]) -> None:
    analyzer = _analyzer()
    asyncio.run(analyzer.check(enabled=True))
    rows = {(r.manifest, r.name): r for r in analyzer.records}
    flask = rows[("requirements.txt", "flask")]
    assert (flask.latest_version, flask.update, flask.vulnerability_count, flask.max_severity) == (
        "3.1.3", "major", 1, "high",
    )  # fmt: skip
    assert flask.vulnerabilities[0]["fixed_in"] == "2.2.5"
    jwt = rows[("web/package.json", "jsonwebtoken")]
    assert [v["severity"] for v in jwt.vulnerabilities] == ["critical", "unknown"]
    assert jwt.max_severity == "critical"
    assert rows[("web/package.json", "@types/node")].update == "patch"
    assert rows[("requirements.txt", "leftpad")].update == "unknown"  # no version to compare
    assert rows[("web/package.json", "vitest")].update == "unknown"
    assert rows[("backend/requirements.txt", "requests")].vulnerability_count == 0  # 2.31.0

    summary = analyzer.summary()
    assert summary["lookups"]["registry"] == summary["lookups"]["osv"] == "completed"
    assert summary["lookups"]["checked_at"] is not None
    assert summary["dependencies"] == 7
    assert summary["by_ecosystem"] == {"python": 4, "npm": 3}
    assert summary["by_scope"] == {"runtime": 6, "dev": 1, "other": 0}
    assert summary["by_version_source"] == {"pinned": 3, "minimum": 2, "none": 2}
    assert summary["updates"] == {"up_to_date": 0, "patch": 1, "minor": 2, "major": 2, "unknown": 2}
    assert (summary["vulnerable_dependencies"], summary["vulnerabilities"]) == (3, 4)
    assert summary["by_severity"] == {"critical": 1, "high": 1, "medium": 1, "low": 0, "unknown": 1}
    # Each vulnerable dependency once, by its worst vulnerability (jsonwebtoken: critical).
    assert summary["vulnerable_by_max_severity"] == {
        "critical": 1, "high": 1, "medium": 1, "low": 0, "unknown": 0,
    }  # fmt: skip
    assert summary["conflicts"] == [
        {
            "ecosystem": "python",
            "name": "requests",
            "declarations": [
                {"manifest": "requirements.txt", "specifier": ">=2.25"},
                {"manifest": "backend/requirements.txt", "specifier": "==2.31.0"},
            ],
        }
    ]

    findings = {(f.path, f.rule_id): f for f in analyzer.security_findings()}
    assert len(findings) == 4
    flask_finding = findings[("requirements.txt", "GHSA-m2qf-hxjv-5gpq")]
    assert (flask_finding.line, flask_finding.owasp, flask_finding.cwe, flask_finding.tool) == (
        2,
        "A06",
        539,
        "osv",
    )
    assert (flask_finding.severity, flask_finding.confidence) == ("high", "confirmed")
    assert flask_finding.title == "Vulnerable dependency: flask 2.0.1"
    assert (
        flask_finding.message == "CVE-2023-30861 (GHSA-m2qf-hxjv-5gpq): Session cookie disclosure"
    )
    assert flask_finding.recommendation == "Upgrade flask to 2.2.5 or later."
    assert flask_finding.doc_url == "https://osv.dev/vulnerability/GHSA-m2qf-hxjv-5gpq"
    requests_finding = findings[("requirements.txt", "GHSA-j8r2-6x86-q33q")]
    assert requests_finding.confidence == "potential"  # only the range's lowest version
    assert "lowest version the declared range allows" in requests_finding.explanation
    unknown = findings[("web/package.json", "GHSA-nosv-0000-0000")]
    assert (unknown.severity, unknown.cwe) == ("medium", 1395)
    assert unknown.message.endswith("(severity not published)")
    assert unknown.recommendation.startswith("No fixed version is published yet")


def test_dependency_findings_join_the_security_results(tmp_path: Any) -> None:
    security = SecurityAnalyzer(tmp_path)
    security.add(SnapshotFile("app.js", "JavaScript", 8, "text", "eval(x)\n"))
    base = security.result()
    extra = [
        Finding("requirements.txt", 2, 2, "osv", "GHSA-1", "Vulnerable dependency: a 1", "A06", 1395,
                "critical", "confirmed", "m", "e", "r", "https://osv.dev/vulnerability/GHSA-1"),
        Finding("requirements.txt", 3, 3, "osv", "GHSA-2", "Vulnerable dependency: b 1", "A06", 1395,
                "low", "potential", "m", "e", "r", None),
    ]  # fmt: skip
    merged = with_extra_findings(base, extra)
    summary = merged.summary
    assert summary["findings"] == base.summary["findings"] + 2
    assert summary["by_owasp"]["A06"] == 2 and summary["by_severity"]["critical"] == 1
    assert summary["by_confidence"]["potential"] == base.summary["by_confidence"]["potential"] + 1
    before = base.summary["by_severity_confidence"]
    assert summary["by_severity_confidence"] == before | {
        "critical": {"confirmed": before["critical"]["confirmed"] + 1, "potential": before["critical"]["potential"]},
        "low": {"confirmed": before["low"]["confirmed"], "potential": before["low"]["potential"] + 1},
    }  # fmt: skip
    assert base.summary["by_severity_confidence"] is before and sum(
        level for levels in before.values() for level in levels.values()
    ) == base.summary["findings"]  # the base summary is not changed
    assert merged.findings[0].rule_id == "GHSA-1"  # critical first
    assert summary["stored_findings"] == len(merged.findings) == len(base.findings) + 2
    assert summary["top_files"][0] == {
        "path": "requirements.txt", "findings": 2, "critical": 1, "high": 0, "medium": 0, "low": 1,
    }  # fmt: skip
    assert {r["rule_id"] for r in summary["top_rules"]} >= {"GHSA-1", "GHSA-2", "js-eval"}
    assert with_extra_findings(base, []) is base


# --- API -----------------------------------------------------------------------------------------

DEPENDENCY_FILES: dict[str, bytes] = {
    **FILES,
    "requirements.txt": REQUIREMENTS.encode(),
    "backend/requirements.txt": BACKEND_REQUIREMENTS.encode(),
    "web/package.json": PACKAGE_JSON.encode(),
    "node_modules/lib/package.json": b'{"dependencies": {"x": "1.0.0"}}',
}


@pytest.fixture
def lookups_on(
    monkeypatch: pytest.MonkeyPatch, services: dict[str, list[Any]]
) -> dict[str, list[Any]]:
    monkeypatch.setattr(get_settings(), "dependency_lookups", True)
    return services


def _url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/dependencies"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = DEPENDENCY_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


async def _get(
    client: httpx.AsyncClient, owner: Owner, run_id: str, **params: Any
) -> dict[str, Any]:
    response = await client.get(_url(owner, run_id), params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


@requires_db
async def test_run_stores_dependencies_and_vulnerable_ones_in_security(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    lookups_on: dict[str, list[Any]],
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    summary = run["dependencies"]
    assert (summary["dependencies"], summary["vulnerabilities"]) == (7, 4)
    assert summary["lookups"]["registry"] == summary["lookups"]["osv"] == "completed"
    assert summary["manifests"]["parsed"] == 3  # node_modules/ is excluded
    stored = await db_session.scalar(
        select(func.count())
        .select_from(DependencyRecord)
        .where(DependencyRecord.run_id == uuid.UUID(run["id"]))
    )
    assert stored == 7
    assert run["security"]["by_owasp"]["A06"] == 4
    findings = (
        await client.get(
            f"{_runs_url(alice)}/{run['id']}/security-findings",
            params={"owasp": "A06"},
            headers=alice.headers,
        )
    ).json()
    assert {f["rule_id"] for f in findings["items"]} == {
        "GHSA-m2qf-hxjv-5gpq", "GHSA-j8r2-6x86-q33q", "GHSA-8cf7-32gw-wr33", "GHSA-nosv-0000-0000",
    }  # fmt: skip

    page = await _get(client, alice, run["id"])
    first = page["items"][0]
    assert (first["name"], first["max_severity"], first["vulnerability_count"]) == (
        "jsonwebtoken",
        "critical",
        2,
    )
    assert first["vulnerabilities"][0] == {
        "id": "GHSA-8cf7-32gw-wr33", "aliases": [], "summary": "jsonwebtoken problem GHSA-8cf7-32gw-wr33",
        "severity": "critical", "score": 9.8, "fixed_in": "9.0.0", "cwe": 327,
        "url": "https://osv.dev/vulnerability/GHSA-8cf7-32gw-wr33",
    }  # fmt: skip
    assert set(first) == {
        "id", "manifest", "ecosystem", "name", "specifier", "scope", "line", "version",
        "version_source", "latest_version", "update", "vulnerability_count", "max_severity",
        "vulnerabilities", "conflict",
    }  # fmt: skip


@requires_db
async def test_dependency_filters_sorting_and_paging(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    lookups_on: dict[str, list[Any]],
) -> None:
    run_id = (await _analyzed_run(client, alice, monkeypatch, db_session))["id"]

    async def names(**params: Any) -> list[str]:
        return [f"{i['name']}" for i in (await _get(client, alice, run_id, **params))["items"]]

    # Risk: most severe vulnerability, most vulnerabilities, then most outdated, then name.
    assert await names() == [
        "jsonwebtoken",  # critical
        "flask",  # high
        "requests",  # medium (>=2.25)
        "requests",  # no vulnerability, a minor update (==2.31.0)
        "@types/node",  # a patch update
        "leftpad",  # unknown
        "vitest",  # unknown
    ]
    assert await names(sort="name") == [
        "@types/node",
        "flask",
        "jsonwebtoken",
        "leftpad",
        "requests",
        "requests",
        "vitest",
    ]
    assert (await names(sort="update"))[:2] == ["flask", "jsonwebtoken"]  # major first
    assert await names(ecosystem="npm", sort="name") == ["@types/node", "jsonwebtoken", "vitest"]
    assert await names(scope="dev") == ["vitest"]
    assert await names(scope="runtime", ecosystem="npm", sort="name") == [
        "@types/node",
        "jsonwebtoken",
    ]
    assert await names(scope="other") == []
    assert await names(update="patch") == ["@types/node"]
    assert await names(vulnerable=True) == ["jsonwebtoken", "flask", "requests"]
    assert len(await names(vulnerable=False)) == 4
    assert await names(conflict=True) == ["requests", "requests"]
    assert await names(q="REQUE") == ["requests", "requests"]  # name, case-insensitive
    assert len(await names(q="requirements")) == 4  # manifest paths match too
    assert await names(q="backend/") == ["requests"]
    assert await names(q="%") == []
    one = await _get(client, alice, run_id, page_size=2, page=2)
    assert ([i["name"] for i in one["items"]], one["total"]) == (["requests", "requests"], 7)


@requires_db
async def test_lookups_disabled_still_list_declarations(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    with respx.mock(assert_all_called=False) as router:
        run = await _analyzed_run(client, alice, monkeypatch, db_session)
        assert router.calls.call_count == 0
    summary = run["dependencies"]
    assert summary["lookups"] == {"registry": "disabled", "osv": "disabled", "checked_at": None}
    assert summary["dependencies"] == 7 and summary["vulnerabilities"] == 0
    assert run["security"]["by_owasp"]["A06"] == 0
    items = (await _get(client, alice, run["id"]))["items"]
    assert all(i["latest_version"] is None and i["update"] == "unknown" for i in items)


@requires_db
@pytest.mark.parametrize(
    "params",
    [
        {"ecosystem": "maven"},
        {"scope": "peer"},
        {"update": "minor-ish"},
        {"sort": "size"},
        {"vulnerable": "maybe"},
        {"page_size": 201},
        {"q": "x" * 201},
    ],
)
async def test_invalid_dependency_filters_are_rejected(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    params: dict[str, Any],
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    response = await client.get(_url(alice, run["id"]), params=params, headers=alice.headers)
    assert response.status_code == 422


@requires_db
async def test_other_users_and_repositories_cannot_read_dependencies(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    url = _url(alice, run["id"])
    assert (await client.get(url)).status_code == 401
    as_bob = await client.get(url, headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    via_bob = await client.get(_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    other = await _new_repository(client, alice, "other")
    assert (
        await client.get(_url(alice, run["id"], other), headers=alice.headers)
    ).status_code == 404
    assert (await client.get("/api/v1/dependency-analysis", headers=bob.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_dependency_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    overview_url = "/api/v1/dependency-analysis"
    assert (await client.get(overview_url, headers=alice.headers)).json() == {"repositories": []}
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)
    (entry,) = (await client.get(overview_url, headers=alice.headers)).json()["repositories"]
    assert entry["run_id"] == latest["id"] != first["id"]
    assert entry["dependencies"] == latest["dependencies"]
    assert (entry["repository_name"], entry["project_name"]) == ("demo-repo", "Demo")
    await db_session.execute(
        update(AnalysisRun)
        .where(AnalysisRun.id == uuid.UUID(latest["id"]))
        .values(dependencies=None)
    )
    assert (await client.get(overview_url, headers=alice.headers)).json() == {"repositories": []}
    legacy = next(r for r in (await _runs(client, alice))["runs"] if r["id"] == latest["id"])
    assert legacy["dependencies"] is None


@requires_db
async def test_dependencies_are_removed_with_their_repository(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    count = (
        select(func.count())
        .select_from(DependencyRecord)
        .where(DependencyRecord.run_id == uuid.UUID(run["id"]))
    )
    assert (await db_session.scalar(count) or 0) > 0
    await db_session.execute(
        delete(Repository).where(Repository.id == uuid.UUID(alice.repository_id))
    )
    assert await db_session.scalar(count) == 0
    assert (await client.get(_repo_url(alice), headers=alice.headers)).status_code == 404
