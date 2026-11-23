"""Facts about one file, for the architecture analysis: its imports, API routes, entry points,
roles and, for infrastructure files, what they declare.

Python is read as a syntax tree (``ast.parse``: nothing is compiled or run). JavaScript and
TypeScript imports, routes and entry points, Dockerfiles, CI and deployment files are
matched with fixed, linear patterns. Docker Compose files are parsed with PyYAML's safe
loader (no object construction) and only a few fields are read. Every fact keeps the line it
was found on, so the analysis can show its evidence.
"""

import ast
import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

import yaml  # type: ignore[import-untyped]

from app.analysis import python_ast
from app.analysis.architecture.catalog import npm_import_package, python_import_package
from app.services.code_imports import import_statements
from app.services.code_outline import _PARSE_ERRORS, MAX_OUTLINE_BYTES

MAX_LINE_CHARS = 1000
MAX_ROUTES_PER_FILE = 200
MAX_YAML_BYTES = 256 * 1024
MAX_NAME_CHARS = 200
ROUTER_ARGUMENT_LINES = 6

JS_LANGUAGES = frozenset({"JavaScript", "TypeScript", "TSX", "Vue", "Svelte"})
UI_SUFFIXES = (".tsx", ".jsx", ".vue", ".svelte")


@dataclass(frozen=True)
class Evidence:
    path: str
    line: int
    detail: str


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    file: str
    line: int
    framework: str


@dataclass(frozen=True)
class EntryPoint:
    kind: str
    path: str
    line: int
    detail: str


@dataclass(frozen=True)
class Service:
    """A Docker Compose service."""

    name: str
    file: str
    image: str | None
    build: bool
    ports: tuple[str, ...]
    depends_on: tuple[str, ...]


@dataclass
class FileFacts:
    path: str
    language: str | None
    code_lines: int
    python_imports: list[ast.Import | ast.ImportFrom] = field(default_factory=list)
    js_imports: list[tuple[int, str]] = field(default_factory=list)
    packages: dict[tuple[str, str], int] = field(
        default_factory=dict
    )  # (ecosystem, package) -> line
    routes: list[Route] = field(default_factory=list)
    entry_points: list[EntryPoint] = field(default_factory=list)
    roles: dict[str, Evidence] = field(default_factory=dict)


@dataclass
class InfrastructureFacts:
    items: list[dict[str, Any]] = field(default_factory=list)  # {kind, path, line, detail}
    services: list[Service] = field(default_factory=list)


def _lines(text: str) -> list[str]:
    return [line[:MAX_LINE_CHARS] for line in text.splitlines()]


def _cap(text: str) -> str:
    return text[:MAX_NAME_CHARS]


# --- Roles -------------------------------------------------------------------------------------

_TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs", "e2e"}
_TEST_NAME = re.compile(r"(^test_.*\.py$|_test\.py$|\.(test|spec)\.[jt]sx?$)", re.I)
_DATA_DIRS = {
    "models",
    "model",
    "repositories",
    "repository",
    "db",
    "database",
    "migrations",
    "entities",
    "dao",
}
_AUTH_WORDS = re.compile(
    r"(^|[_./-])(auth|authentication|login|logout|jwt|oauth|oauth2|passwords?|signin|signup)([_./-]|$)",
    re.I,
)
_CONFIG_NAME = re.compile(
    r"^(settings|config|configuration|conf)(\.[\w]+)*\.(py|js|ts|mjs|cjs|json|ya?ml|toml)$|\.config\.[jt]s$",
    re.I,
)
_WORKER_DIRS = {"worker", "workers", "tasks", "jobs", "queue", "queues"}
_AUTH_PACKAGES = {
    ("python", "pyjwt"), ("python", "jwt"), ("python", "passlib"), ("python", "bcrypt"),
    ("python", "argon2"), ("python", "argon2-cffi"), ("python", "authlib"),
    ("npm", "jsonwebtoken"), ("npm", "passport"), ("npm", "next-auth"), ("npm", "bcrypt"),
    ("npm", "bcryptjs"), ("npm", "jose"),
}  # fmt: skip


