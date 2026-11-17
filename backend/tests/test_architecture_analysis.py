"""Architecture analysis tests (phase 6: Module 7).

- The catalog, the file scanner and the architecture analyzer are tested without a database
  on a small full-stack sample repository.
- API tests reuse the full-analysis fixtures (the throwaway test database inside rolled-back
  transactions, inline ingestion and inline analysis jobs).
"""

import json
import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.architecture import analyzer as analyzer_module
from app.analysis.architecture.analyzer import (
    ArchitectureAnalyzer,
    ArchitectureResult,
    _resolve_js,
    _strongly_connected,
    choose_depth,
    component_key,
    primary_role,
)
from app.analysis.architecture.catalog import (
    image_data_store,
    npm_import_package,
    python_import_package,
    technology,
)
from app.analysis.architecture.scanner import (
    InfrastructureFacts,
    html_entry_point,
    package_json_entry_points,
    path_roles,
    scan_infrastructure,
    scan_source,
)
from app.analysis.dependencies.analyzer import DependencyAnalyzer
from app.analysis.summary import SnapshotFile
from app.models import AnalysisRun, ArchitectureReport, Repository
from app.services.languages import detect_language
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

# --- A small full-stack repository ---------------------------------------------------------------

SAMPLE: dict[str, str] = {
    "backend/app/main.py": (
        "from fastapi import FastAPI\n"
        "from app.api import routes\n\n"
        "app = FastAPI()\n"
        "app.include_router(routes.router)\n"
    ),
    "backend/app/api/routes.py": (
        "from fastapi import APIRouter\n"
        "from app.services.orders import list_orders\n"
        "from ..core import auth\n\n"
        "router = APIRouter(\n"
        '    prefix="/orders",\n'
        '    tags=["orders"],\n'
        ")\n\n\n"
        '@router.get("")\n'
        "def index():\n"
        "    return list_orders()\n\n\n"
        '@router.post("/{order_id}/pay")\n'
        "def pay(order_id: int):\n"
        "    return auth.check()\n"
    ),
    "backend/app/services/orders.py": (
        "from app.models.order import Order\n"
        "from app.api import routes  # services and api import each other\n\n\n"
        "def list_orders():\n"
        "    return Order\n"
    ),
    "backend/app/models/order.py": "from sqlalchemy.orm import DeclarativeBase\n\n\nclass Order:\n    pass\n",
    "backend/app/core/auth.py": "import jwt\n\n\ndef check():\n    return jwt\n",
    "backend/requirements.txt": "fastapi==0.110.0\nsqlalchemy==2.0.29\npsycopg2-binary==2.9.9\n",
    "backend/tests/test_orders.py": (
        "from app.services.orders import list_orders\n\n\n"
        "def test_list():\n"
        "    assert list_orders() is not None\n"
    ),
    "backend/Dockerfile": 'FROM python:3.12-slim\nEXPOSE 8000\nCMD ["uvicorn", "app.main:app"]\n',
    "frontend/package.json": json.dumps(
        {
            "name": "web",
            "scripts": {"dev": "vite"},
            "dependencies": {"react": "^18.3.1", "axios": "^1.7.0"},
            "devDependencies": {"vite": "^5.4.0"},
        },
        indent=2,
    ),
    "frontend/index.html": "<div id='root'></div>\n",
    "frontend/src/main.tsx": (
        "import { createRoot } from 'react-dom/client'\n"
        "import App from './App'\n"
        "import './index.css'\n"
        "createRoot(document.getElementById('root')!).render(<App />)\n"
    ),
    "frontend/src/App.tsx": (
        "import { OrderList } from '@/components/OrderList'\n"
        "export default function App() { return <OrderList /> }\n"
    ),
    "frontend/src/components/OrderList.tsx": (
        "import { fetchOrders } from '../api/client.js'\n"
        "export function OrderList() { return fetchOrders }\n"
    ),
    "frontend/src/api/client.ts": (
        "import axios from 'axios'\n" "export const fetchOrders = () => axios.get('/orders')\n"
    ),
    "server/index.js": (
        "const express = require('express')\n"
        "const app = express()\n"
        "app.get('/health', (req, res) => res.send('ok'))\n"
        "app.listen(3000)\n"
    ),
    "docker-compose.yml": (
        "services:\n"
        "  api:\n"
        "    build: ./backend\n"
        "    ports: ['8000:8000']\n"
        "    depends_on: [db, cache]\n"
        "  db:\n"
        "    image: postgres:16\n"
        "  cache:\n"
        "    image: redis:7-alpine\n"
    ),
    ".github/workflows/ci.yml": "name: CI\non: push\njobs: {}\n",
    "node_modules/x/index.js": "import y from './y'\n",  # excluded directory
}


