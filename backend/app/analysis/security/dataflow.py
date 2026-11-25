"""Data flow from request input to dangerous calls (taint tracking), for Python and JavaScript.

The line rules see one line at a time. These checks follow a value from where a web request
brings it in to a call that uses it as a file path, a URL, a redirect target, a template or a
response body:

* path traversal (CWE-22): ``open``, ``send_file``, ``os.remove`` ...; ``res.sendFile``, ``fs.*``;
* server-side request forgery (CWE-918): ``requests.get``, ``httpx``, ``urlopen``; ``axios``,
  ``fetch``, ``http.get``;
* open redirect (CWE-601): ``redirect``, ``HttpResponseRedirect``; ``res.redirect``, and in the
  browser ``window.location = ...`` from the page's own address;
* template injection (CWE-1336): ``render_template_string`` and ``Environment.from_string``;
* reflected cross-site scripting (CWE-79) in Express: request input sent back with ``res.send``.

Sources are Flask's and Django's ``request.args``, ``.form``, ``.json``, ``.GET``, ``.POST`` ...
and Express's ``req.query``, ``req.params``, ``req.body``, ``req.headers``, ``req.cookies``. A
value stays tainted through assignment, string building (``+``, ``%``, f-strings, template
literals, ``format``, ``join``) and calls that receive it, and is cleared by a known sanitizer
(``secure_filename``, ``os.path.basename``, ``int``, ``url_for``, ``safe_join``; ``path.basename``)
or by reassigning the variable. ``send_from_directory`` is safe by design and is no sink.

Limits, stated rather than guessed: Python is followed within one function and JavaScript
within one file; values passed into other functions, stored in attributes or containers, or
read back from a database are not followed; FastAPI's typed parameters are not sources; a
JavaScript call is read on its own line. Findings are "potential": a person confirms them.

Each finding carries its path: where the input came in, each variable it passed through and
the call it reached, as (line, label) steps, for example ``(4, "request.args")``,
``(4, "name")``, ``(7, "open()")``. Labels are names from the code, never values.
"""

import ast
import re
from collections.abc import Iterable, Iterator

from app.analysis.security.patterns import Match

Step = tuple[int, str]
"""One step of a value's path: the line, and the source, variable or call there."""
Flow = tuple[Step, ...]

#: A path keeps its first step (where the input came in) and the latest ones.
MAX_STEPS = 8


def _extend(flow: Flow, step: Step) -> Flow:
    longer = (*flow, step)
    return longer if len(longer) <= MAX_STEPS else (longer[0], *longer[-(MAX_STEPS - 1) :])

# --- Python -------------------------------------------------------------------------------------

_REQUEST_NAMES = frozenset({"request"})
_SOURCE_ATTRIBUTES = frozenset(
    {
        "args", "form", "values", "json", "files", "cookies", "headers", "data",  # Flask
        "GET", "POST", "FILES", "COOKIES", "META", "body",  # Django
        "get_json", "get_data",  # Flask methods
    }
)  # fmt: skip
_SANITIZERS = frozenset(
    {"secure_filename", "basename", "safe_join", "url_for", "int", "float", "bool", "len", "escape"}
)
_PATH_SINKS = frozenset(
    {
        "open", "io.open", "send_file", "flask.send_file", "FileResponse",
        "os.remove", "os.unlink", "os.rmdir", "os.listdir",
        "shutil.rmtree", "shutil.copy", "shutil.copyfile", "shutil.move",
    }
)  # fmt: skip
_HTTP_LIBRARIES = ("requests", "httpx")
_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options", "request", "stream"})
_URLOPEN = frozenset({"urlopen", "urllib.request.urlopen"})
_REDIRECTS = frozenset(
    {
        "redirect", "flask.redirect", "django.shortcuts.redirect", "HttpResponseRedirect",
        "HttpResponsePermanentRedirect", "RedirectResponse",
    }
)  # fmt: skip
_TEMPLATES = frozenset({"render_template_string", "flask.render_template_string"})

_MESSAGES = {
    "path-traversal": "Request input reaches {sink}() as a file path without being sanitized.",
    "ssrf": "Request input decides the address {sink}() connects to.",
    "open-redirect": "Request input decides where {sink}() redirects to.",
    "template-injection": "Request input becomes part of the template that {sink}() renders.",
    "reflected-xss": "Request input is sent back in the response by {sink}() without escaping.",
}


