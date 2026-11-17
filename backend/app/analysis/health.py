"""The Code Health Score (Module 8): six dimensions scored 0-100 from a run's stored summaries,
combined by a weighted average with the user's weights.

Nothing here reads code: every input is a number the other analyses already stored, and every
dimension reports its inputs, how the score was reached and what would raise it. A dimension
that does not apply (no source code, no declared dependencies, lookups turned off) has no score
and is left out of the average, so it neither helps nor hurts.

Densities are per 1,000 lines of code (non-blank lines; at least 1,000), so a large project
is not punished for its size. A density ``d`` becomes a score with ``100 / (1 + d / HALF)``:
100 with nothing found, 50 at the HALF density, approaching 0 as problems pile up.
"""

from dataclasses import dataclass
from typing import Any

DIMENSIONS: tuple[tuple[str, str], ...] = (
    ("security", "Security"),
    ("quality", "Code quality"),
    ("complexity", "Complexity"),
    ("maintainability", "Maintainability"),
    ("dependencies", "Dependency health"),
    ("architecture", "Architecture"),
)
DIMENSION_KEYS = tuple(key for key, _ in DIMENSIONS)
DEFAULT_WEIGHTS: dict[str, int] = {
    "security": 25,
    "quality": 20,
    "complexity": 15,
    "maintainability": 15,
    "dependencies": 15,
    "architecture": 10,
}
GRADES = ((85, "A"), (70, "B"), (55, "C"), (40, "D"), (0, "F"))

# Security: points per finding by severity; potential findings count half.
SECURITY_POINTS = {"critical": 10.0, "high": 5.0, "medium": 2.0, "low": 0.5}
POTENTIAL_FACTOR = 0.5
SECURITY_HALF = 2.0  # points per 1,000 lines for a score of 50
CONFIRMED_CRITICAL_CAP = 40  # a confirmed critical finding caps the score
CONFIRMED_HIGH_CAP = 70
# Code quality: points per issue by severity; duplication is a quarter of the score.
QUALITY_POINTS = {"high": 5.0, "medium": 2.0, "low": 0.5, "info": 0.1}
QUALITY_HALF = 10.0
DUPLICATION_SHARE = 0.25
DUPLICATION_ZERO = 25.0  # percent of duplicated lines that scores 0
# Complexity: share of medium and high functions, and the average.
MEDIUM_PENALTY = 150.0  # per share of medium functions (10% medium -> -15)
HIGH_PENALTY = 400.0  # per share of high functions (2% high -> -8)
AVERAGE_FREE = 5.0  # average complexity allowed before a penalty
AVERAGE_PENALTY = 5.0  # per point of average above AVERAGE_FREE
# Maintainability: the maintainability index, and documentation (Python docstrings).
MI_ZERO = 10.0  # index scoring 0 (poor)
MI_FULL = 65.0  # index scoring 100
DOCUMENTATION_SHARE = 0.3
DOCUMENTATION_HALF = 10.0  # missing docstrings per 1,000 lines for 50
# Dependency health: each vulnerable dependency counts once, by its most severe vulnerability,
# as a share of all declared dependencies.
VULNERABILITY_WEIGHTS = {"critical": 1.0, "high": 0.7, "medium": 0.4, "low": 0.15, "unknown": 0.4}
VULNERABLE_SHARE_PENALTY = 200.0  # weighted share 25% -> -50
CRITICAL_DEPENDENCY_CAP = 60  # a dependency with a critical vulnerability caps the score
HIGH_DEPENDENCY_CAP = 80
MAJOR_PENALTY = 20.0  # per share of dependencies a major version behind
MINOR_PENALTY = 5.0
CONFLICT_PENALTY = 5.0  # per conflicting package (at most CONFLICT_CAP)
CONFLICT_CAP = 20.0
INVALID_MANIFEST_PENALTY = 5.0
# Architecture: points for each check that passes (100 in total).
ARCHITECTURE_CHECKS = {
    "tests": 30,
    "no_cycles": 25,
    "entry_points": 15,
    "continuous_integration": 15,
    "separation": 15,
}
CYCLE_PENALTY = 10  # points of no_cycles lost per cycle