def path_roles(path: str) -> dict[str, Evidence]:
    """Roles a file has by its location and name alone."""
    roles: dict[str, Evidence] = {}
    pure = PurePosixPath(path)
    directories = {part.lower() for part in pure.parts[:-1]}
    name = pure.name
    if directories & _TEST_DIRS or _TEST_NAME.search(name):
        roles["test"] = Evidence(path, 1, "Test file")
    if name.lower().endswith(UI_SUFFIXES):
        roles["ui"] = Evidence(path, 1, "User interface component")
    if directories & _DATA_DIRS:
        roles["data"] = Evidence(path, 1, f"In a {sorted(directories & _DATA_DIRS)[0]}/ directory")
    if _AUTH_WORDS.search(path.lower()):
        roles["auth"] = Evidence(path, 1, "Authentication in its path")
    if _CONFIG_NAME.search(name):
        roles["config"] = Evidence(path, 1, "Configuration file")
    if directories & _WORKER_DIRS:
        roles["worker"] = Evidence(
            path, 1, f"In a {sorted(directories & _WORKER_DIRS)[0]}/ directory"
        )
    return roles


# --- Python ------------------------------------------------------------------------------------

_PY_ROUTE = re.compile(
    r"^\s*@(\w+)\.(get|post|put|patch|delete|head|options|route|api_route|websocket)\(\s*[rbuf]?[\"']([^\"']*)[\"']"
)
_PY_ROUTE_METHODS = re.compile(r"methods\s*=\s*[\[(]([^\])]*)[\])]")
_PY_ROUTER_PREFIX = re.compile(r"^\s*(\w+)\s*=\s*(?:APIRouter|Blueprint)\((.*)$")
_PY_PREFIX_ARG = re.compile(r"(?:prefix|url_prefix)\s*=\s*[\"']([^\"']*)[\"']")
_DJANGO_PATH = re.compile(r"^\s*(?:re_)?path\(\s*r?[\"']([^\"']*)[\"']\s*,")
_PY_APP = re.compile(r"^\s*(\w+)\s*=\s*(FastAPI|Flask|Starlette|Sanic|Quart)\(")
_PY_MAIN = re.compile(r"^if\s+__name__\s*==\s*[\"']__main__[\"']\s*:")


def _python(facts: FileFacts, text: str) -> None:
    lines = _lines(text)
    if len(text.encode("utf-8")) <= MAX_OUTLINE_BYTES:
        try:
            tree = python_ast.parse(text)  # a syntax tree only; nothing is compiled or run
        except _PARSE_ERRORS:
            tree = None
        if tree is not None:
            nodes, _ = import_statements(tree)
            facts.python_imports = nodes
            for node in nodes:
                modules = (
                    [a.name for a in node.names]
                    if isinstance(node, ast.Import)
                    else ([node.module] if node.module and node.level == 0 else [])
                )
                for module in modules:
                    facts.packages.setdefault(
                        ("python", python_import_package(module)), node.lineno
                    )
    prefixes: dict[str, str] = {}
    name = PurePosixPath(facts.path).name
    for number, line in enumerate(lines, start=1):
        router = _PY_ROUTER_PREFIX.match(line)
        if router:
            # The constructor's arguments, up to ROUTER_ARGUMENT_LINES lines.
            arguments = " ".join([router.group(2), *lines[number : number + ROUTER_ARGUMENT_LINES]])
            if prefix := _PY_PREFIX_ARG.search(arguments.split(")", 1)[0]):
                prefixes[router.group(1)] = prefix.group(1)
        route = _PY_ROUTE.match(line)
        if route and len(facts.routes) < MAX_ROUTES_PER_FILE:
            owner, verb, path = route.groups()
            methods = [verb.upper()]
            if verb in ("route", "api_route"):
                listed = _PY_ROUTE_METHODS.search(line)
                methods = (
                    [m.strip(" '\"").upper() for m in listed.group(1).split(",") if m.strip(" '\"")]
                    if listed
                    else ["GET"]
                )
            for method in methods:
                facts.routes.append(
                    Route(
                        method, _cap(prefixes.get(owner, "") + path), facts.path, number, "Python"
                    )
                )
        if (
            name == "urls.py"
            and (django := _DJANGO_PATH.match(line))
            and len(facts.routes) < MAX_ROUTES_PER_FILE
        ):
            facts.routes.append(
                Route("ANY", _cap("/" + django.group(1)), facts.path, number, "Django")
            )
        if app := _PY_APP.match(line):
            facts.entry_points.append(
                EntryPoint("web application", facts.path, number, f"{app.group(2)} application")
            )
        if _PY_MAIN.match(line):
            facts.entry_points.append(
                EntryPoint("script", facts.path, number, "Runs as a script (__main__)")
            )
    if name in ("manage.py", "wsgi.py", "asgi.py") and not any(
        e.kind == "web application" for e in facts.entry_points
    ):
        kind = "management command" if name == "manage.py" else "web application"
        facts.entry_points.append(EntryPoint(kind, facts.path, 1, f"{name} (Django convention)"))