def _file(path: str, text: str) -> SnapshotFile:
    name = path.rsplit("/", 1)[-1]
    extension = name.rsplit(".", 1)[-1] if "." in name else None
    return SnapshotFile(path, detect_language(name, extension), len(text.encode()), "text", text)


def _analyze(files: dict[str, str] = SAMPLE) -> ArchitectureResult:
    architecture, dependencies = ArchitectureAnalyzer(), DependencyAnalyzer()
    for path, text in files.items():
        architecture.add(_file(path, text))
        dependencies.add(_file(path, text))
    return architecture.result(dependencies.records)


# --- Catalog ---------------------------------------------------------------------------------------


def test_catalog_lookups() -> None:
    assert technology("python", "FastAPI").name == "FastAPI"  # type: ignore[union-attr]
    assert technology("npm", "react-dom").name == "React"  # type: ignore[union-attr]
    assert technology("npm", "left-pad") is None
    assert npm_import_package("react-dom/client") == "react-dom"
    assert npm_import_package("@tanstack/react-query/devtools") == "@tanstack/react-query"
    for local in ("./x", "../y", "@/lib/z", "node:fs", "/abs", "~/a"):
        assert npm_import_package(local) is None
    assert python_import_package("sqlalchemy.orm") == "sqlalchemy"
    assert python_import_package("MySQLdb") == "mysqlclient"
    assert image_data_store("postgres:16-alpine") == "PostgreSQL"
    assert image_data_store("docker.io/library/redis:7@sha256:abc") == "Redis"
    assert image_data_store("node:20") is None


# --- Scanner -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "roles"),
    [
        ("tests/test_api.py", {"test"}),
        ("tests/helpers.py", {"test"}),  # in a test directory, whatever its name
        ("web/__tests__/setup.ts", {"test"}),
        ("app/orders_test.py", {"test"}),
        ("web/src/Cart.spec.ts", {"test"}),
        ("web/src/Cart.tsx", {"ui"}),
        ("app/models/user.py", {"data"}),
        ("app/auth/jwt.py", {"auth"}),
        ("app/login.py", {"auth"}),
        ("app/session.py", set()),  # a database session is not authentication
        ("app/security/scan.py", set()),
        ("config/settings.py", {"config"}),
        ("web/vite.config.ts", {"config"}),
        ("app/workers/email.py", {"worker"}),
        ("app/services/orders.py", set()),
    ],
)
def test_path_roles(path: str, roles: set[str]) -> None:
    assert set(path_roles(path)) == roles


def test_python_facts() -> None:
    facts = scan_source(
        "backend/app/api/routes.py", "Python", SAMPLE["backend/app/api/routes.py"], 12
    )
    assert [(r.method, r.path, r.line) for r in facts.routes] == [
        ("GET", "/orders", 11),
        ("POST", "/orders/{order_id}/pay", 16),
    ]
    assert facts.roles["api"].detail == "Declares routes (GET /orders)"
    assert ("python", "fastapi") in facts.packages and facts.packages[("python", "app")] == 2
    assert len(facts.python_imports) == 3
    flask = scan_source(
        "app.py",
        "Python",
        "from flask import Flask\napp = Flask(__name__)\n@app.route('/a', methods=['GET', 'POST'])\ndef a(): pass\n"
        "@app.route('/b')\ndef b(): pass\nif __name__ == '__main__':\n    app.run()\n",
        8,
    )
    assert [(r.method, r.path) for r in flask.routes] == [
        ("GET", "/a"),
        ("POST", "/a"),
        ("GET", "/b"),
    ]
    assert [(e.kind, e.line) for e in flask.entry_points] == [("web application", 2), ("script", 7)]
    django = scan_source(
        "shop/urls.py", "Python", "urlpatterns = [\n    path('orders/', views.orders),\n]\n", 3
    )
    assert [(r.method, r.path, r.framework) for r in django.routes] == [
        ("ANY", "/orders/", "Django")
    ]
    manage = scan_source("manage.py", "Python", "import os\n", 1)
    assert [(e.kind, e.detail) for e in manage.entry_points] == [
        ("management command", "manage.py (Django convention)")
    ]
    broken = scan_source("x.py", "Python", "def (:\n", 1)
    assert broken.python_imports == [] and broken.routes == []