@dataclass(frozen=True)
class Dimension:
    key: str
    name: str
    score: int | None
    inputs: dict[str, Any]
    explanation: str
    improvements: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "score": self.score,
            "inputs": self.inputs,
            "explanation": self.explanation,
            "improvements": self.improvements,
        }


def _clamp(value: float) -> int:
    return int(round(max(0.0, min(100.0, value))))


def _from_density(density: float, half: float) -> float:
    return 100.0 / (1.0 + density / half)


def _kloc(code_lines: int) -> float:
    return max(1.0, code_lines / 1000)


def _plural(count: int, one: str, many: str | None = None) -> str:
    return f"{count:,} {one if count == 1 else (many or one + 's')}"


def grade(score: int | None) -> str | None:
    if score is None:
        return None
    return next(letter for floor, letter in GRADES if score >= floor)


def _name(key: str) -> str:
    return dict(DIMENSIONS)[key]


# --- Dimensions --------------------------------------------------------------------------------


def security(summary: dict[str, Any] | None, kloc: float) -> Dimension:
    if summary is None:
        return Dimension(
            "security", _name("security"), None, {}, "This run has no security results.", []
        )
    crossed = summary.get("by_severity_confidence") or {
        # Runs stored before phase 7: every finding counted as confirmed (the stricter reading).
        severity: {"confirmed": count, "potential": 0}
        for severity, count in summary["by_severity"].items()
    }
    points = sum(
        SECURITY_POINTS[severity] * (levels["confirmed"] + POTENTIAL_FACTOR * levels["potential"])
        for severity, levels in crossed.items()
    )
    density = points / kloc
    raw = _from_density(density, SECURITY_HALF)
    cap = 100
    if crossed["critical"]["confirmed"]:
        cap = CONFIRMED_CRITICAL_CAP
    elif crossed["high"]["confirmed"]:
        cap = CONFIRMED_HIGH_CAP
    score = _clamp(min(raw, cap))
    severity = summary["by_severity"]
    improvements = []
    if severity["critical"]:
        improvements.append(
            f"Fix the {_plural(severity['critical'], 'critical finding')} first (committed secrets and vulnerable dependencies are usually among them)."
        )
    if severity["high"]:
        improvements.append(f"Fix the {_plural(severity['high'], 'high-severity finding')}.")
    if crossed["medium"]["confirmed"] or crossed["low"]["confirmed"]:
        improvements.append("Review the remaining confirmed findings on the Security page.")
    explanation = (
        f"{points:g} weighted points (critical 10, high 5, medium 2, low 0.5; potential findings count half) "
        f"over {kloc:g} thousand lines = {density:.2f} per 1,000 lines -> {raw:.0f}"
        f" (100 at none, 50 at {SECURITY_HALF:g} per 1,000 lines)."
    )
    if cap < 100:
        explanation += f" A confirmed {'critical' if cap == CONFIRMED_CRITICAL_CAP else 'high-severity'} finding caps the score at {cap}."
    return Dimension(
        "security",
        _name("security"),
        score,
        {
            "findings": summary["findings"],
            "by_severity": severity,
            "weighted_points": round(points, 2),
            "per_kloc": round(density, 2),
        },
        explanation,
        improvements,
    )


