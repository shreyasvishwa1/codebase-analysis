"""Accuracy of CodeBase Analysis's security analysis against Semgrep, on a labelled corpus.

Usage (from the repository root, with the backend's virtual environment):

    backend/.venv/Scripts/python evaluation/run_evaluation.py          # Windows
    backend/.venv/bin/python evaluation/run_evaluation.py              # Linux / macOS

Semgrep runs through Docker (the official image, pinned below) unless ``semgrep`` is on the
PATH; ``--semgrep-json CONFIG=FILE`` reuses a saved Semgrep report instead. Nothing is sent
anywhere except Semgrep's download of its public rule packs (metrics are off).

The corpus (corpus.zip) holds small, realistic Python, JavaScript, React, Dockerfile, .env and
key files. Every test case is labelled by a comment on the line above it:

    # expect: <category>       the next line has this weakness
    # safe: <category>         the next line is a safe look-alike (must not be reported)
    # expect-file: <category>  the file as a whole has this weakness (for example no USER)
    # safe-file: <category>

A finding counts for a label when it is in the same file, covers the labelled line (or, for a
file label, is anywhere in the file) and its CWE belongs to the label's category (CATEGORY_CWES),
or its rule is listed for that category (RULE_CATEGORIES); a finding without a CWE is matched
by location alone. Every finding that matches no
"expect" label is a false positive, counted once per file and line.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "backend"))

SEMGREP_IMAGE = "semgrep/semgrep:1.184.0"
SEMGREP_CONFIGS = {
    # Semgrep's own default selection of rules.
    "semgrep-default": ["p/default"],
    # Every Semgrep pack that applies to the corpus's languages and frameworks.
    "semgrep-extended": [
        "p/default",
        "p/python",
        "p/flask",
        "p/django",
        "p/javascript",
        "p/nodejs",  # includes Semgrep's Express rules
        "p/react",
        "p/jwt",
        "p/secrets",
        "p/dockerfile",
        "p/owasp-top-ten",
    ],
}

# The CWEs that count as finding each labelled category. Tools file the same weakness under
# neighbouring CWEs (Bandit files XML parsing under CWE-20, and Flask's debug mode under CWE-94,
# for example), so each category accepts its close relatives.
CATEGORY_CWES: dict[str, set[int]] = {
    "sqli": {89},
    "cmdi": {77, 78, 88},
    "code-injection": {94, 95},
    "path-traversal": {22, 23, 35, 73},
    "ssrf": {918},
    "xss": {79, 80, 116},
    # User input in a template's source: server-side template injection, and XSS with it.
    "template-injection": {79, 94, 96, 1336},
    "open-redirect": {601},
    "jwt": {287, 345, 347},
    "tls": {295},
    "debug": {11, 94, 215, 489},
    "allowed-hosts": {16, 183},
    "cors": {183, 346, 942},
    "deserialization": {502},
    "weak-hash": {326, 327, 328, 916},
    "weak-random": {330, 338},
    "xxe": {20, 611, 776},
    "temp-file": {377, 379},
    "secret": {259, 321, 522, 547, 798},
    "docker-root": {250, 269},
    "docker-unpinned": {1104, 1357},
    "docker-remote-add": {494, 829},
    "env-file": {200, 312, 359, 538},
}

# Rules whose CWE does not name the weakness they detect, matched by what they report instead.
# Bandit files eval and exec under CWE-78 (OS command injection) and yaml.load under CWE-20;
# Semgrep files its SQL rules under CWE-704/915, "alg: none" under CWE-327 and disabled TLS
# checks under CWE-319.
RULE_CATEGORIES: dict[str, str] = {
    "B102": "code-injection",
    "B307": "code-injection",
    "B506": "deserialization",
    "python.django.security.injection.tainted-sql-string.tainted-sql-string": "sqli",
    "python.flask.security.injection.tainted-sql-string.tainted-sql-string": "sqli",
    "javascript.jsonwebtoken.security.jwt-none-alg.jwt-none-alg": "jwt",
    "problem-based-packs.insecure-transport.js-node.bypass-tls-verification"
    ".bypass-tls-verification": "tls",
}

_LABEL = re.compile(r"^\s*(?:#|//|\{/\*)\s*(expect|safe)(-file)?:\s*([a-z-]+)")


@dataclass(frozen=True)
class Label:
    path: str
    line: int  # 0 for a file label
    category: str
    vulnerable: bool

    @property
    def key(self) -> str:
        where = "file" if self.line == 0 else f"line {self.line}"
        return f"{self.path} {where} {self.category}"


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    end_line: int
    rule: str
    cwes: frozenset[int]


@dataclass
class Score:
    detected: set[Label] = field(default_factory=set)
    false_positives: dict[tuple[str, int], list[str]] = field(default_factory=dict)
    flagged_safe: set[Label] = field(default_factory=set)


def read_labels(root: Path) -> list[Label]:
    labels: list[Label] = []
    for file in sorted(p for p in root.rglob("*") if p.is_file()):
        path = file.relative_to(root).as_posix()
        lines = file.read_text(encoding="utf-8").splitlines()
        pending: list[tuple[str, bool]] = []
        for number, text in enumerate(lines, start=1):
            found = _LABEL.match(text)
            if found:
                kind, whole_file, category = found.groups()
                if category not in CATEGORY_CWES:
                    raise SystemExit(f"{path}:{number}: unknown category {category!r}")
                if whole_file:
                    labels.append(Label(path, 0, category, kind == "expect"))
                else:
                    pending.append((category, kind == "expect"))
                continue
            if pending and text.strip():
                labels.extend(Label(path, number, c, v) for c, v in pending)
                pending = []
        if pending:
            raise SystemExit(f"{path}: a label at the end of the file has no line")
    return labels


def run_codebase_analysis(root: Path) -> list[tuple[str, Finding]]:
    """The app's own security analysis (Bandit plus its rules), as an analysis run calls it."""
    from app.analysis.security.analyzer import SecurityAnalyzer
    from app.analysis.summary import SnapshotFile
    from app.services.languages import detect_language

    findings: list[tuple[str, Finding]] = []
    with tempfile.TemporaryDirectory(prefix="cba-eval-") as workdir:
        analyzer = SecurityAnalyzer(Path(workdir))
        for file in sorted(p for p in root.rglob("*") if p.is_file()):
            path = file.relative_to(root).as_posix()
            name = PurePosixPath(path).name
            extension = PurePosixPath(name).suffix[1:].lower() or None
            text = file.read_text(encoding="utf-8")
            analyzer.add(
                SnapshotFile(
                    path=path,
                    language=detect_language(name, extension),
                    size_bytes=len(text.encode()),
                    status="text",
                    text=text,
                )
            )
        result = analyzer.result()
        if result.summary["bandit"] != "completed":
            raise SystemExit(f"Bandit did not complete: {result.summary['bandit']}")
        for f in result.findings:
            cwes = frozenset({f.cwe} if f.cwe else set())
            findings.append((f.tool, Finding(f.path, f.line, f.end_line, f.rule_id, cwes)))
    return findings


