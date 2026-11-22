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
