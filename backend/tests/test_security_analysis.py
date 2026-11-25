"""Security analysis tests (phase 3: Module 4).

- Rules, pattern checks, the Bandit runner and the security analyzer are tested without a
  database (Bandit really runs, on temporary directories).
- API tests reuse the full-analysis fixtures: the throwaway test database (TEST_DATABASE_URL,
  "_test") inside rolled-back transactions, inline ingestion and inline analysis jobs.

Every secret below is fake (the AWS key is AWS's documentation example).
"""

import json
import subprocess
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import tools
from app.analysis.quality.analyzer import QualityAnalyzer
from app.analysis.security import analyzer as analyzer_module
from app.analysis.security import bandit_runner, patterns
from app.analysis.security.analyzer import Finding, SecurityAnalyzer, SecurityResult
from app.analysis.security.rules import (
    BANDIT_OWASP,
    BANDIT_TITLES,
    OWASP,
    RULES,
    bandit_owasp,
)
from app.analysis.summary import SnapshotFile
from app.analysis.working_copy import PythonWorkingCopy
from app.models import AnalysisRun, Repository, SecurityFinding
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

# Insecure inputs are assembled from pieces, so this file holds no literal key or insecure
# statement that a scanner (this app's own included) would report; the values are unchanged.
AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE"  # AWS's documented example key, not a credential
PASSWORD_VALUE = "Sup3rS3cr3t!2024"
API_KEY_VALUE = "k7Hd92LsQp0Zx81mWq"
SECRET_VALUES = (AWS_KEY, PASSWORD_VALUE, API_KEY_VALUE, "notreal", "FAKE-KEY")

# --- Rules -------------------------------------------------------------------------------------


def test_rules_are_complete_and_categorized() -> None:
    for rule_id, rule in RULES.items():
        assert rule.owasp in OWASP, rule_id
        assert rule.severity in ("critical", "high", "medium", "low")
        assert rule.confidence in ("confirmed", "potential")
        assert rule.explanation.endswith(".") and rule.recommendation.endswith("."), rule_id
    assert set(BANDIT_OWASP.values()) <= set(OWASP)
    assert set(BANDIT_TITLES) <= set(BANDIT_OWASP)
    assert (bandit_owasp("B608"), bandit_owasp("B999")) == ("A03", "A04")


# --- Line patterns ---------------------------------------------------------------------------


def _rules(path: str, language: str | None, text: str) -> list[tuple[str, int]]:
    return [(m.rule_id, m.line) for m in patterns.scan_lines(path, language, text)]