def semgrep_command(root: Path, configs: list[str], output: Path) -> list[str]:
    options = ["--metrics=off", "--json", "--quiet", "--disable-version-check", "--no-git-ignore"]
    for config in configs:
        options += ["--config", config]
    if shutil.which("semgrep"):
        return ["semgrep", "scan", *options, "--output", str(output), str(root)]
    return [
        "docker", "run", "--rm",
        "-v", f"{root}:/src:ro", "-v", f"{output.parent}:/out",
        SEMGREP_IMAGE, "semgrep", "scan", *options, "--output", f"/out/{output.name}", "/src",
    ]


def read_semgrep(report: dict, root_prefix: str = "") -> list[Finding]:
    findings = []
    for item in report["results"]:
        path = item["path"].replace("\\", "/")
        for prefix in ("/src/", root_prefix):
            if prefix and path.startswith(prefix):
                path = path[len(prefix):]
        raw = item["extra"].get("metadata", {}).get("cwe", [])
        raw = [raw] if isinstance(raw, str) else raw
        cwes = frozenset(int(m.group(1)) for c in raw if (m := re.search(r"CWE-(\d+)", c)))
        findings.append(
            Finding(path, item["start"]["line"], item["end"]["line"], item["check_id"], cwes)
        )
    return findings


def run_semgrep(root: Path, name: str, saved: dict[str, Path], out_dir: Path) -> tuple[list[Finding], dict]:
    if name in saved:
        report = json.loads(saved[name].read_text(encoding="utf-8"))
    else:
        output = out_dir / f"{name}.json"
        command = semgrep_command(root, SEMGREP_CONFIGS[name], output)
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode not in (0, 1) or not output.exists():
            raise SystemExit(f"Semgrep failed ({completed.returncode}): {completed.stderr[-2000:]}")
        report = json.loads(output.read_text(encoding="utf-8"))
    errors = [e for e in report.get("errors", []) if e.get("level") == "error"]
    info = {"version": report.get("version"), "errors": len(errors), "rules": SEMGREP_CONFIGS[name]}
    return read_semgrep(report, root.as_posix().rstrip("/") + "/"), info


