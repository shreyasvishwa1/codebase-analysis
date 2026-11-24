"""Deployment configuration checks (no network, no containers).

The app's Caddy must hand the API only the visitor's resolved address: forwarding the whole
X-Forwarded-For chain made uvicorn use the last proxy hop, so every visitor shared one IP and
one set of per-IP rate limits.
"""

import ast
import base64
import hashlib
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

CADDYFILE = Path(__file__).resolve().parents[2] / "deploy" / "Caddyfile"


def _directives() -> list[str]:
    return [line.split("#", 1)[0].strip() for line in CADDYFILE.read_text().splitlines()]


def _block(start: str) -> list[str]:
    """The directive lines of the block opened by ``start``, up to its closing brace."""
    lines = _directives()
    depth, block = 0, []
    for line in lines[lines.index(start) :]:
        depth += line.count("{") - line.count("}")
        block.append(line)
        if depth == 0:
            break
    return block


def test_api_request_bodies_are_capped_except_repository_uploads() -> None:
    block = _block("handle /api/* {")
    assert "@small not path_regexp ^/api/v1/projects/[^/]+/repositories/[^/]+/ingest$" in block
    cap = block.index("request_body @small {")
    assert block[cap + 1] == "max_size 2MB"
    assert cap < block.index("import api")  # applied before the request reaches the API


def test_hidden_paths_get_a_plain_404_except_well_known() -> None:
    hidden = _block("@hidden {")
    assert hidden[1:3] == ["path_regexp ^/\\.", "not path /.well-known/*"]
    assert _block("handle @hidden {")[1] == "respond 404"


def test_a_missing_asset_is_a_404_not_the_app_page() -> None:
    assets = _block("handle /assets/* {")
    assert "file_server" in assets
    assert not any(line.startswith("try_files") for line in assets)
    assert "try_files {path} /index.html" in _directives()  # app routes keep their fallback


def test_caddy_resolves_the_client_from_the_right_of_the_chain() -> None:
    lines = _directives()
    assert "trusted_proxies static private_ranges 100.64.0.0/10" in lines
    assert "trusted_proxies_strict" in lines
    # Configurable: X-Forwarded-For by default, Cf-Connecting-Ip behind Cloudflare (Render).
    assert "client_ip_headers {$CLIENT_IP_HEADER:X-Forwarded-For}" in lines


def test_render_reads_the_cloudflare_client_header() -> None:
    blueprint = (CADDYFILE.parents[1] / "render.yaml").read_text()
    assert "- key: CLIENT_IP_HEADER\n        value: Cf-Connecting-Ip" in blueprint


def test_no_diagnostic_request_logging_is_left_enabled() -> None:
    lines = _directives()
    assert "log" not in lines and "log_skip" not in lines


def _header(name: str) -> str:
    [line] = [line for line in _directives() if line.startswith(name + " ")]
    value = line[len(name) :].strip()
    return value[1:-1] if value.startswith('"') else value


def _csp() -> dict[str, list[str]]:
    policy: dict[str, list[str]] = {}
    for directive in _header("Content-Security-Policy").split(";"):
        name, *sources = directive.split()
        policy[name] = sources
    return policy


def test_csp_allows_each_inline_script_in_index_html_by_its_hash() -> None:
    index = (CADDYFILE.parents[1] / "frontend" / "index.html").read_text(encoding="utf-8")
    inline = re.findall(r"<script>(.*?)</script>", index, re.S)
    assert inline  # the theme script that runs before the first paint
    allowed = _csp()["script-src"]
    for script in inline:
        digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
        assert f"'sha256-{digest}'" in allowed


def test_csp_never_allows_inline_or_evaluated_scripts() -> None:
    policy = _csp()
    assert policy["default-src"] == ["'self'"]
    assert policy["script-src"][0] == "'self'"
    assert all(source.startswith("'sha256-") for source in policy["script-src"][1:])
    assert policy["connect-src"] == ["'self'"]