def test_javascript_facts() -> None:
    text = (
        "import React from 'react'\n"
        "import './styles.css'\n"
        "export { a } from './a'\n"
        "const fs = require('fs')\n"
        "const lazy = import('./lazy')\n"
        "router.post('/orders', handler)\n"
        "createRoot(el).render(app)\n"
    )
    facts = scan_source("web/src/main.tsx", "TSX", text, 7)
    assert [s for _, s in facts.js_imports] == ["react", "./styles.css", "./a", "fs", "./lazy"]
    assert facts.packages == {("npm", "react"): 1, ("npm", "fs"): 4}
    assert [(r.method, r.path, r.line) for r in facts.routes] == [("POST", "/orders", 6)]
    assert [(e.kind, e.line) for e in facts.entry_points] == [("frontend entry", 7)]
    no_server = scan_source("a.js", "JavaScript", "worker.listen(1)\n", 1)
    assert no_server.entry_points == []  # listen() counts only with a server framework
    server = scan_source("server/index.js", "JavaScript", SAMPLE["server/index.js"], 4)
    assert [(e.kind, e.line) for e in server.entry_points] == [("server entry", 4)]
    pages = scan_source(
        "web/pages/api/orders/[id].ts", "TypeScript", "export default function h() {}\n", 1
    )
    assert [(r.method, r.path, r.framework) for r in pages.routes] == [
        ("ANY", "/api/orders/{id}", "Next.js")
    ]
    app_route = scan_source(
        "web/app/(shop)/orders/route.ts",
        "TypeScript",
        "export async function GET() {}\nexport const POST = handler\n",
        2,
    )
    assert [(r.method, r.path, r.line) for r in app_route.routes] == [
        ("GET", "/orders", 1),
        ("POST", "/orders", 2),
    ]


def test_infrastructure_files() -> None:
    facts = InfrastructureFacts()
    for path in ("backend/Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml"):
        scan_infrastructure(path, SAMPLE[path], facts)
    scan_infrastructure("render.yaml", "services: []\n", facts)
    scan_infrastructure("deploy/nginx.conf", "server {}\n", facts)
    scan_infrastructure("infra/main.tf", "resource {}\n", facts)
    scan_infrastructure("k8s/api.yaml", "apiVersion: apps/v1\nkind: Deployment\n", facts)
    scan_infrastructure(
        "k8s/values.yaml", "kind: Deployment\n", facts
    )  # no apiVersion: not Kubernetes
    scan_infrastructure(".gitlab-ci.yml", "stages: []\n", facts)
    scan_infrastructure("src/app.py", "print(1)\n", facts)
    assert [(i["kind"], i["path"], i["line"], i["detail"]) for i in facts.items] == [
        ("container image", "backend/Dockerfile", 1, "Base image python:3.12-slim"),
        ("container port", "backend/Dockerfile", 2, "Exposes 8000"),
        ("container command", "backend/Dockerfile", 3, 'CMD ["uvicorn", "app.main:app"]'),
        ("compose", "docker-compose.yml", 1, "Docker Compose with 3 services"),
        ("ci", ".github/workflows/ci.yml", 1, "GitHub Actions workflow: CI"),
        ("deployment", "render.yaml", 1, "Render"),
        ("web server", "deploy/nginx.conf", 1, "nginx"),
        ("infrastructure as code", "infra/main.tf", 1, "Terraform"),
        ("kubernetes", "k8s/api.yaml", 2, "Kubernetes Deployment"),
        ("ci", ".gitlab-ci.yml", 1, "GitLab CI"),
    ]
    api, db, cache = facts.services
    assert (api.name, api.build, api.image, api.ports, api.depends_on) == (
        "api",
        True,
        None,
        ("8000:8000",),
        ("db", "cache"),
    )
    assert (db.image, cache.image) == ("postgres:16", "redis:7-alpine")


