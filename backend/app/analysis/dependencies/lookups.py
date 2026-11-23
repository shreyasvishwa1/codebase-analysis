"""Looking up declared dependencies on public services: the latest version on PyPI or npm and
known vulnerabilities on OSV.dev.

Only these fixed HTTPS hosts are contacted, with URLs built from validated package names
(quoted) and validated vulnerability ids; nothing from the repository is ever used as a URL.
Requests do not follow redirects, ignore proxy settings and stored credentials, have
timeouts, and responses are read up to a size cap. The number of packages and advisories,
the concurrency and the total time are bounded; whatever is not looked up in time is
reported as unknown, never guessed. What is sent: package names and declared versions.
"""

import asyncio
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import quote

import httpx

from app.analysis.dependencies.cvss import base_score, severity_of_score
from app.analysis.dependencies.versions import is_newer, normalize_name, sort_key

PYPI_URL = "https://pypi.org/pypi/{name}/json"
NPM_URL = "https://registry.npmjs.org/{name}/latest"
OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
OSV_VULN_URL = "https://api.osv.dev/v1/vulns/{id}"
OSV_PAGE = "https://osv.dev/vulnerability/{id}"
USER_AGENT = "CodeBase-Analysis-dependency-check"

MAX_PACKAGES = 500  # distinct packages looked up on PyPI/npm
MAX_QUERIES = 1000  # package versions sent to OSV.dev (one batch)
MAX_ADVISORIES = 300  # advisory details fetched
MAX_PER_PACKAGE = 20  # advisories kept per package version
CONCURRENCY = 8
REQUEST_TIMEOUT = httpx.Timeout(15.0, connect=10.0)
TOTAL_SECONDS = 120.0
MAX_REGISTRY_BYTES = 16 * 1024 * 1024
MAX_OSV_BYTES = 4 * 1024 * 1024
MAX_SUMMARY_CHARS = 300

OSV_ECOSYSTEMS = {"python": "PyPI", "npm": "npm"}
_PYTHON_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")
_NPM_NAME = re.compile(r"^(?:@[a-z0-9][a-z0-9._~-]{0,99}/)?[a-z0-9][a-z0-9._~-]{0,199}$", re.I)
_ADVISORY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,80}$")
_SEVERITY_WORDS = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MODERATE": "medium",
    "MEDIUM": "medium",
    "LOW": "low",
}
_CWE = re.compile(r"^CWE-(\d{1,5})$")

LookupStatus = Literal["completed", "partial", "failed", "disabled", "skipped"]
Key = tuple[str, str]  # (ecosystem, normalized name)
VersionKey = tuple[str, str, str]  # (ecosystem, normalized name, version)


@dataclass(frozen=True)
class Advisory:
    id: str
    aliases: tuple[str, ...]
    summary: str
    severity: str  # critical, high, medium, low or unknown
    score: float | None  # CVSS v3 base score, when published
    fixed: tuple[str, ...]  # versions of this package that fix it
    cwe: int | None
    url: str


@dataclass
class LookupResult:
    latest: dict[Key, str] = field(default_factory=dict)
    advisories: dict[VersionKey, list[Advisory]] = field(default_factory=dict)
    registry: LookupStatus = "skipped"
    osv: LookupStatus = "skipped"


class _ResponseError(Exception):
    pass


def valid_name(ecosystem: str, name: str) -> bool:
    pattern = _PYTHON_NAME if ecosystem == "python" else _NPM_NAME
    return bool(pattern.match(name))


def registry_url(ecosystem: str, name: str) -> str:
    if ecosystem == "python":
        return PYPI_URL.format(name=quote(name, safe=""))
    scope, _, package = name.rpartition("/")
    path = f"{quote(scope, safe='@')}/{quote(package, safe='')}" if scope else quote(name, safe="")
    return NPM_URL.format(name=path)


async def _get_json(
    client: httpx.AsyncClient, method: str, url: str, limit: int, body: Any = None
) -> Any:
    request = client.build_request(method, url, json=body)
    response = await client.send(request, stream=True)
    try:
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise _ResponseError
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > limit:
                raise _ResponseError
        return json.loads(bytes(data))
    finally:
        await response.aclose()


# PyPI's project document starts with its "info" object (which holds the latest version),
# followed by every release and file ever published: megabytes for a large project.
_LEADING_INFO = re.compile(rb'\A\s*\{\s*"info"\s*:\s*')
_NOT_LEADING = object()


def _leading_info(data: bytes | bytearray) -> Any:
    """The document's leading "info" object once it has arrived in full; None while it is
    incomplete; _NOT_LEADING when the document does not start with it."""
    start = _LEADING_INFO.match(data)
    if start is None:
        return None if len(data) < 64 else _NOT_LEADING
    try:
        text = bytes(data).decode("utf-8")
    except UnicodeDecodeError as error:  # a character split across chunks
        text = bytes(data[: error.start]).decode("utf-8")
    try:
        # The matched prefix is ASCII, so its byte length is also its length in characters.
        info, _ = json.JSONDecoder().raw_decode(text, start.end())
    except ValueError:
        return None
    return info