# --- JavaScript / TypeScript -------------------------------------------------------------------

_JS_IMPORT = re.compile(
    r"""(?:^|[\s;])(?:import|export)\s[^'"`]{0,300}?from\s*['"]([^'"]{1,300})['"]"""
    r"""|(?:^|[\s;(=])import\s*['"]([^'"]{1,300})['"]"""
    r"""|\brequire\(\s*['"]([^'"]{1,300})['"]\s*\)"""
    r"""|\bimport\(\s*['"]([^'"]{1,300})['"]\s*\)"""
)
_JS_ROUTE = re.compile(
    r"""\b(app|router|server|api|fastify|routes)\.(get|post|put|patch|delete|all|options|head)\(\s*['"`](/[^'"`]{0,200})['"`]"""
)
_JS_FRONTEND_ENTRY = re.compile(
    r"\b(createRoot|ReactDOM\.render|hydrateRoot|createApp|bootstrapApplication)\s*\("
)
_JS_LISTEN = re.compile(r"\.listen\(\s*(?:[\w.]+|\d+)")
_NEXT_PAGES_API = re.compile(r"(?:^|/)pages/(api/.+?)\.(?:js|ts|jsx|tsx|mjs)$")
_NEXT_APP_ROUTE = re.compile(r"(?:^|/)app/(.*?)/?route\.(?:js|ts|mjs)$")
_NEXT_METHOD = re.compile(
    r"^\s*export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b"
)
_SERVER_PACKAGES = {"express", "koa", "fastify", "http", "https", "node:http", "@hapi/hapi", "hapi"}


def _next_path(raw: str) -> str:
    parts = [p for p in raw.split("/") if p and not (p.startswith("(") and p.endswith(")"))]
    if parts and parts[-1] == "index":
        parts = parts[:-1]
    return "/" + "/".join(re.sub(r"^\[\.{0,3}(.+)\]$", r"{\1}", p) for p in parts)


def _javascript(facts: FileFacts, text: str) -> None:
    lines = _lines(text)
    server = False
    for number, line in enumerate(lines, start=1):
        for match in _JS_IMPORT.finditer(line):
            specifier = next(group for group in match.groups() if group)
            facts.js_imports.append((number, specifier))
            package = npm_import_package(specifier)
            if package:
                facts.packages.setdefault(("npm", package.lower()), number)
                server = server or package in _SERVER_PACKAGES
        route = _JS_ROUTE.search(line)
        if route and len(facts.routes) < MAX_ROUTES_PER_FILE:
            facts.routes.append(
                Route(
                    route.group(2).upper(), _cap(route.group(3)), facts.path, number, "JavaScript"
                )
            )
        if _JS_FRONTEND_ENTRY.search(line):
            facts.entry_points.append(
                EntryPoint("frontend entry", facts.path, number, "Mounts the user interface")
            )
        if server and _JS_LISTEN.search(line):
            facts.entry_points.append(
                EntryPoint("server entry", facts.path, number, "Starts an HTTP server")
            )
    next_route = _NEXT_PAGES_API.search(facts.path) or _NEXT_APP_ROUTE.search(facts.path)
    if next_route:
        methods = [
            (n, m.group(1))
            for n, line in enumerate(lines, start=1)
            if (m := _NEXT_METHOD.match(line))
        ]
        route_path = _next_path(next_route.group(1))
        for number, method in methods or [(1, "ANY")]:
            facts.routes.append(Route(method, _cap(route_path), facts.path, number, "Next.js"))


