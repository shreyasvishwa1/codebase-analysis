"""The accuracy evaluation (evaluation/run_evaluation.py): its labels, its matching, and that
the published numbers for CodeBase Analysis still hold for the current code."""

import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
EVALUATION = ROOT / "evaluation"


def _load():
    spec = importlib.util.spec_from_file_location("run_evaluation", EVALUATION / "run_evaluation.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_evaluation"] = module  # dataclasses look their module up while decorating
    spec.loader.exec_module(module)
    return module


ev = _load()
SUMMARY = json.loads((EVALUATION / "results" / "summary.json").read_text(encoding="utf-8"))


def _finding(path="a.py", line=3, end=3, rule="R1", cwes=()):
    return ev.Finding(path, line, end, rule, frozenset(cwes))


def test_labels_apply_to_the_next_code_line_and_files(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text(
        "# expect: sqli\n\n# safe: cmdi\nrun()\n# expect-file: docker-root\n"
        "// expect: xss\n// expect: code-injection\nx = 1\n",
        encoding="utf-8",
    )
    labels = ev.read_labels(tmp_path)
    assert {(x.line, x.category, x.vulnerable) for x in labels} == {
        (4, "sqli", True),  # a blank line does not consume the label
        (4, "cmdi", False),
        (0, "docker-root", True),
        (8, "xss", True),
        (8, "code-injection", True),
    }


def test_an_unknown_category_or_a_dangling_label_is_refused(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text("# expect: magic\nx = 1\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="unknown category"):
        ev.read_labels(tmp_path)
    (tmp_path / "a.py").write_text("x = 1\n# expect: sqli\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="no line"):
        ev.read_labels(tmp_path)


def test_a_finding_counts_only_on_the_labelled_line_and_kind() -> None:
    label = ev.Label("a.py", 3, "sqli", True)
    assert ev.matches(_finding(cwes={89}), label)
    assert ev.matches(_finding(line=2, end=4, cwes={89}), label)  # a span covering the line
    assert not ev.matches(_finding(line=4, end=4, cwes={89}), label)  # next line
    assert not ev.matches(_finding(path="b.py", cwes={89}), label)
    assert not ev.matches(_finding(cwes={400}), label)  # another weakness on the same line
    assert ev.matches(_finding(cwes=()), label)  # no CWE: location alone
    assert ev.matches(_finding(rule="B307", cwes={78}), ev.Label("a.py", 3, "code-injection", True))
    assert not ev.matches(_finding(rule="B307", cwes=()), label)  # a listed rule keeps its kind


def test_a_file_label_needs_a_finding_of_its_kind_anywhere_in_the_file() -> None:
    label = ev.Label("Dockerfile", 0, "docker-root", True)
    assert ev.matches(_finding(path="Dockerfile", line=9, cwes={250}), label)
    assert not ev.matches(_finding(path="Dockerfile", line=9, cwes=()), label)
    assert not ev.matches(_finding(path="Dockerfile", line=9, cwes={1104}), label)


def test_scores_count_each_label_once_and_each_false_line_once() -> None:
    labels = [ev.Label("a.py", 3, "sqli", True), ev.Label("a.py", 7, "sqli", False)]
    findings = [
        _finding(cwes={89}),
        _finding(rule="R2", cwes={89}),  # the same label again
        _finding(line=7, end=7, cwes={89}),
        _finding(line=7, end=7, rule="R2", cwes={89}),  # the same false line again
    ]
    result = ev.metrics(ev.score(findings, labels), labels)
    assert (result["tp"], result["fp"], result["fn"]) == (1, 1, 0)
    assert (result["precision"], result["recall"], result["safe_cases_flagged"]) == (0.5, 1.0, 1)


def test_published_numbers_for_the_app_match_the_current_code(tmp_path: Path) -> None:
    root = tmp_path / "corpus"
    with zipfile.ZipFile(EVALUATION / "corpus.zip") as archive:
        archive.extractall(root)
    labels = ev.read_labels(root)
    assert SUMMARY["corpus"] == {
        "files": len({x.path for x in labels}),
        "vulnerable_cases": sum(x.vulnerable for x in labels),
        "safe_cases": sum(not x.vulnerable for x in labels),
    }
    own = ev.run_codebase_analysis(root)
    for name, findings in {
        "codebase-analysis": [f for _, f in own],
        "bandit-only": [f for tool, f in own if tool == "bandit"],
        "own-rules-only": [f for tool, f in own if tool != "bandit"],
    }.items():
        assert ev.metrics(ev.score(findings, labels), labels) == SUMMARY["tools"][name], name