def quality(summary: dict[str, Any] | None, kloc: float) -> Dimension:
    if summary is None:
        return Dimension(
            "quality", _name("quality"), None, {}, "This run has no code-quality results.", []
        )
    severity = summary["by_severity"]
    duplicate_blocks = int(summary["by_category"]["duplication"])  # medium issues, scored below
    points = sum(QUALITY_POINTS[level] * severity[level] for level in QUALITY_POINTS)
    points -= QUALITY_POINTS["medium"] * duplicate_blocks
    density = points / kloc
    issues_score = _from_density(density, QUALITY_HALF)
    duplication = float(summary["duplication"]["percent"])
    duplication_score = max(0.0, 100.0 - duplication * 100.0 / DUPLICATION_ZERO)
    score = _clamp((1 - DUPLICATION_SHARE) * issues_score + DUPLICATION_SHARE * duplication_score)
    improvements = []
    if severity["high"]:
        improvements.append(
            f"Fix the {_plural(severity['high'], 'high-severity issue')} (syntax errors and likely bugs)."
        )
    if severity["medium"]:
        improvements.append(f"Fix the {_plural(severity['medium'], 'medium-severity issue')}.")
    if duplication >= 3:
        improvements.append(f"Remove duplicated code ({duplication:g}% of lines are duplicated).")
    return Dimension(
        "quality",
        _name("quality"),
        score,
        {
            "issues": summary["issues"],
            "by_severity": severity,
            "per_kloc": round(density, 2),
            "duplication_percent": duplication,
        },
        (
            f"Issues: {points:g} weighted points (high 5, medium 2, low 0.5, info 0.1; duplicate"
            f" blocks are scored by the duplication percentage) = {density:.2f} per 1,000 lines "
            f"-> {issues_score:.0f} (50 at {QUALITY_HALF:g}; 75%). Duplication {duplication:g}% -> {duplication_score:.0f} (25%; 0 at {DUPLICATION_ZERO:g}%)."
        ),
        improvements,
    )


def complexity(summary: dict[str, Any] | None) -> Dimension:
    if summary is None:
        return Dimension(
            "complexity", _name("complexity"), None, {}, "This run has no complexity results.", []
        )
    functions = summary["functions"]
    if functions == 0:
        return Dimension(
            "complexity",
            _name("complexity"),
            None,
            {"functions": 0},
            "No functions were measured.",
            [],
        )
    ranks = summary["functions_by_rank"]
    medium, high = ranks["medium"] / functions, ranks["high"] / functions
    average = float(summary["average_cyclomatic"])
    penalty = (
        MEDIUM_PENALTY * medium
        + HIGH_PENALTY * high
        + AVERAGE_PENALTY * max(0.0, average - AVERAGE_FREE)
    )
    score = _clamp(100 - penalty)
    improvements = []
    top = summary.get("top_functions") or []
    if ranks["high"]:
        example = f", starting with {top[0]['name']} ({top[0]['cyclomatic']})" if top else ""
        improvements.append(
            f"Split the {_plural(ranks['high'], 'function')} above complexity 20{example}."
        )
    if ranks["medium"]:
        improvements.append(
            f"Simplify the {_plural(ranks['medium'], 'function')} between 11 and 20."
        )
    return Dimension(
        "complexity",
        _name("complexity"),
        score,
        {
            "functions": functions,
            "medium": ranks["medium"],
            "high": ranks["high"],
            "average": average,
        },
        (
            f"100 - {MEDIUM_PENALTY:g} x {medium:.1%} of functions at medium complexity (11-20)"
            f" - {HIGH_PENALTY:g} x {high:.1%} at high complexity (above 20)"
            f" - {AVERAGE_PENALTY:g} per point the average complexity ({average:g}) is above {AVERAGE_FREE:g}."
        ),
        improvements,
    )


def maintainability(
    complexity_summary: dict[str, Any] | None, quality_summary: dict[str, Any] | None, kloc: float
) -> Dimension:
    index = complexity_summary.get("maintainability_index") if complexity_summary else None
    if index is None:
        return Dimension(
            "maintainability",
            _name("maintainability"),
            None,
            {},
            "No maintainability index was measured.",
            [],
        )
    index_score = (float(index) - MI_ZERO) * 100.0 / (MI_FULL - MI_ZERO)
    inputs: dict[str, Any] = {"maintainability_index": index}
    explanation = f"Maintainability index {index:g} -> {_clamp(index_score)} (0 at {MI_ZERO:g}, 100 at {MI_FULL:g})"
    measured_docs = bool(
        quality_summary
        and quality_summary["python_files"]
        and quality_summary["ruff"] == "completed"
    )
    if measured_docs and quality_summary is not None:
        missing = int(quality_summary["by_category"]["documentation"])
        density = missing / kloc
        docs_score = _from_density(density, DOCUMENTATION_HALF)
        score = _clamp(
            (1 - DOCUMENTATION_SHARE) * _clamp(index_score) + DOCUMENTATION_SHARE * docs_score
        )
        inputs |= {"missing_docstrings": missing, "missing_per_kloc": round(density, 2)}
        explanation += f" (70%); {missing:,} missing docstrings = {density:.2f} per 1,000 lines -> {docs_score:.0f} (30%)."
    else:
        score = _clamp(index_score)
        explanation += "; documentation is measured for Python only."
    poor = complexity_summary["files_by_maintainability"]["poor"] if complexity_summary else 0
    improvements = []
    if poor:
        improvements.append(
            f"Refactor the {_plural(poor, 'file')} with a poor maintainability index (below 10)."
        )
    if inputs.get("missing_docstrings"):
        improvements.append(
            f"Document the public modules, classes and functions ({inputs['missing_docstrings']:,} docstrings missing)."
        )
    return Dimension(
        "maintainability", _name("maintainability"), score, inputs, explanation, improvements
    )


