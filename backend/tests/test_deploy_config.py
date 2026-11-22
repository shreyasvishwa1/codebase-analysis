"""Deployment configuration checks (no network, no containers).

The app's Caddy must hand the API only the visitor's resolved address: forwarding the whole
X-Forwarded-For chain made uvicorn use the last proxy hop, so every visitor shared one IP and
one set of per-IP rate limits.
"""

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