async def _pypi_info(client: httpx.AsyncClient, url: str, limit: int) -> Any:
    """PyPI's project document, read only as far as its leading "info" object: the same value
    as ``_get_json(...)["info"]`` without downloading and decoding every release. A document
    that does not start with "info" is read in full, as before."""
    request = client.build_request("GET", url)
    response = await client.send(request, stream=True)
    try:
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise _ResponseError
        data = bytearray()
        leading = True
        next_try = 0
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > limit:
                raise _ResponseError
            # Try again each time the buffer has doubled, so a long "info" costs O(n).
            if leading and len(data) >= next_try:
                info = _leading_info(data)
                if info is _NOT_LEADING:
                    leading = False
                elif info is not None:
                    return {"info": info}
                next_try = 2 * len(data)
        return json.loads(bytes(data))
    finally:
        await response.aclose()


async def _latest(client: httpx.AsyncClient, ecosystem: str, name: str) -> str | None:
    url = registry_url(ecosystem, name)
    if ecosystem == "python":
        data = await _pypi_info(client, url, MAX_REGISTRY_BYTES)
    else:
        data = await _get_json(client, "GET", url, MAX_REGISTRY_BYTES)
    if not isinstance(data, dict):
        return None
    version = (
        (data.get("info") or {}).get("version") if ecosystem == "python" else data.get("version")
    )
    return version if isinstance(version, str) and 0 < len(version) <= 100 else None


def _severity(advisory: dict[str, Any]) -> tuple[str, float | None]:
    score: float | None = None
    for entry in advisory.get("severity") or []:
        if isinstance(entry, dict) and str(entry.get("type", "")).startswith("CVSS_V3"):
            value = base_score(str(entry.get("score", "")))
            if value is not None:
                score = value if score is None else max(score, value)
    if score is not None and score > 0:
        return severity_of_score(score), score
    word = (advisory.get("database_specific") or {}).get("severity")
    return _SEVERITY_WORDS.get(str(word).upper(), "unknown"), score


def _fixed_versions(advisory: dict[str, Any], ecosystem: str, name: str) -> tuple[str, ...]:
    fixed: set[str] = set()
    for affected in advisory.get("affected") or []:
        package = (affected or {}).get("package") or {}
        if package.get("ecosystem") != OSV_ECOSYSTEMS[ecosystem]:
            continue
        if normalize_name(ecosystem, str(package.get("name", ""))) != name:
            continue
        for affected_range in affected.get("ranges") or []:
            for event in (affected_range or {}).get("events") or []:
                version = (event or {}).get("fixed")
                if isinstance(version, str) and len(version) <= 100:
                    fixed.add(version)
    return tuple(sorted(fixed, key=lambda v: sort_key(ecosystem, v)))


def _advisory(raw: dict[str, Any], ecosystem: str, name: str) -> Advisory:
    advisory_id = str(raw.get("id", ""))
    summary = str(raw.get("summary") or raw.get("details") or "").strip().splitlines()
    cwes = [
        int(m.group(1))
        for value in (raw.get("database_specific") or {}).get("cwe_ids") or []
        if (m := _CWE.match(str(value)))
    ]
    severity, score = _severity(raw)
    return Advisory(
        id=advisory_id,
        aliases=tuple(
            sorted(str(a) for a in raw.get("aliases") or [] if _ADVISORY_ID.match(str(a)))
        ),
        summary=(summary[0] if summary else "")[:MAX_SUMMARY_CHARS],
        severity=severity,
        score=score,
        fixed=_fixed_versions(raw, ecosystem, name),
        cwe=cwes[0] if cwes else None,
        url=OSV_PAGE.format(id=quote(advisory_id, safe="")),
    )


_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}


def merge_duplicates(advisories: Iterable[Advisory]) -> list[Advisory]:
    """One advisory per vulnerability: records that share an id or alias (a PYSEC and a GHSA
    record of the same CVE) are merged, keeping the most informative one (known severity,
    a GHSA id) and the union of their aliases and fixed versions."""
    groups: list[list[Advisory]] = []
    for advisory in advisories:
        names = {advisory.id, *advisory.aliases}
        joined = [g for g in groups if any(names & {a.id, *a.aliases} for a in g)]
        merged = [advisory] + [a for g in joined for a in g]
        groups = [g for g in groups if g not in joined] + [merged]
    result: list[Advisory] = []
    for group in groups:
        best = min(
            group,
            key=lambda a: (a.severity == "unknown", not a.id.startswith("GHSA-"), a.id),
        )
        ids = {i for a in group for i in (a.id, *a.aliases)} - {best.id}
        fixed = {v for a in group for v in a.fixed}
        result.append(
            Advisory(
                id=best.id,
                aliases=tuple(sorted(ids)),
                summary=best.summary or next((a.summary for a in group if a.summary), ""),
                severity=best.severity,
                score=best.score,
                fixed=tuple(sorted(fixed, key=lambda v: (len(v), v))),
                cwe=next((a.cwe for a in (best, *group) if a.cwe is not None), best.cwe),
                url=best.url,
            )
        )
    return sorted(result, key=lambda a: (_SEVERITY_RANK[a.severity], a.id))