@pytest.mark.parametrize(
    ("line", "rule_id"),
    [
        ("return eval(code)", "js-eval"),
        ("const f = new Function('a', body)", "js-new-function"),
        ("childProcess.exec(`tar ${dir}`)", "js-child-process"),
        ("execSync('rm -rf ' + dir)", "js-child-process"),
        ('db.query("SELECT * FROM t WHERE id = " + id)', "js-sql-concat"),
        ("db.query(`select * from t where id = ${id}`)", "js-sql-concat"),
        ("db.query(`SELECT id, name FROM users WHERE email = '${email}'`)", "js-sql-concat"),
        ("db.query('INSERT INTO t (a) VALUES (' + a + ')')", "js-sql-concat"),
        ("db.query(`UPDATE users SET name = '${name}'`)", "js-sql-concat"),
        ("db.query(`DELETE FROM sessions WHERE token = ${t}`)", "js-sql-concat"),
        ("db.query('DELETE FROM t WHERE id = ' + id)", "js-sql-concat"),
        # Each statement shape on its own, without a WHERE clause.
        ("db.query(`SELECT id, name FROM users ORDER BY ${field}`)", "js-sql-concat"),
        ("db.query(`SELECT ${cols} FROM t ORDER BY ${order}`)", "js-sql-concat"),
        ("db.query(`DELETE FROM ${table}`)", "js-sql-concat"),
        ("db.query(base + ' WHERE name LIKE ' + pattern)", "js-sql-concat"),
        # A query split across strings is caught by its WHERE comparison.
        ("q = 'SELECT ' + cols + ' FROM t WHERE id = ' + id", "js-sql-concat"),
        ("q = `SELECT ${cols} FROM t WHERE owner LIKE ${pattern}`", "js-sql-concat"),
        ("el.innerHTML = text", "js-inner-html"),
        ("el.outerHTML += part", "js-inner-html"),
        ("el.insertAdjacentHTML('beforeend', html)", "js-inner-html"),
        ("document.write(banner)", "js-document-write"),
        ("<div dangerouslySetInnerHTML={{ __html: h }} />", "react-dangerous-html"),
        ("new https.Agent({ rejectUnauthorized: " + "false })", "tls-verification-disabled"),
        ("process.env.NODE_TLS_REJECT_" + "UNAUTHORIZED = '0'", "tls-verification-disabled"),
        ("jwt.verify(t, k, { algorithms: ['n" + "one'] })", "jwt-insecure"),
        ("jwt.verify(t, k, { ignoreExpiration: " + "true })", "jwt-insecure"),
        ("res.setHeader('Access-Control-Allow-Origin', '*')", "cors-wildcard"),
        ("app.use(cors({ origin: '*' }))", "cors-wildcard"),
        (f'const apiKey = "{API_KEY_VALUE}"', "hardcoded-credential"),
        ("  client_secret: 'q8Zr2LmN0pX4tY6w'", "hardcoded-credential"),
        # The SQL string holds the other quote (a quoted value ends the string).
        ("db.query(\"SELECT * FROM t WHERE name = '\" + name + \"'\")", "js-sql-concat"),
        ("db.query('SELECT \"id\" FROM t WHERE \"owner\" = ' + owner)", "js-sql-concat"),
        # The credential word ends a longer name, in snake, kebab or camel case.
        (f'const PAYMENT_API_SECRET = "{API_KEY_VALUE}"', "hardcoded-credential"),
        (f'const myDbPassword = "{PASSWORD_VALUE}"', "hardcoded-credential"),
        (f'  "payment-api-key": "{API_KEY_VALUE}",', "hardcoded-credential"),
        (f"export const stripeAccessToken = '{API_KEY_VALUE}'", "hardcoded-credential"),
    ],
)
def test_javascript_line_rules(line: str, rule_id: str) -> None:
    assert _rules("web/app.js", "JavaScript", line) == [(rule_id, 1)]


@pytest.mark.parametrize(
    "line",
    [
        "el.textContent = text",
        "if (el.innerHTML === '') {}",
        "db.query('SELECT * FROM t WHERE id = ?', [id])",
        "const evaluate = (x) => x",  # not a call to eval
        "regex.exec(text)",
        "obj.eval(code)",  # a method named eval, not the global
        'const password = "your-password-here"',  # placeholder
        'const token = "${TOKEN}"',
        "const apiKey = process.env.API_KEY",
        "// eval(code) only mentioned in a comment",
        " * el.innerHTML = x  (documentation comment)",
        "new https.Agent({ rejectUnauthorized: true })",
        # Words that also start SQL statements, in text that is not SQL.
        "aria-label={`Delete conversation ${conversation.title}`}",
        "<button aria-label={`Delete ${report.filename}`} />",
        "[`DELETE ${ALPHA_URL}`]: { status: 204 },",
        "expect(calls).toEqual([`PATCH ${url}`, `DELETE ${url}`])",
        "const label = 'Update ' + name",
        "toast(`Select a project from ${list.length} projects`)",
        "const message = 'Insert a disk into drive ' + letter",
        "db.query(\"SELECT * FROM t WHERE name = ?\", [name])",
        # A credential word that starts or sits inside a longer name is not a credential.
        f'const passwordHint = "{API_KEY_VALUE}"',
        f'const SECRET_NAME = "{API_KEY_VALUE}"',
        f'const secretsManagerRegion = "{API_KEY_VALUE}"',
        f'const dbPasswordHash = "{API_KEY_VALUE}"',
        f'const nonsecret = "{API_KEY_VALUE}"',  # inside a word, not after a name part
        "const DB_PASSWORD = process.env.DB_PASSWORD",
        'const PAYMENT_API_SECRET = "your-secret-here"',  # placeholder
    ],
)
def test_safe_javascript_is_not_reported(line: str) -> None:
    assert _rules("web/app.js", "JavaScript", line) == []