def _dotted(node: ast.expr) -> str | None:
    """``requests.get`` for ``requests.get``, ``open`` for ``open``; None for other shapes."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _final_name(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _is_source(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr in _SOURCE_ATTRIBUTES
        and isinstance(node.value, ast.Name)
        and node.value.id in _REQUEST_NAMES
    )


def _origin(node: ast.expr | None, names: dict[str, Flow]) -> Flow | None:
    """The path by which the value of ``node`` carries request input, or None if it cannot.

    ``names`` maps each tainted variable to the path that brought input into it."""
    if node is None:
        return None
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.Attribute):
        if _is_source(node):
            return ((node.lineno, f"request.{node.attr}"),)
        return _origin(node.value, names)
    if isinstance(node, ast.Subscript):
        return _origin(node.value, names)
    if isinstance(node, ast.Call):
        if _final_name(node.func) in _SANITIZERS:
            return None
        if _is_source(node.func):  # request.get_json()
            return ((node.lineno, f"request.{node.func.attr}()"),)  # type: ignore[attr-defined]
        if isinstance(node.func, ast.Attribute):
            found = _origin(node.func.value, names)  # a method of a tainted value: t.strip()
            if found is not None:
                return found
        return _first([*node.args, *(k.value for k in node.keywords)], names)
    if isinstance(node, ast.BinOp):
        return _first([node.left, node.right], names)
    if isinstance(node, ast.JoinedStr):
        return _first(node.values, names)
    if isinstance(node, (ast.FormattedValue, ast.Starred, ast.Await, ast.NamedExpr)):
        return _origin(node.value, names)
    if isinstance(node, ast.BoolOp):
        return _first(node.values, names)
    if isinstance(node, ast.IfExp):
        return _first([node.body, node.orelse], names)
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return _first(node.elts, names)
    if isinstance(node, ast.Dict):
        return _first([v for v in node.values if v is not None], names)
    return None  # constants, comparisons, lambdas ...


def _first(nodes: Iterable[ast.expr], names: dict[str, Flow]) -> Flow | None:
    return next((flow for flow in (_origin(n, names) for n in nodes) if flow is not None), None)


def _argument(call: ast.Call, position: int, keywords: Iterable[str]) -> ast.expr | None:
    if len(call.args) > position:
        return call.args[position]
    wanted = set(keywords)
    return next((k.value for k in call.keywords if k.arg in wanted), None)


def _sink(call: ast.Call) -> tuple[str, str, ast.expr | None] | None:
    """(rule, sink name, the argument that matters) when ``call`` is a sink."""
    name = _dotted(call.func)
    if name is None:
        return None
    if name in _PATH_SINKS:
        return "path-traversal", name, _argument(call, 0, ("file", "path", "filename", "path_or_file"))
    library, _, method = name.rpartition(".")
    if library in _HTTP_LIBRARIES and method in _HTTP_METHODS:
        position = 1 if method == "request" else 0
        return "ssrf", name, _argument(call, position, ("url",))
    if name in _URLOPEN:
        return "ssrf", name, _argument(call, 0, ("url",))
    if name in _REDIRECTS or name.endswith(".redirect") and name.split(".")[0] in ("flask", "django"):
        return "open-redirect", name, _argument(call, 0, ("location", "url", "to"))
    if name in _TEMPLATES or name.endswith(".from_string"):
        return "template-injection", name, _argument(call, 0, ("source",))
    return None


def _calls(node: ast.AST) -> Iterator[ast.Call]:
    """Calls within one statement, not inside nested functions, classes or lambdas."""
    pending = list(ast.iter_child_nodes(node))
    while pending:
        child = pending.pop()
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        if isinstance(child, ast.Call):
            yield child
        pending.extend(ast.iter_child_nodes(child))


def _targets(node: ast.expr) -> Iterator[str]:
    if isinstance(node, ast.Name):
        yield node.id
    elif isinstance(node, (ast.Tuple, ast.List)):
        for element in node.elts:
            yield from _targets(element)
    elif isinstance(node, ast.Starred):
        yield from _targets(node.value)


_BLOCKS = ("body", "orelse", "finalbody", "handlers", "cases")


def _bind(names: dict[str, Flow], name: str, flow: Flow | None, line: int) -> None:
    """``name`` now holds the value: tainted with ``flow`` plus this step, or clean."""
    if flow is None:
        names.pop(name, None)
    else:
        names[name] = _extend(flow, (line, name))


def _walk_function(statements: list[ast.stmt], names: dict[str, Flow], found: dict[tuple[str, int], Match]) -> None:
    for statement in statements:
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue  # analyzed on its own
        compound = any(getattr(statement, block, None) for block in _BLOCKS)
        # The statement's own expressions (a compound statement's header only).
        header = (
            [getattr(statement, f) for f in ("test", "iter", "subject") if getattr(statement, f, None) is not None]
            + [item.context_expr for item in getattr(statement, "items", [])]
            if compound
            else [statement]
        )
        for part in header:
            for call in _calls(part) if not isinstance(part, ast.Call) else [part, *_calls(part)]:
                sink = _sink(call)
                flow = _origin(sink[2], names) if sink is not None else None
                if sink is not None and flow is not None:
                    rule, name, _ = sink
                    step = (call.lineno, f"{name}()")
                    message = _MESSAGES[rule].format(sink=name)
                    found.setdefault((rule, call.lineno), Match(rule, call.lineno, message, _extend(flow, step)))
        # How the statement changes which variables are tainted.
        line = statement.lineno
        if isinstance(statement, ast.Assign):
            flow = _origin(statement.value, names)
            for target in statement.targets:
                for name in _targets(target):
                    _bind(names, name, flow, line)
        elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
            flow = _origin(statement.value, names)
            for name in _targets(statement.target):
                _bind(names, name, flow, line)
        elif isinstance(statement, ast.AugAssign):
            flow = _origin(statement.value, names)
            if flow is not None:
                for name in _targets(statement.target):
                    _bind(names, name, flow, line)
        elif isinstance(statement, (ast.For, ast.AsyncFor)):
            flow = _origin(statement.iter, names)
            if flow is not None:
                for name in _targets(statement.target):
                    _bind(names, name, flow, line)
        for node in ast.walk(statement):  # walrus assignments anywhere in the statement
            if isinstance(node, ast.NamedExpr):
                flow = _origin(node.value, names)
                if flow is not None:
                    _bind(names, node.target.id, flow, node.lineno)
        for block in _BLOCKS:
            for child in getattr(statement, block, None) or []:
                inner = child.body if isinstance(child, (ast.ExceptHandler, ast.match_case)) else [child]
                _walk_function(inner, names, found)


def scan_python(tree: ast.Module) -> list[Match]:
    """Data-flow findings of one parsed Python module, in line order."""
    found: dict[tuple[str, int], Match] = {}
    _walk_function(tree.body, {}, found)  # module-level code
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            _walk_function(node.body, {}, found)
    return sorted(found.values(), key=lambda m: (m.line, m.rule_id))


# --- JavaScript and TypeScript ------------------------------------------------------------------

_JS_SOURCE = re.compile(r"\breq(?:uest)?\.(?:query|params|body|headers|cookies)\b")
_JS_DECLARATION = re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(.+?)\s*=\s*(.+)$")
_JS_ASSIGNMENT = re.compile(r"^\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+)$")
_JS_BROWSER_SOURCE = re.compile(r"\b(?:window\.)?location\.(?:hash|search)\b|\bdocument\.(?:URL|referrer)\b")
_JS_PATH_SINK = re.compile(
    r"\b(?:res\.(?:sendFile|download)|fs\.(?:readFile|readFileSync|createReadStream|writeFile"
    r"|writeFileSync|unlink|unlinkSync|readdir|readdirSync))\s*\("
)
_JS_SSRF_SINK = re.compile(
    r"\b(?:axios(?:\.(?:get|post|put|patch|delete|head|request))?|fetch|got|needle"
    r"|https?\.(?:get|request))\s*\("
)
_JS_REDIRECT_SINK = re.compile(r"\bres\.redirect\s*\(")
_JS_RESPONSE_SINK = re.compile(r"\bres\.(?:send|write|end)\s*\(")
_JS_LOCATION_SINK = re.compile(
    r"\b(?:window\.)?location(?:\.href)?\s*=(?!=)\s*(.+)|\b(?:window\.)?location\.(?:assign|replace)\s*\("
)
_JS_PATH_SANITIZER = re.compile(r"\bpath\.basename\s*\(")
_JS_HTML_SANITIZER = re.compile(r"\b(?:escapeHtml|escape|encodeURIComponent|DOMPurify\.sanitize)\s*\(")


def _declared_names(left: str) -> list[str]:
    """The variables a declaration binds: ``a``, or each name of ``{ a, b: c, ...rest }``."""
    left = left.strip()
    if left[:1] in "{[":
        names = []
        for part in left.strip("{}[] ").split(","):
            part = part.split("=", 1)[0].strip()
            part = part.split(":", 1)[-1].strip().lstrip(".")
            if re.fullmatch(r"[A-Za-z_$][\w$]*", part):
                names.append(part)
        return names
    name = left.split(":", 1)[0].strip()  # TypeScript annotations
    return [name] if re.fullmatch(r"[A-Za-z_$][\w$]*", name) else []


def _call_arguments(line: str, start: int) -> str:
    """The text between the call's parentheses, from the opening one at ``start - 1``."""
    depth, end = 1, start
    while end < len(line) and depth:
        depth += {"(": 1, ")": -1}.get(line[end], 0)
        end += 1
    return line[start : end - 1]