def first_fix(ecosystem: str, advisory: Advisory, version: str) -> str | None:
    """The lowest fixed version newer than ``version``."""
    newer = [v for v in advisory.fixed if is_newer(ecosystem, v, version)]
    return min(newer, key=lambda v: sort_key(ecosystem, v)) if newer else None


async def look_up(
    packages: Iterable[Key],
    versions: Iterable[VersionKey],
    client: httpx.AsyncClient | None = None,
) -> LookupResult:
    """Latest versions of ``packages`` and advisories affecting ``versions``."""
    result = LookupResult()
    owned = client is None
    http = client or httpx.AsyncClient(
        follow_redirects=False,
        trust_env=False,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    semaphore = asyncio.Semaphore(CONCURRENCY)
    try:
        async with asyncio.timeout(TOTAL_SECONDS):
            await _registries(http, semaphore, sorted(set(packages)), result)
            await _osv(http, semaphore, sorted(set(versions)), result)
    except TimeoutError:
        result.registry = "partial" if result.registry == "skipped" else result.registry
        result.osv = "partial" if result.osv == "skipped" else result.osv
    finally:
        if owned:
            await http.aclose()
    return result


async def _registries(
    http: httpx.AsyncClient, semaphore: asyncio.Semaphore, packages: list[Key], result: LookupResult
) -> None:
    wanted = [(e, n) for e, n in packages if valid_name(e, n)][:MAX_PACKAGES]
    if not wanted:
        result.registry = "skipped"
        return
    failures = 0

    async def one(ecosystem: str, name: str) -> None:
        nonlocal failures
        async with semaphore:
            try:
                version = await _latest(http, ecosystem, name)
            except (httpx.HTTPError, _ResponseError, ValueError):
                failures += 1
                return
        if version is not None:
            result.latest[(ecosystem, name)] = version

    await asyncio.gather(*(one(e, n) for e, n in wanted))
    skipped = len(packages) > len(wanted)
    if failures == len(wanted):
        result.registry = "failed"
    else:
        result.registry = "partial" if failures or skipped else "completed"


async def _osv(
    http: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    versions: list[VersionKey],
    result: LookupResult,
) -> None:
    queries = [(e, n, v) for e, n, v in versions if valid_name(e, n) and 0 < len(v) <= 100]
    queries = queries[:MAX_QUERIES]
    if not queries:
        result.osv = "skipped"
        return
    body = {
        "queries": [
            {"package": {"name": n, "ecosystem": OSV_ECOSYSTEMS[e]}, "version": v}
            for e, n, v in queries
        ]
    }
    try:
        data = await _get_json(http, "POST", OSV_BATCH_URL, MAX_OSV_BYTES, body)
        answers = data.get("results") if isinstance(data, dict) else None
        if not isinstance(answers, list) or len(answers) != len(queries):
            raise _ResponseError
    except (httpx.HTTPError, _ResponseError, ValueError):
        result.osv = "failed"
        return

    found: dict[VersionKey, list[str]] = {}
    for query, answer in zip(queries, answers):
        ids = [
            str(v.get("id"))
            for v in ((answer or {}).get("vulns") or [])
            if isinstance(v, dict) and _ADVISORY_ID.match(str(v.get("id", "")))
        ]
        if ids:
            found[query] = ids[: MAX_PER_PACKAGE * 2]
    unique = sorted({i for ids in found.values() for i in ids})
    details: dict[str, dict[str, Any]] = {}
    failures = 0

    async def detail(advisory_id: str) -> None:
        nonlocal failures
        async with semaphore:
            try:
                raw = await _get_json(
                    http, "GET", OSV_VULN_URL.format(id=quote(advisory_id, safe="")), MAX_OSV_BYTES
                )
            except (httpx.HTTPError, _ResponseError, ValueError):
                failures += 1
                return
        if isinstance(raw, dict) and raw.get("id") == advisory_id:
            details[advisory_id] = raw
        else:
            failures += 1

    await asyncio.gather(*(detail(i) for i in unique[:MAX_ADVISORIES]))
    for (ecosystem, name, version), ids in found.items():
        advisories = [_advisory(details[i], ecosystem, name) for i in ids if i in details]
        if advisories:
            result.advisories[(ecosystem, name, version)] = merge_duplicates(advisories)[
                :MAX_PER_PACKAGE
            ]
    partial = failures or len(unique) > MAX_ADVISORIES or len(versions) > len(queries)
    result.osv = "partial" if partial else "completed"