def scan_source(path: str, language: str | None, text: str, code_lines: int) -> FileFacts:
    facts = FileFacts(path=path, language=language, code_lines=code_lines, roles=path_roles(path))
    if language == "Python":
        _python(facts, text)
    elif language in JS_LANGUAGES:
        _javascript(facts, text)
    if facts.routes:
        first = facts.routes[0]
        facts.roles.setdefault(
            "api", Evidence(path, first.line, f"Declares routes ({first.method} {first.path})")
        )
    return facts


# --- Manifests and infrastructure --------------------------------------------------------------

_DOCKER_FROM = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", re.I)
_DOCKER_EXPOSE = re.compile(r"^\s*EXPOSE\s+(.+)$", re.I)
_DOCKER_CMD = re.compile(r"^\s*(CMD|ENTRYPOINT)\s+(.+)$", re.I)
_K8S_KIND = re.compile(
    r"^kind:\s*(Deployment|StatefulSet|DaemonSet|Service|Ingress|CronJob|Job)\s*$", re.M
)
_K8S_API = re.compile(r"^apiVersion:\s*\S+", re.M)
_WORKFLOW_NAME = re.compile(r"^name:\s*['\"]?([^'\"\n]{1,100})", re.M)

CI_FILES = {".gitlab-ci.yml": "GitLab CI", "Jenkinsfile": "Jenkins", "azure-pipelines.yml": "Azure Pipelines",
            "bitbucket-pipelines.yml": "Bitbucket Pipelines", ".travis.yml": "Travis CI"}  # fmt: skip
DEPLOY_FILES = {
    "render.yaml": "Render", "railway.json": "Railway", "railway.toml": "Railway", "vercel.json": "Vercel",
    "netlify.toml": "Netlify", "Procfile": "Procfile (Heroku-style)", "fly.toml": "Fly.io",
    "app.json": "Heroku app manifest", "serverless.yml": "Serverless Framework", "Chart.yaml": "Helm chart",
}  # fmt: skip
WEB_SERVER_FILES = {"nginx.conf": "nginx", "Caddyfile": "Caddy"}


def _is_compose(name: str) -> bool:
    lowered = name.lower()
    return lowered.startswith(("docker-compose", "compose")) and lowered.endswith((".yml", ".yaml"))


def _compose_services(path: str, text: str) -> list[Service]:
    if len(text.encode("utf-8")) > MAX_YAML_BYTES:
        return []
    try:
        data = yaml.safe_load(text)  # plain data only; no objects are constructed
    except yaml.YAMLError:
        return []
    services = data.get("services") if isinstance(data, dict) else None
    if not isinstance(services, dict):
        return []
    found: list[Service] = []
    for name, spec in list(services.items())[:50]:
        if not isinstance(name, str) or not isinstance(spec, dict):
            continue
        image = spec.get("image") if isinstance(spec.get("image"), str) else None
        raw_ports = spec.get("ports")
        ports: list[Any] = raw_ports if isinstance(raw_ports, list) else []
        depends = spec.get("depends_on")
        depends_on = list(depends) if isinstance(depends, (list, dict)) else []
        found.append(
            Service(
                name=_cap(name),
                file=path,
                image=_cap(image) if image else None,
                build="build" in spec,
                ports=tuple(_cap(str(p)) for p in ports[:10] if isinstance(p, (str, int))),
                depends_on=tuple(_cap(d) for d in depends_on[:20] if isinstance(d, str)),
            )
        )
    return found


