"""The architecture analyzer: components and the imports between them, technologies, data
stores, API routes, entry points, infrastructure and observations. Everything reported has
evidence (a file and line); nothing is inferred from names of tools that are not in the code.

* **Components** are directories. The depth is the deepest one (at most 4) that gives at most
  MAX_COMPONENTS components, so a large repository is shown at a readable level.
* **Edges** are imports from a file of one component to a file of another, resolved to
  repository files: Python with the code explorer's module index, JavaScript/TypeScript by
  relative path (with the usual extensions, ``index`` files and the ``@/`` alias for src/).
* **Roles** of a component come from its files (tests, user interface, API routes, data
  access, authentication, workers, configuration); its *primary* role places it in the diagram.
* **Technologies** are known packages (catalog.py) declared in a manifest or imported.
* **Observations** are fixed rules over the facts, each listing its evidence.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from app.analysis.architecture.catalog import CATEGORY_ORDER, image_data_store, technology
from app.analysis.architecture.scanner import (
    EntryPoint,
    Evidence,
    FileFacts,
    InfrastructureFacts,
    Route,
    html_entry_point,
    package_json_entry_points,
    scan_infrastructure,
    scan_source,
)
from app.analysis.exclusions import excluded_directory
from app.analysis.summary import SnapshotFile, is_analyzable
from app.services.code_imports import ModuleIndex, _lookups
from app.services.code_metrics import count_lines

MAX_COMPONENTS = 40
MAX_DEPTH = 4
MAX_EDGES = 300
MAX_EXAMPLES = 3
MAX_ROUTES = 500
MAX_ENTRY_POINTS = 100
MAX_INFRASTRUCTURE = 200
MAX_EVIDENCE = 5
MAX_CYCLES = 10
ROOT = "(root)"
FRONTEND_BACKEND = "Frontend and backend in one repository"
ROLE_ORDER = ("ui", "api", "auth", "worker", "core", "data", "config", "test")
_JS_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte")
_SOURCE_LANGUAGES = frozenset({"Python", "JavaScript", "TypeScript", "TSX", "Vue", "Svelte"})


@dataclass
class ArchitectureResult:
    summary: dict[str, Any]
    document: dict[str, Any]


def _evidence(item: Evidence) -> dict[str, Any]:
    return {"path": item.path, "line": item.line, "detail": item.detail}


def component_key(path: str, depth: int) -> str:
    directories = PurePosixPath(path).parts[:-1]
    return "/".join(directories[:depth]) if directories else ROOT


def choose_depth(paths: list[str]) -> int:
    for depth in range(MAX_DEPTH, 0, -1):
        if len({component_key(p, depth) for p in paths}) <= MAX_COMPONENTS:
            return depth
    return 1


def primary_role(role_counts: Counter[str], files: int) -> str:
    """The role that places a component in the diagram."""
    if role_counts["test"] * 2 >= files:
        return "test"
    if role_counts["ui"] * 2 >= files:
        return "ui"
    for role in ("api", "data"):
        if role_counts[role]:
            return role
    for role in ("worker", "auth"):
        if role_counts[role] * 2 >= files:
            return role
    if role_counts["config"] * 2 >= files:
        return "config"
    return "core"


def _strongly_connected(nodes: list[str], edges: dict[str, set[str]]) -> list[list[str]]:
    """Tarjan's algorithm, iterative; components of more than one node, sorted."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    result: list[list[str]] = []
    counter = 0
    for start in nodes:
        if start in index:
            continue
        work = [(start, iter(sorted(edges.get(start, ()))))]
        index[start] = low[start] = counter
        counter += 1
        stack.append(start)
        on_stack.add(start)
        while work:
            node, children = work[-1]
            advanced = False
            for child in children:
                if child not in index:
                    index[child] = low[child] = counter
                    counter += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(sorted(edges.get(child, ())))))
                    advanced = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                group = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    group.append(member)
                    if member == node:
                        break
                if len(group) > 1:
                    result.append(sorted(group))
    return sorted(result)