def _mention(text: str, names: dict[str, Flow]) -> Flow | None:
    """The path of the first tainted variable ``text`` uses (not a property of that name)."""
    for name, flow in names.items():
        if re.search(rf"(?<![\w$.]){re.escape(name)}\b", text):
            return flow
    return None


def _without(pattern: re.Pattern[str], text: str) -> str:
    """``text`` with every call matching ``pattern`` (and its arguments) removed."""
    while match := pattern.search(text):
        text = text[: match.start()] + text[match.end() + len(_call_arguments(text, match.end())) + 1 :]
    return text


def scan_javascript(text: str) -> list[Match]:
    """Data-flow findings of one JavaScript or TypeScript file, in line order."""
    tainted: dict[str, Flow] = {}  # server-side request input
    browser: dict[str, Flow] = {}  # values read from the page's address (new URLSearchParams(location.search) too)
    found: dict[tuple[str, int], Match] = {}

    def origin(value: str, number: int, source: re.Pattern[str], names: dict[str, Flow]) -> Flow | None:
        direct = source.search(value)
        if direct:
            return ((number, direct.group(0)),)
        return _mention(value, names)

    def report(rule: str, number: int, sink: str, flow: Flow) -> None:
        message = _MESSAGES[rule].format(sink=sink)
        found.setdefault((rule, number), Match(rule, number, message, _extend(flow, (number, f"{sink}()"))))

    for number, raw in enumerate(text.split("\n"), start=1):
        line = raw.rstrip("\r")
        stripped = line.strip()
        if stripped.startswith(("//", "*", "/*")):
            continue
        for sink, rule, sanitizer in (
            (_JS_PATH_SINK, "path-traversal", _JS_PATH_SANITIZER),
            (_JS_SSRF_SINK, "ssrf", None),
            (_JS_REDIRECT_SINK, "open-redirect", None),
            (_JS_RESPONSE_SINK, "reflected-xss", _JS_HTML_SANITIZER),
        ):
            for match in sink.finditer(line):
                arguments = _call_arguments(line, match.end())
                if sanitizer is not None:
                    arguments = _without(sanitizer, arguments)
                flow = origin(arguments, number, _JS_SOURCE, tainted)
                if flow is not None:
                    report(rule, number, match.group(0).rstrip("( "), flow)
        location = _JS_LOCATION_SINK.search(line)
        if location:
            target = location.group(1) if location.group(1) else _call_arguments(line, location.end())
            flow = origin(target, number, _JS_BROWSER_SOURCE, browser)
            if flow is not None:
                report("open-redirect", number, "window.location", flow)
        # Which variables now carry input.
        declaration = _JS_DECLARATION.match(line)
        assignment = None if declaration else _JS_ASSIGNMENT.match(line)
        if declaration or assignment:
            bound = _declared_names(declaration.group(1)) if declaration else [assignment.group(1)]  # type: ignore[union-attr]
            value = (declaration or assignment).group(2)  # type: ignore[union-attr]
            flows = {
                "server": origin(value, number, _JS_SOURCE, tainted),
                "browser": origin(value, number, _JS_BROWSER_SOURCE, browser),
            }
            for name in bound:
                for kind, flow in ((tainted, flows["server"]), (browser, flows["browser"])):
                    _bind(kind, name, flow, number)
    return sorted(found.values(), key=lambda m: (m.line, m.rule_id))