def test_unusable_compose_files() -> None:
    facts = InfrastructureFacts()
    scan_infrastructure("compose.yaml", "services: [unclosed\n", facts)
    scan_infrastructure("docker-compose.yml", "just a string\n", facts)
    dict_depends = (
        "services:\n  a:\n    image: x\n    depends_on:\n      b: {condition: service_healthy}\n"
    )
    scan_infrastructure("compose.yml", dict_depends, facts)
    assert [i["detail"] for i in facts.items] == [
        "Docker Compose with 0 services",
        "Docker Compose with 0 services",
        "Docker Compose with 1 service",
    ]
    assert facts.services[0].depends_on == ("b",)


def test_large_compose_files_are_not_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.analysis.architecture import scanner

    monkeypatch.setattr(scanner, "MAX_YAML_BYTES", 20)
    facts = InfrastructureFacts()
    scan_infrastructure("docker-compose.yml", SAMPLE["docker-compose.yml"], facts)
    assert facts.services == [] and facts.items[0]["detail"] == "Docker Compose with 0 services"


def test_manifest_and_page_entry_points() -> None:
    text = json.dumps(
        {
            "main": "server.js",
            "bin": {"tool": "cli.js"},
            "scripts": {"start": "node server.js", "test": "jest"},
        },
        indent=2,
    )
    entries = package_json_entry_points("package.json", text)
    assert [(e.kind, e.line, e.detail) for e in entries] == [
        ("package main", 2, "main: server.js"),
        ("command-line tool", 3, "Declares bin commands"),
        ("script", 7, "npm run start: node server.js"),
    ]
    assert package_json_entry_points("package.json", "{oops") == []
    assert html_entry_point("frontend/index.html") is not None
    assert html_entry_point("docs/site/deep/index.html") is None


# --- Analyzer -------------------------------------------------------------------------------------


def test_components_edges_and_roles() -> None:
    document = _analyze().document
    assert document["depth"] == 4
    components = {c["id"]: c for c in document["components"]}
    assert set(components) == {
        "backend/app", "backend/app/api", "backend/app/services", "backend/app/models",
        "backend/app/core", "backend/tests", "frontend/src", "frontend/src/components",
        "frontend/src/api", "server",
    }  # fmt: skip
    assert (components["backend/app/api"]["role"], components["backend/app/api"]["roles"]) == (
        "api",
        ["api"],
    )
    assert components["backend/app/models"]["role"] == "data"
    assert components["backend/tests"]["role"] == "test"
    assert components["frontend/src"]["role"] == "ui"
    assert components["server"]["role"] == "api"  # Express route
    assert components["backend/app/core"]["role"] == "auth"  # its only file is auth.py
    api = components["backend/app/api"]
    assert api["evidence"]["api"][0] == {
        "path": "backend/app/api/routes.py",
        "line": 11,
        "detail": "Declares routes (GET /orders)",
    }
    assert (api["files"], api["languages"], api["depends_on"], api["used_by"]) == (
        1,
        ["Python"],
        2,
        2,
    )

    edges = {(e["source"], e["target"]): e for e in document["edges"]}
    assert set(edges) == {
        ("backend/app", "backend/app/api"),
        ("backend/app/api", "backend/app/services"),
        ("backend/app/api", "backend/app/core"),  # relative import (..core)
        ("backend/app/services", "backend/app/models"),
        ("backend/app/services", "backend/app/api"),
        ("backend/tests", "backend/app/services"),
        ("frontend/src", "frontend/src/components"),  # @/ alias
        ("frontend/src/components", "frontend/src/api"),  # '../api/client.js' -> client.ts
    }
    example = edges[("backend/app/api", "backend/app/services")]["examples"][0]
    assert example == {
        "path": "backend/app/api/routes.py",
        "line": 2,
        "detail": "imports backend/app/services/orders.py",
    }
    assert document["cycles"] == [["backend/app/api", "backend/app/services"]]