def test_rules_apply_only_to_their_languages() -> None:
    js_only = "el.innerHTML = text\nreturn eval(code)\n"
    assert _rules("app.py", "Python", js_only) == []
    assert _rules("README.md", "Markdown", js_only) == []
    # Python string assignments are left to Bandit (B105).
    assert _rules("app.py", "Python", f'API_KEY = "{API_KEY_VALUE}"') == []
    # Language-independent rules apply everywhere.
    assert _rules("deploy.yaml", "YAML", "rejectUnauthorized: " + "false") == [
        ("tls-verification-disabled", 1)
    ]


def test_secrets_are_found_everywhere_even_in_comments() -> None:
    text = f"# old key {AWS_KEY}\n-----BEGIN RSA " + "PRIVATE KEY-----\n"
    assert _rules("notes.txt", None, text) == [("aws-access-key-id", 1), ("private-key", 2)]
    for match in patterns.scan_lines("notes.txt", None, text):
        assert AWS_KEY not in match.message


def test_settings_rules_only_in_python_settings_files() -> None:
    text = "DEBUG = True\nALLOWED_HOSTS = ['*']\nCORS_ALLOW_ALL_ORIGINS = True\n"
    expected = [("debug-enabled", 1), ("allowed-hosts-wildcard", 2), ("cors-wildcard", 3)]
    assert _rules("config/settings.py", "Python", text) == expected
    assert _rules("mysite/prod_settings.py", "Python", text)[:2] == expected[:2]
    assert _rules("app/views.py", "Python", text) == [("cors-wildcard", 3)]
    assert _rules("config/settings.py", "Python", "DEBUG = False\n") == []


def test_each_rule_once_per_line_and_lines_numbered() -> None:
    text = "ok()\nel.innerHTML = a; el.innerHTML = b\n\neval(x)\n"
    assert _rules("a.js", "JavaScript", text) == [("js-inner-html", 2), ("js-eval", 4)]


# --- Environment files and Dockerfiles ---------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "is_env"),
    [
        (".env", True),
        ("backend/.env", True),
        (".env.production", True),
        (".env.example", False),
        (".env.sample", False),
        (".env.template", False),
        ("env.py", False),
        (".envrc", False),
    ],
)
def test_env_file_names(path: str, is_env: bool) -> None:
    assert patterns.is_env_file(path) is is_env


def test_env_file_counts_variables_without_values() -> None:
    match = patterns.scan_env_file("# c\nA=1\nexport B = two\n\nEMPTY=\nlower_case=x\n")
    assert match is not None
    assert (match.rule_id, match.line) == ("env-file-committed", 1)
    assert match.message == "The file sets 3 variables (values not shown)."
    assert patterns.scan_env_file("# only comments\n\nEMPTY=\n") is None
    one = patterns.scan_env_file("A=1\n")
    assert one is not None and "1 variable " in one.message


def _docker(text: str) -> list[tuple[str, int]]:
    return [(m.rule_id, m.line) for m in patterns.scan_dockerfile(text)]