def test_csp_blocks_plugins_framing_and_base_rewrites() -> None:
    policy = _csp()
    assert policy["object-src"] == ["'none'"]
    assert policy["frame-ancestors"] == ["'none'"]
    assert policy["base-uri"] == ["'self'"]
    assert policy["form-action"] == ["'self'"]


def test_csp_admits_google_fonts_only_where_needed() -> None:
    policy = _csp()
    assert policy["style-src"] == ["'self'", "https://fonts.googleapis.com"]
    assert policy["font-src"] == ["'self'", "https://fonts.gstatic.com"]


def test_https_is_remembered_and_device_features_are_off() -> None:
    assert _header("Strict-Transport-Security") == "max-age=31536000"
    features = dict(item.split("=") for item in _header("Permissions-Policy").split(", "))
    assert features == {
        "camera": "()",
        "microphone": "()",
        "geolocation": "()",
        "payment": "()",
        "usb": "()",
    }
    assert _header("Cross-Origin-Opener-Policy") == "same-origin"
    assert _header("X-Frame-Options") == "DENY"


def _github(name: str) -> dict:
    return yaml.safe_load((CADDYFILE.parents[1] / ".github" / name).read_text())


def test_dependabot_watches_backend_frontend_and_workflow_dependencies() -> None:
    config = _github("dependabot.yml")
    watched = {(u["package-ecosystem"], u["directory"]) for u in config["updates"]}
    assert watched == {("pip", "/backend"), ("npm", "/frontend"), ("github-actions", "/")}
    # Library major versions need a deliberate upgrade; minor and patch updates still come.
    no_majors = [{"dependency-name": "*", "update-types": ["version-update:semver-major"]}]
    ignored = {u["package-ecosystem"]: u.get("ignore") for u in config["updates"]}
    assert ignored == {"pip": no_majors, "npm": no_majors, "github-actions": None}


def test_security_audit_checks_every_pinned_package_with_read_only_access() -> None:
    workflow = _github("workflows/security-audit.yml")
    assert workflow["permissions"] == {"contents": "read"}
    triggers = workflow[True]  # PyYAML reads the bare key "on" as True
    assert {"push", "pull_request", "schedule"} <= set(triggers)
    steps = workflow["jobs"]["audit"]["steps"]
    commands = " ".join(step.get("run", "") for step in steps)
    assert "pip-audit --strict --disable-pip --no-deps --requirement backend/constraints.txt" in commands
    assert "npm audit --audit-level=high" in commands
    checkout = next(step for step in steps if step.get("uses", "").startswith("actions/checkout"))
    assert checkout["with"]["persist-credentials"] is False


def _keep_awake() -> dict:
    path = CADDYFILE.parents[1] / ".github" / "workflows" / "keep-awake.yml"
    return yaml.safe_load(path.read_text())


def test_keep_awake_pings_more_often_than_render_sleeps() -> None:
    workflow = _keep_awake()
    triggers = workflow[True]  # PyYAML reads the bare key "on" as True
    [schedule] = triggers["schedule"]
    minute = schedule["cron"].split()[0]
    assert minute.startswith("*/")
    assert int(minute[2:]) < 15  # Render's free plan sleeps after 15 idle minutes


def test_keep_awake_requests_the_health_endpoint_without_permissions() -> None:
    workflow = _keep_awake()
    assert workflow["permissions"] == {}
    [step] = workflow["jobs"]["ping"]["steps"]
    assert step["run"].startswith("curl --fail ")
    assert step["run"].endswith(" https://codebase-analysis.onrender.com/health")


def test_every_api_route_forwards_only_the_resolved_client_ip() -> None:
    lines = _directives()
    proxies = [line for line in lines if line.startswith("reverse_proxy")]
    assert proxies == ["reverse_proxy 127.0.0.1:8000 {"]  # one shared definition
    assert "header_up X-Forwarded-For {client_ip}" in lines
    assert lines.count("import api") == 2  # /api/* and /health


ROOT = CADDYFILE.parents[1]
DOCKERFILES = (ROOT / "Dockerfile", ROOT / "deploy" / "render" / "Dockerfile")


