"""Deployment configuration checks (no network, no containers).

The app's Caddy must hand the API only the visitor's resolved address: forwarding the whole
X-Forwarded-For chain made uvicorn use the last proxy hop, so every visitor shared one IP and
one set of per-IP rate limits.
"""

import base64
import hashlib
import re
from pathlib import Path

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
    assert script.index('export DATA_DIR="$HOME/data"') < script.index("alembic upgrade head")


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