def test_dockerfile_checks() -> None:
    assert _docker("FROM python:latest\nADD https://x.io/t.tgz /opt/\nCMD x\n") == [
        ("docker-unpinned-image", 1),
        ("docker-root-user", 1),
        ("docker-remote-add", 2),
    ]
    assert _docker("FROM node\nUSER node\n") == [("docker-unpinned-image", 1)]
    assert _docker("FROM python:3.12-slim\nUSER app:app\n") == []
    assert _docker("FROM python:3.12\nUSER root\n") == [("docker-root-user", 1)]
    assert _docker("FROM python@sha256:abc\nUSER 1000\n") == []
    # Multi-stage: a later stage starts as root again; a stage name is not an image.
    multi = "FROM node:20 AS build\nUSER node\nFROM build\nRUN x\nFROM scratch\nCOPY a b\n"
    assert _docker(multi) == [("docker-root-user", 5)]
    assert _docker("FROM ${BASE}\nUSER app\n") == []
    assert patterns.is_dockerfile("deploy/Dockerfile")
    assert patterns.is_dockerfile("Dockerfile.prod") and patterns.is_dockerfile("api.dockerfile")
    assert not patterns.is_dockerfile("docker-compose.yml")


# --- Security analyzer (Bandit really runs) ------------------------------------------------------

DB_PY = f"""import pickle
import subprocess

import requests

ADMIN_PASSWORD = "{PASSWORD_VALUE}"


def find_user(conn, name):
    return conn.execute(f"SELECT * FROM users WHERE name = '{{name}}'")


def load(blob):
    return pickle.loads(blob)


def backup(folder):
    subprocess.call("tar czf b.tgz " + folder, shell=True)


def rates():
    return requests.get("https://x.example", verify=False, timeout=5)
"""
SETTINGS_PY = f'DEBUG = True\nAWS_ACCESS_KEY_ID = "{AWS_KEY}"\n'
STORE_JS = (
    f'const apiKey = "{API_KEY_VALUE}"\n'
    "function run(code) { return eval(code) }\n"
    "function show(t) { document.getElementById('x').innerHTML = t }\n"
)


def _text(path: str, text: str, language: str | None = "Python") -> SnapshotFile:
    return SnapshotFile(path, language, len(text.encode()), "text", text)


def _analyze(tmp_path: Path, files: list[SnapshotFile]) -> SecurityResult:
    security = SecurityAnalyzer(tmp_path / "work")
    for file in files:
        security.add(file)
    return security.result()


def _by_rule(result: SecurityResult) -> dict[str, list[Finding]]:
    found: dict[str, list[Finding]] = {}
    for finding in result.findings:
        found.setdefault(finding.rule_id, []).append(finding)
    return found


SAMPLE = [
    _text("shop/db.py", DB_PY),
    _text("config/settings.py", SETTINGS_PY),
    _text("web/store.js", STORE_JS, "JavaScript"),
    _text(".env", "SECRET_KEY=notreal\n", None),
    _text("Dockerfile", "FROM python:latest\nCMD x\n", "Dockerfile"),
    _text("node_modules/pkg/index.js", "eval(x)\n", "JavaScript"),  # excluded directory
    _text("static/app.min.js", "eval(x)\n", "JavaScript"),  # generated
    SnapshotFile("logo.png", None, 10, "binary"),
]