def matches(finding: Finding, label: Label) -> bool:
    if finding.path != label.path:
        return False
    same_kind = (
        RULE_CATEGORIES.get(finding.rule) == label.category
        or bool(finding.cwes & CATEGORY_CWES[label.category])
    )
    if label.line == 0:
        return same_kind
    if not finding.line <= label.line <= max(finding.end_line, finding.line):
        return False
    return same_kind or (not finding.cwes and finding.rule not in RULE_CATEGORIES)


def score(findings: list[Finding], labels: list[Label]) -> Score:
    result = Score()
    vulnerable = [label for label in labels if label.vulnerable]
    safe = [label for label in labels if not label.vulnerable]
    for finding in findings:
        hits = [label for label in vulnerable if matches(finding, label)]
        result.detected.update(hits)
        if not hits:
            where = (finding.path, finding.line)
            result.false_positives.setdefault(where, []).append(finding.rule)
            result.flagged_safe.update(label for label in safe if matches(finding, label))
    return result


def metrics(result: Score, labels: list[Label]) -> dict:
    positives = sum(1 for label in labels if label.vulnerable)
    negatives = sum(1 for label in labels if not label.vulnerable)
    tp, fp = len(result.detected), len(result.false_positives)
    fn = positives - tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / positives if positives else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "safe_cases_flagged": len(result.flagged_safe),
        "safe_cases": negatives,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--corpus", type=Path, default=HERE / "corpus.zip")
    parser.add_argument("--results", type=Path, default=HERE / "results")
    parser.add_argument(
        "--semgrep-json", action="append", default=[], metavar="CONFIG=FILE",
        help="use a saved Semgrep JSON report for CONFIG (semgrep-default or semgrep-extended)",
    )
    args = parser.parse_args()
    saved = dict(item.split("=", 1) for item in args.semgrep_json)
    saved_paths = {name: Path(path) for name, path in saved.items()}

    args.results.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cba-corpus-") as directory:
        root = Path(directory) / "corpus"
        with zipfile.ZipFile(args.corpus) as archive:
            archive.extractall(root)
        labels = read_labels(root)

        own = run_codebase_analysis(root)
        tools: dict[str, list[Finding]] = {
            "codebase-analysis": [f for _, f in own],
            "bandit-only": [f for tool, f in own if tool == "bandit"],
            "own-rules-only": [f for tool, f in own if tool != "bandit"],
        }
        semgrep_info = {}
        for name in SEMGREP_CONFIGS:
            tools[name], semgrep_info[name] = run_semgrep(root, name, saved_paths, args.results)
        # Both tools' findings together: how far the two complement each other.
        tools["codebase-analysis+semgrep"] = tools["codebase-analysis"] + tools["semgrep-default"]

    scores = {name: score(findings, labels) for name, findings in tools.items()}
    categories = sorted({label.category for label in labels})
    per_category = {
        name: {
            c: [
                sum(1 for label in s.detected if label.category == c),
                sum(1 for label in labels if label.vulnerable and label.category == c),
            ]
            for c in categories
        }
        for name, s in scores.items()
    }
    summary = {
        "corpus": {
            "files": len({label.path for label in labels}),
            "vulnerable_cases": sum(1 for label in labels if label.vulnerable),
            "safe_cases": sum(1 for label in labels if not label.vulnerable),
        },
        "semgrep": semgrep_info,
        "tools": {name: metrics(s, labels) for name, s in scores.items()},
        "recall_by_category": per_category,
        "missed": {name: sorted(x.key for x in labels if x.vulnerable and x not in s.detected)
                   for name, s in scores.items()},
        "false_positives": {
            name: sorted(f"{path}:{line} {', '.join(sorted(set(rules)))}"
                         for (path, line), rules in s.false_positives.items())
            for name, s in scores.items()
        },
    }
    (args.results / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print(f"Corpus: {summary['corpus']}")
    print(f"{'tool':27} {'TP':>4} {'FP':>4} {'FN':>4} {'precision':>10} {'recall':>7} {'F1':>6}  safe flagged")
    for name, m in summary["tools"].items():
        print(
            f"{name:27} {m['tp']:>4} {m['fp']:>4} {m['fn']:>4} {m['precision']:>10.3f} "
            f"{m['recall']:>7.3f} {m['f1']:>6.3f}  {m['safe_cases_flagged']}/{m['safe_cases']}"
        )
    print(f"Written: {args.results / 'summary.json'}")


if __name__ == "__main__":
    main()