def test_technologies_data_stores_routes_entry_points_infrastructure() -> None:
    result = _analyze()
    document, summary = result.document, result.summary
    names = [(t["name"], t["category"]) for t in document["technologies"]]
    assert names == [
        ("Express", "backend"), ("FastAPI", "backend"), ("React", "frontend"), ("SQLAlchemy", "orm"),
        ("PostgreSQL", "database"), ("Axios", "http"), ("Vite", "build"),
    ]  # fmt: skip
    fastapi = next(t for t in document["technologies"] if t["name"] == "FastAPI")
    assert fastapi["evidence"][0] == {
        "path": "backend/requirements.txt",
        "line": 1,
        "detail": "Declares fastapi ==0.110.0",
    }
    assert {"path": "backend/app/main.py", "line": 1, "detail": "Imports fastapi"} in fastapi[
        "evidence"
    ]
    stores = {s["name"]: s["evidence"] for s in document["data_stores"]}
    assert set(stores) == {"PostgreSQL", "Redis"}
    assert stores["Redis"] == [
        {
            "path": "docker-compose.yml",
            "line": 1,
            "detail": "Compose service cache (redis:7-alpine)",
        }
    ]
    assert [(r["method"], r["path"], r["file"]) for r in document["routes"]] == [
        ("GET", "/health", "server/index.js"),
        ("GET", "/orders", "backend/app/api/routes.py"),
        ("POST", "/orders/{order_id}/pay", "backend/app/api/routes.py"),
    ]
    assert [(e["kind"], e["path"]) for e in document["entry_points"]] == [
        ("web application", "backend/app/main.py"),
        ("web page", "frontend/index.html"),
        ("script", "frontend/package.json"),
        ("frontend entry", "frontend/src/main.tsx"),
        ("server entry", "server/index.js"),
    ]
    assert {s["name"]: s["data_store"] for s in document["services"]} == {
        "api": None,
        "db": "PostgreSQL",
        "cache": "Redis",
    }
    assert not any("node_modules" in c["id"] for c in document["components"])
    assert summary == {
        "source_files": 11, "components": 10, "edges": 8, "imports": 8, "routes": 3, "entry_points": 5,
        "technologies": ["Express", "FastAPI", "React", "SQLAlchemy", "PostgreSQL", "Axios", "Vite"],
        "data_stores": ["PostgreSQL", "Redis"], "infrastructure": 5, "services": 3, "cycles": 1,
        "observations": len(document["observations"]),
        "has_tests": True,
        "has_ci": True,
        "separated": True,
    }  # fmt: skip


def test_summary_facts_for_the_health_score() -> None:
    bare = _analyze({"src/app.py": "def main():\n    return 1\n"}).summary
    assert (bare["has_tests"], bare["has_ci"], bare["separated"]) == (False, False, False)
    # Separated by a frontend and a backend in one repository, without API or data layers.
    split = _analyze(
        {
            "frontend/src/main.tsx": "export const a = 1\n",
            "frontend/package.json": '{"dependencies": {"react": "^18.0.0"}}',
            "backend/app/main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
            "backend/requirements.txt": "fastapi==0.110.0\n",
        }
    ).summary
    assert (split["has_tests"], split["has_ci"], split["separated"]) == (False, False, True)


def test_observations_have_evidence() -> None:
    observations = {o["title"]: o for o in _analyze().document["observations"]}
    assert list(observations) == [
        "Frontend and backend in one repository",
        "Layered structure",
        "Circular dependency",
        "Containerized",
        "Continuous integration",
    ]
    assert observations["Circular dependency"]["detail"] == (
        "2 components import each other in a cycle: backend/app/api, backend/app/services."
    )
    assert (
        observations["Containerized"]["detail"]
        == "Runs in containers; Docker Compose defines 3 services."
    )
    for title, observation in observations.items():
        assert observation["evidence"], title
    no_tests = _analyze({"app/main.py": "x = 1\n"}).document["observations"]
    assert [o["title"] for o in no_tests] == ["No automated tests found"]