def dependencies(summary: dict[str, Any] | None) -> Dimension:
    if summary is None:
        return Dimension(
            "dependencies",
            _name("dependencies"),
            None,
            {},
            "This run has no dependency results.",
            [],
        )
    total = summary["dependencies"]
    if total == 0:
        return Dimension(
            "dependencies",
            _name("dependencies"),
            None,
            {"dependencies": 0},
            "No dependencies are declared.",
            [],
        )
    lookups = summary["lookups"]
    if lookups["osv"] in ("disabled", "failed") or lookups["registry"] in ("disabled", "failed"):
        return Dimension(
            "dependencies",
            _name("dependencies"),
            None,
            {"dependencies": total, "lookups": lookups},
            "Versions and vulnerabilities could not be looked up for this run, so dependency health is not scored.",
            [],
        )
    updates = summary["updates"]
    worst = summary.get("vulnerable_by_max_severity") or {
        # Runs stored before phase 7: every vulnerable dependency counted as high.
        "critical": 0, "high": summary["vulnerable_dependencies"], "medium": 0, "low": 0, "unknown": 0,
    }  # fmt: skip
    weighted_share = (
        sum(VULNERABILITY_WEIGHTS[level] * worst[level] for level in VULNERABILITY_WEIGHTS) / total
    )
    vulnerability_points = VULNERABLE_SHARE_PENALTY * weighted_share
    outdated_points = (
        MAJOR_PENALTY * updates["major"] / total + MINOR_PENALTY * updates["minor"] / total
    )
    conflict_points = min(CONFLICT_CAP, CONFLICT_PENALTY * len(summary["conflicts"]))
    invalid_points = INVALID_MANIFEST_PENALTY * summary["manifests"]["invalid"]
    cap = 100
    if worst["critical"]:
        cap = CRITICAL_DEPENDENCY_CAP
    elif worst["high"]:
        cap = HIGH_DEPENDENCY_CAP
    score = _clamp(
        min(cap, 100 - vulnerability_points - outdated_points - conflict_points - invalid_points)
    )
    improvements = []
    if summary["vulnerable_dependencies"]:
        improvements.append(
            f"Upgrade the {_plural(summary['vulnerable_dependencies'], 'vulnerable dependency', 'vulnerable dependencies')} to versions with the fixes."
        )
    if updates["major"]:
        improvements.append(
            f"Plan upgrades for the {_plural(updates['major'], 'dependency', 'dependencies')} a major version behind."
        )
    if summary["conflicts"]:
        improvements.append(
            f"Declare one version for the {_plural(len(summary['conflicts']), 'conflicting package')}."
        )
    note = (
        " (lookups were incomplete)" if "partial" in (lookups["osv"], lookups["registry"]) else ""
    )
    return Dimension(
        "dependencies",
        _name("dependencies"),
        score,
        {
            "dependencies": total,
            "vulnerabilities": summary["vulnerabilities"],
            "vulnerable_by_max_severity": worst,
            "major_behind": updates["major"],
            "minor_behind": updates["minor"],
            "conflicts": len(summary["conflicts"]),
        },
        (
            f"100 - {vulnerability_points:.1f} for vulnerable dependencies ({VULNERABLE_SHARE_PENALTY:g} x"
            f" {weighted_share:.1%} of dependencies, each weighted by its worst vulnerability: critical 1,"
            f" high 0.7, medium 0.4, low 0.15)"
            f" - {outdated_points:.1f} for outdated versions - {conflict_points:g} for conflicts"
            f" - {invalid_points:g} for unparsable manifests{note}"
            + (
                f"; a {'critical' if cap == CRITICAL_DEPENDENCY_CAP else 'high-severity'} vulnerability caps it at {cap}."
                if cap < 100
                else "."
            )
        ),
        improvements,
    )


