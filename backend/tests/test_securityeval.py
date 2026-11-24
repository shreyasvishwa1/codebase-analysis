"""The SecurityEval benchmark (evaluation/run_securityeval.py): its matching, and that the
published numbers follow from the saved reports and, when the dataset is present, the code."""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path, PurePosixPath

import pytest

ROOT = Path(__file__).resolve().parents[2]
EVALUATION = ROOT / "evaluation"


def _load():
    for name in ("run_evaluation", "run_securityeval"):
        if name not in sys.modules:
            spec = importlib.util.spec_from_file_location(name, EVALUATION / f"{name}.py")
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module  # dataclasses look their module up while decorating
            spec.loader.exec_module(module)
    return sys.modules["run_securityeval"]


se = _load()
RESULTS = json.loads((EVALUATION / "results" / "securityeval.json").read_text(encoding="utf-8"))
DATASET = EVALUATION / ".cache" / f"securityeval-{se.COMMIT[:12]}.zip"


def _finding(path, cwes=(), rule="R1"):
    return se.Finding(path, 1, 1, rule, frozenset(cwes))


def test_sample_ids_become_paths_and_cwes() -> None:
    assert se.sample_path("CWE-020_author_1.py") == (20, "CWE-020/author_1.py")
    assert se.sample_path("CWE-1204_sonar_1.py") == (1204, "CWE-1204/sonar_1.py")
    for unexpected in ("../CWE-020_x.py", "CWE-020_a/../../b.py", "CWE-020_x.txt"):
        with pytest.raises(SystemExit):
            se.sample_path(unexpected)


def test_families_count_parents_and_children_for_each_other() -> None:
    assert se.family(95) == {94, 95, 1336}
    assert se.family(943) == {89, 90, 943}
    assert se.family(89) == {89, 90, 943}
    assert se.family(601) == {601}  # in no family: itself only
    assert se.family(20) == {20}  # the broad "input validation" class matches only itself


def test_a_sample_is_detected_only_by_a_finding_of_its_family_in_its_own_file() -> None:
    samples = {"CWE-022/a.py": 22, "CWE-095/b.py": 95, "CWE-601/c.py": 601, "CWE-079/d.py": 79}
    findings = [
        _finding("CWE-022/a.py", {23}),  # a child CWE: detected, not exact
        _finding("CWE-095/b.py", {78}, rule="B307"),  # Bandit's eval, corrected to code injection
        _finding("CWE-601/c.py", {22}),  # flagged, but another weakness
        _finding("CWE-079/x.py", {79}),  # not a sample file
        _finding("CWE-079/d.py", {79}),
        _finding("CWE-079/d.py", {79}),  # counted once
    ]
    result = se.score(findings, samples)
    assert result["detected"] == {"CWE-022/a.py", "CWE-095/b.py", "CWE-079/d.py"}
    assert result["exact"] == {"CWE-095/b.py", "CWE-079/d.py"}
    assert result["flagged"] == {"CWE-022/a.py", "CWE-095/b.py", "CWE-601/c.py", "CWE-079/d.py"}


def test_the_dataset_is_pinned_and_checked(tmp_path: Path) -> None:
    assert RESULTS["dataset"]["commit"] == se.COMMIT and se.COMMIT in se.URL
    assert RESULTS["dataset"]["sha256"] == se.SHA256
    assert (RESULTS["dataset"]["samples"], RESULTS["dataset"]["cwes"]) == (121, 69)
    wrong = tmp_path / "other.zip"
    wrong.write_bytes(b"not the dataset")
    with pytest.raises(SystemExit, match="not the pinned"):
        se.load_dataset(wrong, tmp_path)


def test_published_counts_agree_with_their_lists() -> None:
    for name, numbers in RESULTS["tools"].items():
        detected = RESULTS["detected"][name]
        assert numbers["detected"] == len(detected) == sum(n for n, _ in RESULTS["detected_by_cwe"][name].values())
        assert numbers["detection_rate"] == round(len(detected) / 121, 3)
        assert numbers["detected"] <= numbers["flagged"] and numbers["exact_cwe"] <= numbers["detected"]


@pytest.mark.parametrize("name", ["semgrep-default", "semgrep-extended"])
def test_published_semgrep_numbers_follow_from_its_saved_reports(name: str) -> None:
    saved = EVALUATION / "results" / "securityeval-semgrep" / f"{name}.json"
    if not saved.exists():  # raw reports are not committed; run_securityeval.py writes them
        pytest.skip("Semgrep's SecurityEval report is not on this machine")
    report = json.loads(saved.read_text(encoding="utf-8"))
    findings = sys.modules["run_evaluation"].read_semgrep(report)
    # Every sample's CWE is in its path, so the saved report can be re-scored without the dataset.
    samples = {f.path: se.sample_path(PurePosixPath(f.path).parent.name + "_" + PurePosixPath(f.path).name)[0] for f in findings}
    result = se.score(findings, samples)
    assert sorted(result["detected"]) == RESULTS["detected"][name]
    assert len(result["flagged"]) == RESULTS["tools"][name]["flagged"]


@pytest.mark.skipif(not DATASET.exists(), reason="SecurityEval is not downloaded (run evaluation/run_securityeval.py)")
def test_published_numbers_for_the_app_match_the_current_code() -> None:
    _, rows = se.load_dataset(DATASET, DATASET.parent)
    samples = {}
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for row in rows:
            cwe, path = se.sample_path(row["ID"])
            samples[path] = cwe
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(row["Insecure_code"], encoding="utf-8")
        own = se.run_codebase_analysis(root)
    for name, findings in {
        "codebase-analysis": [f for _, f in own],
        "bandit-only": [f for tool, f in own if tool == "bandit"],
        "own-rules-only": [f for tool, f in own if tool != "bandit"],
    }.items():
        assert sorted(se.score(findings, samples)["detected"]) == RESULTS["detected"][name], name