def test_most_depended_on_component() -> None:
    files = {f"pkg{n}/m.py": "from core.base import X\n" for n in range(3)} | {
        "core/base.py": "X = 1\n"
    }
    observations = {o["title"]: o for o in _analyze(files).document["observations"]}
    hub = observations["Most depended-on component"]
    assert hub["detail"] == "core is imported by 3 other components; changes to it affect them all."
    assert len(hub["evidence"]) == 3


def test_depth_shrinks_to_keep_the_diagram_readable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_COMPONENTS", 3)  # depth 2 gives 4
    document = _analyze().document
    assert document["depth"] == 1
    assert {c["id"] for c in document["components"]} == {"backend", "frontend", "server"}
    paths = ["a/b/c/d/e/f.py", "a/x.py", "root.py"]
    assert choose_depth(paths) == 4 and component_key("root.py", 4) == "(root)"
    assert component_key("a/b/c/d/e/f.py", 2) == "a/b"


def test_limits_mark_truncated_lists(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analyzer_module, "MAX_ROUTES", 1)
    monkeypatch.setattr(analyzer_module, "MAX_EDGES", 2)
    result = _analyze()
    assert len(result.document["routes"]) == 1 and result.summary["routes"] == 3
    assert len(result.document["edges"]) == 2 and result.summary["edges"] == 8
    assert result.document["truncated"] == {
        "edges": True,
        "routes": True,
        "entry_points": False,
        "infrastructure": False,
    }


def test_ambiguous_imports_resolve_to_the_nearest_file() -> None:
    from app.analysis.architecture.analyzer import _closest

    assert _closest("a/x/y.py", {"b/m.py", "a/x/m.py", "a/m.py"}) == "a/x/m.py"
    assert _closest("c/y.py", {"b/m.py", "a/m.py"}) == "a/m.py"  # a tie: the first path
    assert _closest("c/y.py", set()) is None


def test_frontend_and_backend_in_one_directory_is_not_split() -> None:
    files = {
        "app/package.json": json.dumps({"dependencies": {"react": "18.0.0"}}),
        "app/requirements.txt": "fastapi==0.110.0\n",
        "app/tests/test_a.py": "x = 1\n",
    }
    titles = [o["title"] for o in _analyze(files).document["observations"]]
    assert "Frontend and backend in one repository" not in titles


def test_primary_roles_and_cycles() -> None:
    from collections import Counter

    assert primary_role(Counter({"test": 2, "ui": 2}), 4) == "test"
    assert primary_role(Counter({"ui": 3, "api": 1}), 4) == "ui"
    assert primary_role(Counter({"api": 1, "data": 1}), 9) == "api"
    assert primary_role(Counter({"auth": 1}), 9) == "core"  # one file of nine
    assert primary_role(Counter({"auth": 5}), 9) == "auth"
    assert primary_role(Counter({"config": 1}), 3) == "core"
    assert primary_role(Counter(), 1) == "core"
    graph = {"a": {"b"}, "b": {"c"}, "c": {"a"}, "d": {"e"}, "e": {"d"}, "f": {"a"}}
    assert _strongly_connected(["a", "b", "c", "d", "e", "f", "g"], graph) == [
        ["a", "b", "c"],
        ["d", "e"],
    ]


def test_javascript_resolution() -> None:
    known = {"web/src/a.ts", "web/src/lib/index.tsx", "web/src/b.js", "web/src/c.ts"}
    assert _resolve_js("web/src/x.ts", "./a", known) == "web/src/a.ts"
    assert _resolve_js("web/src/x.ts", "./lib", known) == "web/src/lib/index.tsx"
    assert _resolve_js("web/src/x.ts", "./b.js", known) == "web/src/b.js"
    assert _resolve_js("web/src/x.ts", "./c.js", known) == "web/src/c.ts"
    assert _resolve_js("web/src/deep/x.ts", "@/a", known) == "web/src/a.ts"
    assert _resolve_js("web/x.ts", "@/a", known) is None  # no src/ above the importer
    assert _resolve_js("web/src/x.ts", "../../../../a", known | {"a.ts"}) is None  # above the root
    assert _resolve_js("web/src/x.ts", "react", known) is None


# --- API -----------------------------------------------------------------------------------------