def architecture(
    summary: dict[str, Any] | None, has_tests: bool, separated: bool, has_ci: bool
) -> Dimension:
    if summary is None or summary["components"] == 0:
        return Dimension(
            "architecture", _name("architecture"), None, {}, "No source components were mapped.", []
        )
    checks = {
        "tests": has_tests,
        "no_cycles": summary["cycles"] == 0,
        "entry_points": summary["entry_points"] > 0,
        "continuous_integration": has_ci,
        "separation": separated,
    }
    points = {name: ARCHITECTURE_CHECKS[name] if passed else 0 for name, passed in checks.items()}
    points["no_cycles"] = max(
        0, ARCHITECTURE_CHECKS["no_cycles"] - CYCLE_PENALTY * summary["cycles"]
    )
    score = _clamp(sum(points.values()))
    labels = {
        "tests": "automated tests",
        "no_cycles": "no circular dependencies",
        "entry_points": "entry points identified",
        "continuous_integration": "continuous integration",
        "separation": "separated layers",
    }
    improvements = []
    if not has_tests:
        improvements.append("Add automated tests.")
    if summary["cycles"]:
        improvements.append(
            f"Break the {_plural(summary['cycles'], 'dependency cycle')} between components."
        )
    if not has_ci:
        improvements.append("Run the tests in continuous integration (for example GitHub Actions).")
    if not separated:
        improvements.append(
            "Separate the API, business logic and data access into their own modules."
        )
    return Dimension(
        "architecture",
        _name("architecture"),
        score,
        {"checks": checks, "cycles": summary["cycles"]},
        "; ".join(
            f"{labels[name]} {points[name]}/{ARCHITECTURE_CHECKS[name]}"
            for name in ARCHITECTURE_CHECKS
        )
        + ".",
        improvements,
    )


# --- Run ---------------------------------------------------------------------------------------


def architecture_facts(
    summary: dict[str, Any] | None, report: dict[str, Any] | None
) -> tuple[bool, bool, bool]:
    """(tests, separated layers, continuous integration) from the architecture summary, or from
    the architecture document for runs stored before the summary recorded them."""
    if summary is not None and summary.get("has_tests") is not None:
        return bool(summary["has_tests"]), bool(summary["separated"]), bool(summary["has_ci"])
    components = (report or {}).get("components", [])
    observations = {o["title"] for o in (report or {}).get("observations", [])}
    has_tests = any("test" in c["roles"] for c in components)
    separated = {"api", "data"} <= {c["role"] for c in components} or (
        "Frontend and backend in one repository" in observations
    )
    has_ci = any(item["kind"] == "ci" for item in (report or {}).get("infrastructure", []))
    return has_tests, separated, has_ci


def needs_report(run: Any) -> bool:
    """Whether scoring ``run`` needs its architecture document (older runs only)."""
    return run.architecture is not None and run.architecture.get("has_tests") is None


def dimensions(run: Any, report: dict[str, Any] | None = None) -> list[Dimension]:
    """The six dimensions of a run (an AnalysisRun row); ``report`` is its architecture document,
    needed only when ``needs_report(run)``."""
    kloc = _kloc(run.code_lines)
    has_tests, separated, has_ci = architecture_facts(run.architecture, report)
    return [
        security(run.security, kloc),
        quality(run.quality, kloc),
        complexity(run.complexity),
        maintainability(run.complexity, run.quality, kloc),
        dependencies(run.dependencies),
        architecture(run.architecture, has_tests, separated, has_ci),
    ]


def overall(scores: dict[str, int | None], weights: dict[str, int]) -> int | None:
    """The weighted average of the scored dimensions (unscored ones are left out)."""
    total = sum(weights[key] for key, score in scores.items() if score is not None)
    if total == 0:
        return None
    return _clamp(
        sum(weights[key] * score for key, score in scores.items() if score is not None) / total
    )