def test_both_production_images_pass_the_apps_own_dockerfile_rules() -> None:
    from app.analysis.security.patterns import scan_dockerfile

    for dockerfile in DOCKERFILES:
        assert scan_dockerfile(dockerfile.read_text()) == [], dockerfile


def test_both_production_images_run_as_the_unprivileged_app_user() -> None:
    for dockerfile in DOCKERFILES:
        lines = dockerfile.read_text().splitlines()
        final = max(i for i, line in enumerate(lines) if line.startswith("FROM "))
        stage = lines[final:]
        assert "useradd -m -u 1000 app" in "\n".join(stage), dockerfile
        assert [line for line in stage if line.startswith("USER ")] == ["USER app"], dockerfile
        # Caddy keeps its state under XDG folders; the app user can write to /tmp.
        assert "XDG_DATA_HOME=/tmp/caddy-data" in dockerfile.read_text()


def test_the_root_image_keeps_its_code_read_only_for_the_app() -> None:
    text = (ROOT / "Dockerfile").read_text()
    assert "--chown" not in text
    assert "RUN mkdir -p /data && chown app /data" in text


def test_start_script_falls_back_when_the_data_volume_is_not_writable() -> None:
    script = (ROOT / "deploy" / "start.sh").read_text()
    assert 'if ! mkdir -p "$DATA_DIR" 2>/dev/null || [ ! -w "$DATA_DIR" ]; then' in script
    assert 'export DATA_DIR="$HOME/data"' in script
    assert script.index('export DATA_DIR="$HOME/data"') < script.index("bash /app/deploy/migrate.sh")


def test_ci_runs_every_backend_and_frontend_check_with_read_only_access() -> None:
    workflow = _github("workflows/tests.yml")
    assert workflow["permissions"] == {"contents": "read"}
    assert {"push", "pull_request"} <= set(workflow[True])  # PyYAML reads "on" as True
    jobs = workflow["jobs"]
    backend = jobs["backend"]
    assert {"postgres", "redis"} <= set(backend["services"])
    assert set(backend["env"]) == {
        "TEST_DATABASE_URL",
        "TEST_MIGRATION_DATABASE_URL",
        "TEST_REDIS_URL",
    }
    commands = {
        name: [step.get("run", "") for step in job["steps"]] for name, job in jobs.items()
    }
    assert any("alembic upgrade head" in run for run in commands["backend"])
    assert {"ruff check .", "mypy", "python -m pytest -q -p no:cacheprovider"} <= set(
        commands["backend"]
    )
    assert {"npm run typecheck", "npm test", "npm run build"} <= set(commands["frontend"])
    for job in jobs.values():
        checkout = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/checkout"))
        assert checkout["with"]["persist-credentials"] is False


def test_ci_test_run_selects_the_whole_suite() -> None:
    """Nothing narrows the backend run (a -k, -m or path argument would silently skip tests)."""
    [run] = [
        step["run"]
        for step in _github("workflows/tests.yml")["jobs"]["backend"]["steps"]
        if "pytest" in step.get("run", "")
    ]
    assert run.split() == ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"]


def test_readme_shows_the_ci_status() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "actions/workflows/tests.yml/badge.svg" in readme


def test_every_build_uses_the_same_supported_node_release() -> None:
    """Both images and both workflows build the frontend with Node 22 (Node 20 is end of life)."""
    for dockerfile in DOCKERFILES:
        assert "FROM node:22-alpine AS frontend" in dockerfile.read_text().splitlines(), dockerfile
    for name in ("workflows/tests.yml", "workflows/security-audit.yml"):
        steps = [step for job in _github(name)["jobs"].values() for step in job["steps"]]
        versions = {
            step["with"]["node-version"]
            for step in steps
            if step.get("uses", "").startswith("actions/setup-node")
        }
        assert versions == {"22"}, name


# --- Migrations and a failed deploy --------------------------------------------------------------
# When a deploy migrates the database and then fails, the platform falls back to the previous
# version, whose migrations end before the database's revision. That version must still start
# (deploy/migrate.sh), which is safe only while migrations add and never remove or rename.