ARCHITECTURE_FILES: dict[str, bytes] = {**FILES, **{p: t.encode() for p, t in SAMPLE.items()}}


def _url(owner: Owner, run_id: str, repository_id: str | None = None) -> str:
    return f"{_runs_url(owner, repository_id)}/{run_id}/architecture"


async def _analyzed_run(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    files: dict[str, bytes] = ARCHITECTURE_FILES,
) -> dict[str, Any]:
    await _ingest(client, owner, files)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


@requires_db
async def test_run_stores_the_architecture_report(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    summary = run["architecture"]
    assert summary["routes"] == 3 and summary["cycles"] == 1
    assert summary["data_stores"] == ["PostgreSQL", "Redis"]
    stored = await db_session.scalar(
        select(func.count())
        .select_from(ArchitectureReport)
        .where(ArchitectureReport.run_id == uuid.UUID(run["id"]))
    )
    assert stored == 1
    response = await client.get(_url(alice, run["id"]), headers=alice.headers)
    assert response.status_code == 200
    body = response.json()
    assert (body["run_id"], body["created_at"]) == (run["id"], run["created_at"])
    document = body["document"]
    assert document["cycles"] == [["backend/app/api", "backend/app/services"]]
    assert {"backend/app/api", "frontend/src", "src"} <= {
        c["id"] for c in document["components"]
    }  # FILES adds src/
    assert set(document) == {
        "depth", "components", "edges", "cycles", "technologies", "data_stores", "routes",
        "entry_points", "infrastructure", "services", "observations", "truncated",
    }  # fmt: skip


@requires_db
async def test_runs_without_a_report_answer_404(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    await db_session.execute(
        delete(ArchitectureReport).where(ArchitectureReport.run_id == uuid.UUID(run["id"]))
    )
    response = await client.get(_url(alice, run["id"]), headers=alice.headers)
    assert (response.status_code, response.json()) == (
        404,
        {"detail": "This run has no architecture report"},
    )


@requires_db
async def test_other_users_and_repositories_cannot_read_architecture(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    url = _url(alice, run["id"])
    assert (await client.get(url)).status_code == 401
    as_bob = await client.get(url, headers=bob.headers)
    assert (as_bob.status_code, as_bob.json()) == (404, {"detail": "Repository not found"})
    via_bob = await client.get(_url(bob, run["id"]), headers=bob.headers)
    assert (via_bob.status_code, via_bob.json()) == (404, {"detail": "Analysis run not found"})
    other = await _new_repository(client, alice, "other")
    assert (
        await client.get(_url(alice, run["id"], other), headers=alice.headers)
    ).status_code == 404
    assert (await client.get("/api/v1/architecture", headers=bob.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_architecture_overview_lists_each_repositorys_latest_run(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    from sqlalchemy import update

    assert (await client.get("/api/v1/architecture", headers=alice.headers)).json() == {
        "repositories": []
    }
    first = await _analyzed_run(client, alice, monkeypatch, db_session, FILES)
    latest = await _analyzed_run(client, alice, monkeypatch, db_session)
    (entry,) = (await client.get("/api/v1/architecture", headers=alice.headers)).json()[
        "repositories"
    ]
    assert entry["run_id"] == latest["id"] != first["id"]
    assert entry["architecture"] == latest["architecture"]
    await db_session.execute(
        update(AnalysisRun)
        .where(AnalysisRun.id == uuid.UUID(latest["id"]))
        .values(architecture=None)
    )
    assert (await client.get("/api/v1/architecture", headers=alice.headers)).json() == {
        "repositories": []
    }


@requires_db
async def test_architecture_is_removed_with_its_repository(
    client: httpx.AsyncClient,
    alice: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed_run(client, alice, monkeypatch, db_session)
    count = (
        select(func.count())
        .select_from(ArchitectureReport)
        .where(ArchitectureReport.run_id == uuid.UUID(run["id"]))
    )
    assert await db_session.scalar(count) == 1
    await db_session.execute(
        delete(Repository).where(Repository.id == uuid.UUID(alice.repository_id))
    )
    assert await db_session.scalar(count) == 0
    assert (await client.get(_repo_url(alice), headers=alice.headers)).status_code == 404