def test_security_analyzer_reports_every_source(tmp_path: Path) -> None:
    result = _analyze(tmp_path, SAMPLE)
    rules = _by_rule(result)
    summary = result.summary
    assert summary["bandit"] == "completed"
    assert (summary["files_scanned"], summary["python_files"]) == (5, 2)

    (key,) = rules["aws-access-key-id"]
    assert (key.path, key.line, key.severity, key.confidence, key.owasp, key.cwe) == (
        "config/settings.py",
        2,
        "critical",
        "confirmed",
        "A07",
        798,
    )
    assert key.tool == "codebase-analysis" and key.title == "AWS access key committed"
    (sql,) = rules["B608"]
    assert (sql.path, sql.line, sql.tool, sql.owasp, sql.cwe) == (
        "shop/db.py",
        10,
        "bandit",
        "A03",
        89,
    )
    assert sql.title == "SQL built from strings"
    assert sql.confidence == "potential"  # Bandit reports B608 with LOW/MEDIUM confidence
    assert sql.doc_url and sql.doc_url.startswith("https://bandit.readthedocs.io/")
    assert sql.explanation.endswith("in this category (A03: Injection).")
    (shell,) = rules["B602"]
    assert (shell.severity, shell.confidence) == ("high", "confirmed")
    (tls,) = rules["B501"]
    assert (tls.title, tls.owasp) == ("TLS certificate verification disabled", "A02")
    (password,) = rules["B105"]
    assert password.message == "Possible hard-coded password in a string (value not shown)."
    assert "B113" not in rules  # the request has a timeout
    assert {"B301", "B403", "B404"} <= set(rules)
    (debug,) = rules["debug-enabled"]
    assert debug.path == "config/settings.py"
    assert {f.rule_id for f in result.findings if f.path == "web/store.js"} == {
        "hardcoded-credential",
        "js-eval",
        "js-inner-html",
    }
    (env,) = rules["env-file-committed"]
    assert env.message == "The file sets 1 variable (values not shown)."
    assert {f.rule_id for f in result.findings if f.path == "Dockerfile"} == {
        "docker-unpinned-image",
        "docker-root-user",
    }
    assert {f.path for f in result.findings}.isdisjoint(
        {"node_modules/pkg/index.js", "static/app.min.js", "logo.png"}
    )

    # Ranked: severity, then confirmed before potential.
    order = [("critical", "high", "medium", "low").index(f.severity) for f in result.findings]
    assert order == sorted(order)
    for severity in ("critical", "high", "medium", "low"):
        levels = [f.confidence for f in result.findings if f.severity == severity]
        assert levels == sorted(levels)  # "confirmed" < "potential"
    assert summary["findings"] == summary["stored_findings"] == len(result.findings)
    for key_name in ("by_severity", "by_confidence", "by_owasp"):
        assert sum(summary[key_name].values()) == summary["findings"]
    assert summary["by_severity"]["critical"] == 1
    crossed = summary["by_severity_confidence"]  # the health score's input
    assert crossed == {
        severity: {
            level: sum(f.severity == severity and f.confidence == level for f in result.findings)
            for level in ("confirmed", "potential")
        }
        for severity in ("critical", "high", "medium", "low")
    }
    assert sum(levels["confirmed"] for levels in crossed.values()) == summary["by_confidence"][
        "confirmed"
    ]
    assert summary["top_files"][0]["path"] == "shop/db.py"
    assert set(summary["top_rules"][0]) == {"rule_id", "count", "title", "severity"}


def test_secret_values_never_appear_in_findings(tmp_path: Path) -> None:
    result = _analyze(tmp_path, SAMPLE)
    stored = json.dumps([asdict(f) for f in result.findings]) + json.dumps(result.summary)
    for value in SECRET_VALUES:
        assert value not in stored


def test_only_the_most_severe_findings_are_stored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_STORED_FINDINGS", 2)
    result = _analyze(tmp_path, SAMPLE)
    assert result.summary["findings"] > 2 and result.summary["stored_findings"] == 2
    assert [f.severity for f in result.findings] == ["critical", "high"]
    assert result.findings[1].confidence == "confirmed"


def test_one_finding_per_rule_and_line(tmp_path: Path) -> None:
    # Bandit reports B603 once per call; two calls on one line are one finding there.
    text = "import subprocess\nsubprocess.call(['a']); subprocess.call(['b'])\n"
    result = _analyze(tmp_path, [_text("m.py", text)])
    assert [(f.rule_id, f.line) for f in result.findings if f.rule_id == "B603"] == [("B603", 2)]


