"""Security analysis on SecurityEval, an independent benchmark, compared with Bandit and Semgrep.

Usage (from the repository root, with the backend's virtual environment):

    backend/.venv/Scripts/python evaluation/run_securityeval.py          # Windows
    backend/.venv/bin/python evaluation/run_securityeval.py              # Linux / macOS

SecurityEval (Siddiq and Santos, MSR4P&S 2022; https://github.com/s2e-lab/SecurityEval) holds
121 insecure Python samples for 69 CWEs, written and labelled by its authors, not by the authors
of CodeBase Analysis. The dataset is not stored in this repository: the script downloads it from
GitHub at the pinned commit below (about 0.4 MB) into ``evaluation/.cache/`` and checks its
SHA-256. ``--dataset FILE`` uses a ZIP that is already on disk (it is checked the same way).

Each sample is one file labelled with one CWE. A tool **detects** a sample when it reports a
finding in that file whose CWE is the sample's CWE, or in the same family (FAMILIES below). The
looser **flagged** count is every sample with any finding at all. SecurityEval has no safe
samples, so precision cannot be measured on it; the corpus evaluation (run_evaluation.py) does
that.

Nothing is sent anywhere except the dataset download and Semgrep's download of its public rule
packs (metrics are off). ``--semgrep-json CONFIG=FILE`` reuses a saved Semgrep report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "backend"))

from run_evaluation import (  # noqa: E402  (the backend's path is added just above)
    CATEGORY_CWES,
    RULE_CATEGORIES,
    SEMGREP_CONFIGS,
    Finding,
    run_codebase_analysis,
    run_semgrep,
)

COMMIT = "6f4fb70f782c6d47b02ea24341e8ef8c1eb04a6a"  # main on 2023-11-04 (dataset v2.1)
URL = f"https://codeload.github.com/s2e-lab/SecurityEval/zip/{COMMIT}"
SHA256 = "1bc64370f069a92b4ad60cdeba5df17de28ce785ba83b5e2fb052197564120aa"

# CWEs that count for each other. Each set is a parent and its children in MITRE's CWE list,
# except the last two, which are the groupings the corpus evaluation also uses: weak
# cryptography, and parsing untrusted XML (external entities, entity expansion, document types).
# Fixed before the benchmark was run; changing them changes the numbers.
FAMILIES: list[frozenset[int]] = [
    frozenset({77, 78, 88}),  # command injection: 78 and 88 are children of 77
    frozenset({22, 23, 36}),  # path traversal: relative (23) and absolute (36)
    frozenset({79, 80}),  # cross-site scripting: 80 is a child of 79
    frozenset({89, 90, 943}),  # SQL (89) and LDAP (90) injection are children of 943
    frozenset({94, 95, 1336}),  # code injection: eval (95), template injection (1336)
    frozenset({259, 321, 798}),  # hard-coded password (259) and key (321) are children of 798
    frozenset({330, 331, 338}),  # weak randomness: 331 and 338 are children of 330
    frozenset({295, 297}),  # certificate validation: 297 is a child of 295
    frozenset({116, 117}),  # log neutralisation (117) is a child of output encoding (116)
    frozenset({311, 319}),  # cleartext transmission (319) is a child of missing encryption (311)
    frozenset({326, 327, 328, 916}),  # weak cryptography, as in the corpus evaluation
    frozenset({611, 776, 827}),  # untrusted XML, as in the corpus evaluation
]

_SAMPLE_ID = re.compile(r"^CWE-(\d+)_([\w-]+\.py)$")


def family(cwe: int) -> frozenset[int]:
    """The CWEs that count for a sample labelled ``cwe``: itself and every family it is in."""
    members = {cwe}
    for group in FAMILIES:
        if cwe in group:
            members |= group
    return frozenset(members)


def finding_cwes(finding: Finding) -> frozenset[int]:
    """A finding's CWEs, plus its category's when the corpus evaluation corrects its rule
    (Bandit files eval under CWE-78, for example)."""
    category = RULE_CATEGORIES.get(finding.rule)
    return finding.cwes | CATEGORY_CWES[category] if category else finding.cwes


def sample_path(sample_id: str) -> tuple[int, str]:
    """``CWE-020_author_1.py`` -> (20, ``CWE-020/author_1.py``)."""
    found = _SAMPLE_ID.match(sample_id)
    if not found:
        raise SystemExit(f"Unexpected SecurityEval id: {sample_id!r}")
    number, name = found.groups()
    return int(number), f"CWE-{number}/{name}"


def score(findings: list[Finding], samples: dict[str, int]) -> dict[str, set[str]]:
    """Which samples (by path) a tool detects (matching CWE family), matches exactly, or flags."""
    result: dict[str, set[str]] = {"detected": set(), "exact": set(), "flagged": set()}
    for finding in findings:
        cwe = samples.get(finding.path)
        if cwe is None:
            continue
        result["flagged"].add(finding.path)
        cwes = finding_cwes(finding)
        if cwe in cwes:
            result["exact"].add(finding.path)
        if cwes & family(cwe):
            result["detected"].add(finding.path)
    return result


def load_dataset(path: Path | None, cache: Path) -> tuple[Path, list[dict]]:
    if path is None:
        path = cache / f"securityeval-{COMMIT[:12]}.zip"
        if not path.exists():
            cache.mkdir(parents=True, exist_ok=True)
            print(f"Downloading SecurityEval {COMMIT[:12]} from GitHub ...")
            with urllib.request.urlopen(URL, timeout=60) as response:  # noqa: S310 (fixed https URL)
                data = response.read(5_000_000)
            if hashlib.sha256(data).hexdigest() != SHA256:
                raise SystemExit("The downloaded dataset does not match the pinned SHA-256")
            path.write_bytes(data)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"{path} is not the pinned SecurityEval archive (SHA-256 {digest})")
    with zipfile.ZipFile(path) as archive:
        name = next(n for n in archive.namelist() if n.endswith("/dataset.jsonl"))
        rows = [json.loads(line) for line in archive.read(name).decode("utf-8").splitlines() if line.strip()]
    return path, rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--dataset", type=Path, help="a downloaded SecurityEval ZIP (pinned commit)")
    parser.add_argument("--results", type=Path, default=HERE / "results")
    parser.add_argument(
        "--semgrep-json", action="append", default=[], metavar="CONFIG=FILE",
        help="use a saved Semgrep JSON report for CONFIG (semgrep-default or semgrep-extended)",
    )
    args = parser.parse_args()
    saved = {name: Path(p) for name, p in (item.split("=", 1) for item in args.semgrep_json)}
    _, rows = load_dataset(args.dataset, HERE / ".cache")

    samples: dict[str, int] = {}
    args.results.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cba-securityeval-") as directory:
        root = Path(directory) / "securityeval"
        for row in rows:
            cwe, path = sample_path(row["ID"])
            samples[path] = cwe
            target = root / PurePosixPath(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(row["Insecure_code"], encoding="utf-8")

        own = run_codebase_analysis(root)
        tools: dict[str, list[Finding]] = {
            "codebase-analysis": [f for _, f in own],
            "bandit-only": [f for tool, f in own if tool == "bandit"],
            "own-rules-only": [f for tool, f in own if tool != "bandit"],
        }
        semgrep_info = {}
        report_dir = args.results / "securityeval-semgrep"
        report_dir.mkdir(exist_ok=True)
        for name in SEMGREP_CONFIGS:
            tools[name], semgrep_info[name] = run_semgrep(root, name, saved, report_dir)
        tools["codebase-analysis+semgrep"] = tools["codebase-analysis"] + tools["semgrep-default"]

    scores = {name: score(findings, samples) for name, findings in tools.items()}
    total = len(samples)
    by_cwe = Counter(samples.values())
    summary = {
        "dataset": {
            "name": "SecurityEval",
            "commit": COMMIT,
            "sha256": SHA256,
            "samples": total,
            "cwes": len(by_cwe),
        },
        "families": [sorted(group) for group in FAMILIES],
        "semgrep": semgrep_info,
        "tools": {
            name: {
                "detected": len(s["detected"]),
                "exact_cwe": len(s["exact"]),
                "flagged": len(s["flagged"]),
                "samples": total,
                "detection_rate": round(len(s["detected"]) / total, 3),
                "cwes_detected": len({samples[p] for p in s["detected"]}),
            }
            for name, s in scores.items()
        },
        "detected_by_cwe": {
            name: {
                f"CWE-{cwe}": [sum(1 for p in s["detected"] if samples[p] == cwe), by_cwe[cwe]]
                for cwe in sorted(by_cwe)
            }
            for name, s in scores.items()
        },
        "detected": {name: sorted(s["detected"]) for name, s in scores.items()},
    }
    (args.results / "securityeval.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print(f"SecurityEval {COMMIT[:12]}: {total} samples, {len(by_cwe)} CWEs")
    print(f"{'tool':27} {'detected':>9} {'exact CWE':>10} {'flagged':>8} {'CWEs':>5}")
    for name, m in summary["tools"].items():
        print(f"{name:27} {m['detected']:>4} ({m['detection_rate']:.3f}) {m['exact_cwe']:>6} "
              f"{m['flagged']:>8} {m['cwes_detected']:>5}")
    print(f"Written: {args.results / 'securityeval.json'}")


if __name__ == "__main__":
    main()