def scan_infrastructure(path: str, text: str, facts: InfrastructureFacts) -> None:
    """Record what an infrastructure file declares (Dockerfiles, Compose, CI, deployment)."""
    pure = PurePosixPath(path)
    name = pure.name
    lowered = name.lower()

    def add(kind: str, line: int, detail: str) -> None:
        facts.items.append({"kind": kind, "path": path, "line": line, "detail": _cap(detail)})

    if (
        lowered == "dockerfile"
        or lowered.startswith("dockerfile.")
        or lowered.endswith(".dockerfile")
    ):
        for number, line in enumerate(_lines(text), start=1):
            if image := _DOCKER_FROM.match(line):
                add("container image", number, f"Base image {image.group(1)}")
            elif expose := _DOCKER_EXPOSE.match(line):
                add("container port", number, f"Exposes {expose.group(1).strip()}")
            elif command := _DOCKER_CMD.match(line):
                add(
                    "container command",
                    number,
                    f"{command.group(1).upper()} {command.group(2).strip()}",
                )
        return
    if _is_compose(name):
        services = _compose_services(path, text)
        facts.services.extend(services)
        add(
            "compose",
            1,
            f"Docker Compose with {len(services)} service{'s' if len(services) != 1 else ''}",
        )
        return
    parts = pure.parts
    if (
        len(parts) >= 3
        and parts[-3:-1] == (".github", "workflows")
        and lowered.endswith((".yml", ".yaml"))
    ):
        workflow = _WORKFLOW_NAME.search(text)
        add(
            "ci",
            1,
            f"GitHub Actions workflow{': ' + workflow.group(1).strip() if workflow else ''}",
        )
        return
    if path == ".circleci/config.yml" or path.endswith("/.circleci/config.yml"):
        add("ci", 1, "CircleCI")
        return
    if name in CI_FILES:
        add("ci", 1, CI_FILES[name])
    elif name in DEPLOY_FILES:
        add("deployment", 1, DEPLOY_FILES[name])
    elif name in WEB_SERVER_FILES or lowered.endswith(".nginx"):
        add("web server", 1, WEB_SERVER_FILES.get(name, "nginx"))
    elif lowered.endswith(".tf"):
        add("infrastructure as code", 1, "Terraform")
    elif (
        lowered.endswith((".yml", ".yaml"))
        and _K8S_API.search(text)
        and (kind := _K8S_KIND.search(text))
    ):
        add("kubernetes", text[: kind.start()].count("\n") + 1, f"Kubernetes {kind.group(1)}")


def package_json_entry_points(path: str, text: str) -> list[EntryPoint]:
    """Entry points a package.json declares: main, bin and the start/dev/serve scripts."""
    try:
        data = json.loads(text)
    except ValueError:
        return []
    if not isinstance(data, dict):
        return []
    lines = _lines(text)

    def line_of(key: str) -> int:
        return next((n for n, line in enumerate(lines, start=1) if f'"{key}"' in line), 1)

    found: list[EntryPoint] = []
    if isinstance(data.get("main"), str):
        found.append(
            EntryPoint("package main", path, line_of("main"), _cap(f"main: {data['main']}"))
        )
    if isinstance(data.get("bin"), (str, dict)):
        found.append(EntryPoint("command-line tool", path, line_of("bin"), "Declares bin commands"))
    scripts = data.get("scripts")
    if isinstance(scripts, dict):
        for script in ("start", "dev", "serve"):
            if isinstance(scripts.get(script), str):
                found.append(
                    EntryPoint(
                        "script",
                        path,
                        line_of(script),
                        _cap(f"npm run {script}: {scripts[script]}"),
                    )
                )
    return found


def html_entry_point(path: str) -> EntryPoint | None:
    pure = PurePosixPath(path)
    if pure.name == "index.html" and len(pure.parts) <= 3:
        return EntryPoint("web page", path, 1, "index.html served to the browser")
    return None