def test_findings_per_file_are_limited(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_FINDINGS_PER_FILE", 3)
    text = "".join(f"eval(code{n})\n" for n in range(6))
    result = _analyze(tmp_path, [_text("a.js", text, "JavaScript")])
    assert [f.line for f in result.findings] == [1, 2, 3]


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (subprocess.TimeoutExpired(cmd="bandit", timeout=1), "timeout"),
        (FileNotFoundError("no python"), "unavailable"),
    ],
)
def test_bandit_failures_keep_the_pattern_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception, status: str
) -> None:
    def fail(*args: Any, **kwargs: Any) -> None:
        raise failure

    monkeypatch.setattr(tools.subprocess, "run", fail)
    result = _analyze(tmp_path, SAMPLE)
    assert result.summary["bandit"] == status
    assert {f.tool for f in result.findings} == {"codebase-analysis"}
    assert "aws-access-key-id" in _by_rule(result)


def test_bandit_nonzero_exit_and_oversized_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def exit_two(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(args, 2)

    monkeypatch.setattr(tools.subprocess, "run", exit_two)
    assert _analyze(tmp_path / "a", [_text("m.py", "x = 1\n")]).summary["bandit"] == "failed"
    monkeypatch.undo()
    monkeypatch.setattr(bandit_runner, "MAX_REPORT_BYTES", 10)
    oversized = _analyze(tmp_path / "b", [_text("m.py", "import pickle\n")])
    assert oversized.summary["bandit"] == "too_large" and oversized.findings == []


def test_bandit_is_skipped_without_python_files(tmp_path: Path) -> None:
    result = _analyze(tmp_path, [_text("a.js", "eval(x)\n", "JavaScript")])
    assert result.summary["bandit"] == "skipped"
    assert [f.rule_id for f in result.findings] == ["js-eval"]


def test_bandit_runs_isolated_and_reports_nosec_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}
    real_run = subprocess.run

    def record(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen["command"], seen["kwargs"] = command, kwargs
        return real_run(command, **kwargs)

    monkeypatch.setenv("SECRET_KEY", "must-not-leak")
    monkeypatch.setattr(tools.subprocess, "run", record)
    result = _analyze(tmp_path, [_text("m.py", "import pickle  # nosec\nassert True\n")])
    command, kwargs = seen["command"], seen["kwargs"]
    assert command[1:3] == ["-m", "bandit"]
    assert {"--ignore-nosec", "--exit-zero", "--quiet", "--recursive"} <= set(command)
    assert command[command.index("--skip") + 1] == "B101"
    assert "SECRET_KEY" not in kwargs["env"]
    assert kwargs["stdin"] == subprocess.DEVNULL and "shell" not in kwargs
    assert kwargs["timeout"] == bandit_runner.BANDIT_TIMEOUT_SECONDS
    assert [f.rule_id for f in result.findings] == ["B403"]  # nosec ignored; B101 skipped


def test_report_entries_that_are_not_findings_are_skipped(tmp_path: Path) -> None:
    source = tmp_path / "src"
    source.mkdir()
    report = tmp_path / "bandit.json"
    good = {
        "filename": str(source / "a.py"),
        "test_id": "B301",
        "test_name": "blacklist",
        "issue_text": "t",
        "issue_severity": "MEDIUM",
        "issue_confidence": "HIGH",
        "issue_cwe": {"id": 502},
        "line_number": 4,
        "line_range": [4, 6],
        "more_info": "https://bandit.readthedocs.io/x",
    }
    entries = [
        good,
        {**good, "filename": str(tmp_path / "outside.py")},
        {"test_id": "B301"},  # no file
        {**good, "issue_cwe": "502", "line_number": 0, "line_range": "x"},  # odd values
    ]
    report.write_text(json.dumps({"results": entries}), encoding="utf-8")
    first, odd = list(bandit_runner.read_report(source, report))
    assert (first.path, first.test_id, first.cwe, first.line, first.end_line) == (
        "a.py",
        "B301",
        502,
        4,
        6,
    )
    assert (odd.cwe, odd.line, odd.end_line) == (None, 1, 1)
    for broken in ("not json", '{"results": 5}', "{}"):
        report.write_text(broken, encoding="utf-8")
        assert list(bandit_runner.read_report(source, report)) == []


def test_ruff_and_bandit_share_one_working_copy(tmp_path: Path) -> None:
    copy = PythonWorkingCopy(tmp_path / "work")
    quality = QualityAnalyzer(tmp_path / "work", copy)
    security = SecurityAnalyzer(tmp_path / "work", copy)
    for file in SAMPLE:
        quality.add(file)
        security.add(file)
    assert len(copy) == 2
    assert quality.result().summary["ruff"] == "completed"
    assert security.result().summary["bandit"] == "completed"


# --- API -----------------------------------------------------------------------------------------

SECURITY_FILES: dict[str, bytes] = {
    **FILES,
    "shop/db.py": DB_PY.encode(),
    "config/settings.py": SETTINGS_PY.encode(),
    "web/store.js": STORE_JS.encode(),
    ".env": b"SECRET_KEY=notreal\n",
    "node_modules/x/index.js": b"eval(x)\n",
}


def _findings_url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/security-findings"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = SECURITY_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


async def _get_findings(
    client: httpx.AsyncClient, owner: Owner, run_id: str, **params: Any
) -> dict[str, Any]:
    response = await client.get(_findings_url(owner, run_id), params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


@requires_db
async def test_run_stores_security_summary_and_findings(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    security = run["security"]
    assert security["bandit"] == "completed"
    assert security["by_severity"]["critical"] == 1
    assert run["quality"] is not None  # both analyses ran in the same pass
    stored = await db_session.scalar(
        select(func.count())
        .select_from(SecurityFinding)
        .where(SecurityFinding.run_id == uuid.UUID(run["id"]))
    )
    assert stored == security["stored_findings"] == security["findings"]

    page = await _get_findings(client, alice, run["id"], page_size=200)
    assert page["total"] == security["findings"]
    first = page["items"][0]
    assert (first["rule_id"], first["severity"], first["confidence"]) == (
        "aws-access-key-id",
        "critical",
        "confirmed",
    )
    assert set(first) == {
        "id", "path", "line", "end_line", "tool", "rule_id", "title", "owasp", "cwe",
        "severity", "confidence", "message", "explanation", "recommendation", "doc_url", "flow",
    }  # fmt: skip
    assert first["flow"] is None  # only data-flow findings have a path
    assert not any(i["path"].startswith("node_modules/") for i in page["items"])
    # Most severe first; within a severity, confirmed before potential.
    ranks = [
        (("critical", "high", "medium", "low").index(i["severity"]), i["confidence"])
        for i in page["items"]
    ]
    assert ranks == sorted(ranks)
    body = json.dumps(page) + json.dumps(run)
    for value in SECRET_VALUES:
        assert value not in body


@requires_db
async def test_finding_filters_search_and_paging(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    run_id = run["id"]
    everything = await _get_findings(client, alice, run_id, page_size=200)
    items = everything["items"]

    def expected(**match: str) -> int:
        return sum(all(item[k] == v for k, v in match.items()) for item in items)

    for params in (
        {"severity": "high"},
        {"confidence": "potential"},
        {"owasp": "A03"},
        {"path": "web/store.js"},
        {"severity": "medium", "confidence": "confirmed"},
    ):
        got = await _get_findings(client, alice, run_id, **params)
        assert got["total"] == expected(**params) > 0, params
        assert all(all(i[k] == v for k, v in params.items()) for i in got["items"])
    search = await _get_findings(client, alice, run_id, q="PICKLE")  # case-insensitive
    assert {i["rule_id"] for i in search["items"]} >= {"B301", "B403"}
    assert all("pickle" in (i["title"] + i["message"]).lower() for i in search["items"])
    assert (await _get_findings(client, alice, run_id, q="b602"))["total"] == 1
    assert (await _get_findings(client, alice, run_id, q="%"))["total"] == 0

    page_one = await _get_findings(client, alice, run_id, page_size=3)
    page_two = await _get_findings(client, alice, run_id, page_size=3, page=2)
    assert [i["id"] for i in page_one["items"] + page_two["items"]] == [i["id"] for i in items[:6]]
    beyond = await _get_findings(client, alice, run_id, page=99)
    assert beyond["items"] == [] and beyond["total"] == everything["total"]


@requires_db
@pytest.mark.parametrize(
    "params",
    [
        {"severity": "info"},
        {"confidence": "likely"},
        {"owasp": "A11"},
        {"page": 0},
        {"page_size": 201},
        {"q": "x" * 201},
    ],
)
async def test_invalid_finding_filters_are_rejected(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    params: dict[str, Any],
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    response = await client.get(
        _findings_url(alice, run["id"]), params=params, headers=alice.headers
    )
    assert response.status_code == 422


@requires_db
async def test_other_users_and_repositories_cannot_read_findings(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    url = _findings_url(alice, run["id"])
    assert (await client.get(url)).status_code == 401
    as_bob = await client.get(url, headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    via_bob = await client.get(_findings_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    other = await _new_repository(client, alice, "other")
    elsewhere = await client.get(_findings_url(alice, run["id"], other), headers=alice.headers)
    assert elsewhere.status_code == 404
    assert (await client.get("/api/v1/security", headers=bob.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_security_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    assert (await client.get("/api/v1/security", headers=alice.headers)).json() == {
        "repositories": []
    }
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)
    (entry,) = (await client.get("/api/v1/security", headers=alice.headers)).json()["repositories"]
    assert entry["run_id"] == latest["id"] != first["id"]
    assert (entry["repository_name"], entry["project_name"]) == ("demo-repo", "Demo")
    assert entry["security"] == latest["security"]
    assert entry["analyzed_file_count"] == latest["analyzed_file_count"]

    await db_session.execute(
        update(AnalysisRun).where(AnalysisRun.id == uuid.UUID(latest["id"])).values(security=None)
    )
    assert (await client.get("/api/v1/security", headers=alice.headers)).json() == {
        "repositories": []
    }
    legacy = next(r for r in (await _runs(client, alice))["runs"] if r["id"] == latest["id"])
    assert legacy["security"] is None
    # The code-quality overview is independent of the security column.
    quality = (await client.get("/api/v1/code-quality", headers=alice.headers)).json()
    assert [r["run_id"] for r in quality["repositories"]] == [latest["id"]]


@requires_db
async def test_findings_are_removed_with_their_repository(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    count = (
        select(func.count())
        .select_from(SecurityFinding)
        .where(SecurityFinding.run_id == uuid.UUID(run["id"]))
    )
    assert (await db_session.scalar(count) or 0) > 0
    await db_session.execute(
        delete(Repository).where(Repository.id == uuid.UUID(alice.repository_id))
    )
    assert await db_session.scalar(count) == 0
    assert (await client.get(_repo_url(alice), headers=alice.headers)).status_code == 404


@requires_db
async def test_a_data_flow_finding_is_served_with_its_path(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    view = (
        "from flask import request\n"
        "\n"
        "def download():\n"
        "    name = request.args['name']\n"
        "    target = '/srv/' + name\n"
        "    return open(target).read()\n"
    )
    run = await _analyzed_run(client, alice, monkeypatch, db_session, {**FILES, "web/views.py": view.encode()})
    page = await _get_findings(client, alice, run["id"], page_size=200)
    flows = [i for i in page["items"] if i["rule_id"] == "path-traversal"]
    assert [(i["path"], i["line"]) for i in flows] == [("web/views.py", 6)]
    assert flows[0]["flow"] == [
        {"line": 4, "label": "request.args"},
        {"line": 4, "label": "name"},
        {"line": 5, "label": "target"},
        {"line": 6, "label": "open()"},
    ]
    stored = await db_session.scalar(select(SecurityFinding.flow).where(SecurityFinding.rule_id == "path-traversal"))
    assert stored == [[4, "request.args"], [4, "name"], [5, "target"], [6, "open()"]]
