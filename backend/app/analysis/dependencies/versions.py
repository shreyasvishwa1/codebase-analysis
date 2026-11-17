"""Versions: what a declaration says, and how far it is behind the latest release.

A declaration is reduced to one version to check:

* ``pinned`` - exactly one version is allowed (``==2.25.0``, ``2.25.0`` in package.json);
* ``minimum`` - a range; its lowest allowed version is checked (``>=2.25``, ``^4.17.1``,
  ``~=3.2``), because a range that allows a vulnerable version can install it;
* ``none`` - no version to check (no constraint, ``*``, ``latest``, a URL, a local path or a
  git reference).

Python versions follow PEP 440 (``packaging``); npm versions follow semver.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal

from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version

VersionSource = Literal["pinned", "minimum", "none"]
Update = Literal["up_to_date", "patch", "minor", "major", "unknown"]

_EXTRAS = re.compile(r"^\s*\[[^\]]*\]")
_NPM_EXACT = re.compile(r"^[=v]?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$")
_NPM_VERSION = re.compile(r"(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?")
_NPM_NOT_A_RANGE = ("git", "http:", "https:", "file:", "link:", "workspace:", "npm:", "github:")
_PYPI_NAME = re.compile(r"[-_.]+")


@dataclass(frozen=True)
class Declared:
    version: str | None
    source: VersionSource


def normalize_name(ecosystem: str, name: str) -> str:
    """The registry identity of a package: PEP 503 for Python, lower case for npm."""
    if ecosystem == "python":
        return _PYPI_NAME.sub("-", name).lower()
    return name.lower()


# --- Python ---------------------------------------------------------------------------------


def python_declared(specifier: str) -> Declared:
    text = _EXTRAS.sub("", specifier).split(";", 1)[0].strip()
    if not text or text.startswith("@"):
        return Declared(None, "none")  # no constraint, or a direct URL reference
    try:
        specs = list(SpecifierSet(text))
    except InvalidSpecifier:
        return Declared(None, "none")
    if len(specs) == 1 and specs[0].operator in ("==", "===") and "*" not in specs[0].version:
        return Declared(specs[0].version, "pinned")
    lower: list[Version] = []
    for spec in specs:
        if spec.operator in (">=", "~=", ">", "==") and "*" not in spec.version:
            try:
                lower.append(Version(spec.version))
            except InvalidVersion:
                continue
    if not lower:
        return Declared(None, "none")
    return Declared(str(max(lower)), "minimum")


# --- npm ------------------------------------------------------------------------------------


def npm_declared(specifier: str) -> Declared:
    text = specifier.strip()
    if not text or text in ("*", "latest", "next", "x") or text.startswith(_NPM_NOT_A_RANGE):
        return Declared(None, "none")
    exact = _NPM_EXACT.match(text)
    if exact:
        return Declared(exact.group(1), "pinned")
    # The lowest version of the first alternative (^1.2.3, ~1.2, >=1.2.3 <2, 1.x, 1.2.3 - 2).
    first = text.split("||", 1)[0]
    match = _NPM_VERSION.search(first)
    if match is None:
        return Declared(None, "none")
    major, minor, patch, pre = match.groups()

    def part(value: str | None) -> str:
        return "0" if value is None or value in ("x", "X", "*") else value

    version = f"{major}.{part(minor)}.{part(patch)}" + (f"-{pre}" if pre else "")
    return Declared(version, "minimum")


def _npm_key(version: str) -> tuple[int, int, int, int, str] | None:
    match = _NPM_VERSION.fullmatch(version.strip().lstrip("v="))
    if match is None or any(g in ("x", "X", "*") for g in match.groups()[1:3] if g):
        return None
    major, minor, patch, pre = match.groups()
    # A pre-release sorts before its release (1.0.0-rc.1 < 1.0.0).
    return (int(major), int(minor or 0), int(patch or 0), 0 if pre else 1, pre or "")


# --- Comparison -----------------------------------------------------------------------------


def _parts(ecosystem: str, version: str) -> tuple[tuple[int, int, int], object] | None:
    """(major, minor, patch) and a sort key, or None for an unparsable version."""
    if ecosystem == "python":
        try:
            parsed = Version(version)
        except InvalidVersion:
            return None
        release = (*parsed.release, 0, 0)
        return (release[0], release[1], release[2]), parsed
    key = _npm_key(version)
    if key is None:
        return None
    return (key[0], key[1], key[2]), key


def update_level(ecosystem: str, declared: str | None, latest: str | None) -> Update:
    """How far ``declared`` is behind ``latest``: the highest changed version part."""
    if declared is None or latest is None:
        return "unknown"
    current, newest = _parts(ecosystem, declared), _parts(ecosystem, latest)
    if current is None or newest is None:
        return "unknown"
    if not newest[1] > current[1]:  # type: ignore[operator]
        return "up_to_date"
    for level, (old, new) in zip(("major", "minor", "patch"), zip(current[0], newest[0])):
        if new > old:
            return level  # type: ignore[return-value]
    return "patch"  # same release numbers, newer pre/post release


def is_newer(ecosystem: str, candidate: str, than: str) -> bool:
    a, b = _parts(ecosystem, candidate), _parts(ecosystem, than)
    return a is not None and b is not None and a[1] > b[1]  # type: ignore[operator]


def sort_key(ecosystem: str, version: str) -> Any:
    parts = _parts(ecosystem, version)
    return (0, parts[1]) if parts is not None else (1, version)
