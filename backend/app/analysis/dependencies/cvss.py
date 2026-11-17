"""CVSS v3.x base score from a vector string (FIRST CVSS v3.1 specification, section 7)."""

import math

_WEIGHTS: dict[str, dict[str, float]] = {
    "AV": {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2},
    "AC": {"L": 0.77, "H": 0.44},
    "UI": {"N": 0.85, "R": 0.62},
    "C": {"H": 0.56, "L": 0.22, "N": 0.0},
    "I": {"H": 0.56, "L": 0.22, "N": 0.0},
    "A": {"H": 0.56, "L": 0.22, "N": 0.0},
}
_PRIVILEGES = {"U": {"N": 0.85, "L": 0.62, "H": 0.27}, "C": {"N": 0.85, "L": 0.68, "H": 0.5}}


def _round_up(value: float) -> float:
    """The specification's Roundup: the smallest number with one decimal >= value."""
    integer = round(value * 100_000)
    if integer % 10_000 == 0:
        return integer / 100_000
    return (math.floor(integer / 10_000) + 1) / 10.0


def base_score(vector: str) -> float | None:
    """The base score (0.0-10.0) of a ``CVSS:3.0/...`` or ``CVSS:3.1/...`` vector, or None."""
    parts = vector.strip().split("/")
    if not parts or parts[0] not in ("CVSS:3.0", "CVSS:3.1"):
        return None
    metrics: dict[str, str] = {}
    for part in parts[1:]:
        key, _, value = part.partition(":")
        metrics[key] = value
    try:
        scope = metrics["S"]
        privileges = _PRIVILEGES[scope][metrics["PR"]]
        av, ac, ui = (_WEIGHTS[m][metrics[m]] for m in ("AV", "AC", "UI"))
        c, i, a = (_WEIGHTS[m][metrics[m]] for m in ("C", "I", "A"))
    except KeyError:
        return None
    iss = 1 - (1 - c) * (1 - i) * (1 - a)
    if scope == "U":
        impact = 6.42 * iss
    else:
        impact = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    if impact <= 0:
        return 0.0
    exploitability = 8.22 * av * ac * privileges * ui
    if scope == "U":
        return _round_up(min(impact + exploitability, 10))
    return _round_up(min(1.08 * (impact + exploitability), 10))


def severity_of_score(score: float) -> str:
    """The CVSS qualitative rating (0.1-3.9 low, 4.0-6.9 medium, 7.0-8.9 high, 9.0+ critical)."""
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    return "low"