MIGRATE = ROOT / "deploy" / "migrate.sh"
VERSIONS = ROOT / "backend" / "alembic" / "versions"
FIRST_DEPLOYED = 5  # migrations before 0005 predate the first deployment
ADDITIVE = {
    "create_table", "create_index", "add_column", "create_foreign_key",
    "create_check_constraint", "create_unique_constraint", "f",
}  # fmt: skip


def test_start_script_migrates_through_the_shared_step_before_starting() -> None:
    script = (ROOT / "deploy" / "start.sh").read_text()
    assert "alembic upgrade head" not in script  # only deploy/migrate.sh runs it
    assert script.index("bash /app/deploy/migrate.sh") < script.index("uvicorn app.main:app")
    assert "alembic upgrade head" in MIGRATE.read_text()


def _migrations() -> list[tuple[int, Path]]:
    return sorted((int(path.name[:4]), path) for path in VERSIONS.glob("[0-9][0-9][0-9][0-9]_*.py"))


def _upgrade_calls(path: Path) -> list[ast.Call]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    upgrade = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")
    return [
        node
        for node in ast.walk(upgrade)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]


def test_deployed_migrations_only_add_so_the_previous_version_still_runs() -> None:
    deployed = [(number, path) for number, path in _migrations() if number >= FIRST_DEPLOYED]
    assert deployed and deployed[-1][0] >= 15
    for _, path in deployed:
        for call in _upgrade_calls(path):
            operation = call.func.attr  # type: ignore[attr-defined]
            assert operation in ADDITIVE, f"{path.name}: op.{operation} is not additive"
            if operation == "add_column":
                column = call.args[1]
                assert isinstance(column, ast.Call)
                keywords = {k.arg: k.value for k in column.keywords}
                optional = isinstance(keywords.get("nullable"), ast.Constant) and keywords["nullable"].value is True
                assert optional or "server_default" in keywords, f"{path.name}: a required column has no default"


def test_the_additive_check_notices_a_destructive_migration(tmp_path: Path) -> None:
    sample = tmp_path / "0099_drop.py"
    sample.write_text("def upgrade():\n    op.drop_column('users', 'display_name')\n", encoding="utf-8")
    assert [c.func.attr for c in _upgrade_calls(sample)] == ["drop_column"]  # type: ignore[attr-defined]
    assert "drop_column" not in ADDITIVE


def _run_migrate(tmp_path: Path, output: str, code: int) -> subprocess.CompletedProcess[str]:
    """deploy/migrate.sh with a stand-in alembic that prints ``output`` and exits with ``code``."""
    fake = tmp_path / "alembic"
    fake.write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' {shlex.quote(output)}\nexit {code}\n")
    fake.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}"}
    return subprocess.run(["bash", str(MIGRATE)], capture_output=True, text=True, env=env, cwd=tmp_path, check=False)


needs_bash = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("bash") is None, reason="runs the shell script (Linux CI)"
)


@needs_bash
def test_migrate_applies_the_migrations(tmp_path: Path) -> None:
    result = _run_migrate(tmp_path, "INFO  Running upgrade 0014 -> 0015", 0)
    assert result.returncode == 0
    assert "Running upgrade 0014 -> 0015" in result.stdout
    assert "WARNING" not in result.stderr


@needs_bash
def test_migrate_starts_anyway_when_a_newer_version_migrated_the_database(tmp_path: Path) -> None:
    result = _run_migrate(tmp_path, "FAILED: Can't locate revision identified by '0016'", 255)
    assert result.returncode == 0
    assert "WARNING: a newer version of the app has already migrated the database" in result.stderr


@needs_bash
def test_migrate_stops_the_start_on_any_other_failure(tmp_path: Path) -> None:
    result = _run_migrate(tmp_path, "sqlalchemy.exc.OperationalError: connection refused", 1)
    assert result.returncode == 1
    assert "connection refused" in result.stderr
    assert "The database migration failed; the app is not started." in result.stderr