class ArchitectureAnalyzer:
    def __init__(self) -> None:
        self.files: list[FileFacts] = []
        self.infrastructure = InfrastructureFacts()
        self.manifest_entry_points: list[EntryPoint] = []

    def add(self, file: SnapshotFile) -> None:
        if not is_analyzable(file) or file.text is None or excluded_directory(file.path):
            return
        name = PurePosixPath(file.path).name
        scan_infrastructure(file.path, file.text, self.infrastructure)
        if name == "package.json":
            self.manifest_entry_points.extend(package_json_entry_points(file.path, file.text))
        if (html := html_entry_point(file.path)) is not None:
            self.manifest_entry_points.append(html)
        if file.language in _SOURCE_LANGUAGES:
            lines, blank = count_lines(file.text)
            self.files.append(scan_source(file.path, file.language, file.text, lines - blank))

    # --- Import resolution ------------------------------------------------------------------

    def _resolve_edges(self) -> list[tuple[str, int, str]]:
        """(importer, line, imported file) for every import resolved to a repository file."""
        python = sorted(f.path for f in self.files if f.language == "Python")
        index = ModuleIndex.build(python)
        known = {f.path for f in self.files}
        found: list[tuple[str, int, str]] = []
        for facts in self.files:
            for node in facts.python_imports:
                names = [alias.name for alias in node.names]
                for matches in _lookups(node, facts.path, index, names):
                    target = _closest(facts.path, matches)
                    if target and target != facts.path:
                        found.append((facts.path, node.lineno, target))
            for line, specifier in facts.js_imports:
                target = _resolve_js(facts.path, specifier, known)
                if target and target != facts.path:
                    found.append((facts.path, line, target))
        return found

    # --- Result ---------------------------------------------------------------------------

    def result(self, declared: list[Any]) -> ArchitectureResult:
        """``declared``: the dependency analyzer's declarations (manifest evidence)."""
        paths = [f.path for f in self.files]
        depth = choose_depth(paths)
        key_of = {f.path: component_key(f.path, depth) for f in self.files}

        components: dict[str, dict[str, Any]] = {}
        role_counts: dict[str, Counter[str]] = defaultdict(Counter)
        role_evidence: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for facts in self.files:
            key = key_of[facts.path]
            entry = components.setdefault(
                key, {"id": key, "files": 0, "code_lines": 0, "languages": Counter()}
            )
            entry["files"] += 1
            entry["code_lines"] += facts.code_lines
            entry["languages"][facts.language or "Other"] += 1
            for role, evidence in facts.roles.items():
                role_counts[key][role] += 1
                if len(role_evidence[key][role]) < MAX_EVIDENCE:
                    role_evidence[key][role].append(_evidence(evidence))

        edge_counts: Counter[tuple[str, str]] = Counter()
        examples: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for importer, line, target in self._resolve_edges():
            pair = (key_of[importer], key_of[target])
            if pair[0] == pair[1]:
                continue
            edge_counts[pair] += 1
            if len(examples[pair]) < MAX_EXAMPLES:
                examples[pair].append(
                    {"path": importer, "line": line, "detail": f"imports {target}"}
                )
        ranked_edges = sorted(edge_counts.items(), key=lambda item: (-item[1], item[0]))
        edges = [
            {"source": s, "target": t, "imports": n, "examples": examples[(s, t)]}
            for (s, t), n in ranked_edges[:MAX_EDGES]
        ]
        incoming: Counter[str] = Counter(t for (_, t) in edge_counts)
        outgoing: Counter[str] = Counter(s for (s, _) in edge_counts)

        component_list = []
        for key in sorted(components):
            entry = components[key]
            roles = sorted(role_counts[key], key=ROLE_ORDER.index)
            component_list.append(
                {
                    "id": key,
                    "files": entry["files"],
                    "code_lines": entry["code_lines"],
                    "languages": [name for name, _ in entry["languages"].most_common(3)],
                    "role": primary_role(role_counts[key], entry["files"]),
                    "roles": roles,
                    "evidence": {role: role_evidence[key][role] for role in roles},
                    "depends_on": outgoing[key],
                    "used_by": incoming[key],
                }
            )

        graph: dict[str, set[str]] = defaultdict(set)
        for s, t in edge_counts:
            graph[s].add(t)
        cycles = _strongly_connected(sorted(components), graph)[:MAX_CYCLES]

        technologies = self._technologies(declared)
        data_stores = self._data_stores(technologies)
        routes = sorted(
            (r for f in self.files for r in f.routes),
            key=lambda r: (r.path, r.method, r.file, r.line),
        )
        entry_points = [e for f in self.files for e in f.entry_points] + self.manifest_entry_points
        entry_points.sort(key=lambda e: (e.path, e.line))
        infrastructure = sorted(self.infrastructure.items, key=lambda i: (i["path"], i["line"]))
        services = sorted(self.infrastructure.services, key=lambda s: (s.file, s.name))

        document: dict[str, Any] = {
            "depth": depth,
            "components": component_list,
            "edges": edges,
            "cycles": cycles,
            "technologies": technologies,
            "data_stores": data_stores,
            "routes": [_route(r) for r in routes[:MAX_ROUTES]],
            "entry_points": [_entry(e) for e in entry_points[:MAX_ENTRY_POINTS]],
            "infrastructure": infrastructure[:MAX_INFRASTRUCTURE],
            "services": [
                {
                    "name": s.name,
                    "file": s.file,
                    "image": s.image,
                    "build": s.build,
                    "ports": list(s.ports),
                    "depends_on": list(s.depends_on),
                    "data_store": image_data_store(s.image) if s.image else None,
                }
                for s in services
            ],  # fmt: skip
            "truncated": {
                "edges": len(edge_counts) > MAX_EDGES,
                "routes": len(routes) > MAX_ROUTES,
                "entry_points": len(entry_points) > MAX_ENTRY_POINTS,
                "infrastructure": len(infrastructure) > MAX_INFRASTRUCTURE,
            },
        }
        document["observations"] = self._observations(document)
        summary = {
            "source_files": len(self.files),
            "components": len(component_list),
            "edges": len(edge_counts),
            "imports": sum(edge_counts.values()),
            "routes": len(routes),
            "entry_points": len(entry_points),
            "technologies": [t["name"] for t in technologies],
            "data_stores": [d["name"] for d in data_stores],
            "infrastructure": len(infrastructure),
            "services": len(services),
            "cycles": len(cycles),
            "observations": len(document["observations"]),
            # Facts the health score checks (phase 7).
            "has_tests": any("test" in c["roles"] for c in component_list),
            "has_ci": any(item["kind"] == "ci" for item in infrastructure),
            "separated": {"api", "data"} <= {c["role"] for c in component_list}
            or any(o["title"] == FRONTEND_BACKEND for o in document["observations"]),
        }
        return ArchitectureResult(summary=summary, document=document)

    def _technologies(self, declared: list[Any]) -> list[dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}

        def note(ecosystem: str, package: str, evidence: Evidence) -> None:
            tech = technology(ecosystem, package)
            if tech is None:
                return
            entry = found.setdefault(
                tech.name,
                {
                    "name": tech.name,
                    "category": tech.category,
                    "ecosystem": ecosystem,
                    "evidence": [],
                },
            )
            if len(entry["evidence"]) < MAX_EVIDENCE and all(
                (e["path"], e["line"]) != (evidence.path, evidence.line) for e in entry["evidence"]
            ):
                entry["evidence"].append(_evidence(evidence))

        for record in declared:
            note(
                record.ecosystem,
                record.name,
                Evidence(
                    record.manifest,
                    record.line or 1,
                    f"Declares {record.name} {record.specifier}".strip(),
                ),
            )
        for facts in self.files:
            for (ecosystem, package), line in facts.packages.items():
                note(ecosystem, package, Evidence(facts.path, line, f"Imports {package}"))
        return sorted(
            found.values(), key=lambda t: (CATEGORY_ORDER.index(t["category"]), t["name"])
        )

    def _data_stores(self, technologies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        stores: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for tech in technologies:
            if tech["category"] == "database":
                stores[tech["name"]].extend(tech["evidence"])
        for service in self.infrastructure.services:
            name = image_data_store(service.image) if service.image else None
            if name and len(stores[name]) < MAX_EVIDENCE:
                stores[name].append(
                    {
                        "path": service.file,
                        "line": 1,
                        "detail": f"Compose service {service.name} ({service.image})",
                    }
                )
        return [
            {"name": name, "evidence": evidence[:MAX_EVIDENCE]}
            for name, evidence in sorted(stores.items())
        ]

    def _observations(self, document: dict[str, Any]) -> list[dict[str, Any]]:
        notes: list[dict[str, Any]] = []
        technologies = document["technologies"]

        def top_dirs(category: str) -> dict[str, dict[str, Any]]:
            dirs: dict[str, dict[str, Any]] = {}
            for tech in technologies:
                if tech["category"] == category:
                    for evidence in tech["evidence"]:
                        dirs.setdefault(
                            PurePosixPath(evidence["path"]).parts[0]
                            if "/" in evidence["path"]
                            else ROOT,
                            evidence,
                        )
            return dirs

        frontend, backend = top_dirs("frontend"), top_dirs("backend")
        if frontend and backend and set(frontend) != set(backend):
            notes.append({
                "title": FRONTEND_BACKEND,
                "detail": "A frontend framework and a backend framework are used in different top-level directories.",
                "evidence": [*list(frontend.values())[:2], *list(backend.values())[:2]],
            })  # fmt: skip
        layers = {c["role"] for c in document["components"]}
        if {"api", "data"} <= layers:
            api = [c["id"] for c in document["components"] if c["role"] == "api"]
            data = [c["id"] for c in document["components"] if c["role"] == "data"]
            notes.append({
                "title": "Layered structure",
                "detail": f"API components ({', '.join(api[:3])}) are separate from data-access components ({', '.join(data[:3])}).",
                "evidence": [e for c in document["components"] if c["role"] in ("api", "data") for e in c["evidence"].get(c["role"], [])[:1]][:4],
            })  # fmt: skip
        for cycle in document["cycles"]:
            pairs = [e for e in document["edges"] if e["source"] in cycle and e["target"] in cycle]
            notes.append({
                "title": "Circular dependency",
                "detail": f"{len(cycle)} components import each other in a cycle: {_listed(cycle)}.",
                "evidence": [x for e in pairs for x in e["examples"][:1]][:4],
            })  # fmt: skip
        used = sorted(document["components"], key=lambda c: (-c["used_by"], c["id"]))
        if used and used[0]["used_by"] >= 3:
            hub = used[0]
            notes.append({
                "title": "Most depended-on component",
                "detail": f"{hub['id']} is imported by {hub['used_by']} other components; changes to it affect them all.",
                "evidence": [x for e in document["edges"] if e["target"] == hub["id"] for x in e["examples"][:1]][:4],
            })  # fmt: skip
        containers = [
            i for i in document["infrastructure"] if i["kind"] in ("container image", "compose")
        ]
        if containers:
            services = document["services"]
            detail = (
                f"Runs in containers; Docker Compose defines {len(services)} service{'s' if len(services) != 1 else ''}."
                if services
                else "Runs in containers (Dockerfile)."
            )
            notes.append({"title": "Containerized", "detail": detail, "evidence": containers[:3]})
        ci = [i for i in document["infrastructure"] if i["kind"] == "ci"]
        if ci:
            notes.append(
                {
                    "title": "Continuous integration",
                    "detail": f"{len(ci)} CI configuration{'s' if len(ci) != 1 else ''} found.",
                    "evidence": ci[:3],
                }
            )
        tests = [c for c in document["components"] if "test" in c["roles"]]
        if not tests and document["components"]:
            notes.append(
                {
                    "title": "No automated tests found",
                    "detail": "No test files or test directories were found in the source code.",
                    "evidence": [],
                }
            )
        return notes


def _listed(names: list[str], limit: int = 5) -> str:
    shown = ", ".join(names[:limit])
    return f"{shown} and {len(names) - limit} more" if len(names) > limit else shown


def _route(route: Route) -> dict[str, Any]:
    return {
        "method": route.method,
        "path": route.path,
        "file": route.file,
        "line": route.line,
        "framework": route.framework,
    }


def _entry(entry: EntryPoint) -> dict[str, Any]:
    return {"kind": entry.kind, "path": entry.path, "line": entry.line, "detail": entry.detail}


def _closest(importer: str, matches: set[str]) -> str | None:
    """One file of several candidates: the one sharing the longest directory prefix."""
    if not matches:
        return None
    importer_parts = PurePosixPath(importer).parts

    def shared(path: str) -> int:
        count = 0
        for a, b in zip(importer_parts, PurePosixPath(path).parts):
            if a != b:
                break
            count += 1
        return count

    return max(sorted(matches), key=shared)


def _resolve_js(importer: str, specifier: str, known: set[str]) -> str | None:
    if specifier.startswith(("./", "../")):
        base = PurePosixPath(importer).parent
    elif specifier.startswith(("@/", "~/")):
        parts = PurePosixPath(importer).parts
        if "src" not in parts:
            return None
        root = parts[: len(parts) - 1 - parts[::-1].index("src")]
        base = PurePosixPath(*root, "src")
        specifier = specifier[2:]
    else:
        return None
    joined: list[str] = []
    for part in (base / specifier).parts:
        if part == "..":
            if not joined:
                return None  # above the repository root
            joined.pop()
        elif part != ".":
            joined.append(part)
    target = "/".join(joined)
    candidates = [
        target,
        *(target + ext for ext in _JS_EXTENSIONS),
        *(f"{target}/index{ext}" for ext in _JS_EXTENSIONS),
    ]
    if target.endswith((".js", ".jsx")):  # TypeScript sources imported with .js
        stem = target.rsplit(".", 1)[0]
        candidates += [stem + ".ts", stem + ".tsx"]
    return next((c for c in candidates if c in known), None)
