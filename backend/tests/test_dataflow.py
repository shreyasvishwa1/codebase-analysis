"""Data flow from request input to dangerous calls (app.analysis.security.dataflow)."""

import ast
import textwrap
from pathlib import Path

import pytest

from app.analysis.security import dataflow
from app.analysis.security.analyzer import SecurityAnalyzer
from app.analysis.security.rules import RULES
from app.analysis.summary import SnapshotFile


def py(source: str) -> list[tuple[str, int]]:
    tree = ast.parse(textwrap.dedent(source))
    return [(m.rule_id, m.line) for m in dataflow.scan_python(tree)]


def js(source: str) -> list[tuple[str, int]]:
    return [(m.rule_id, m.line) for m in dataflow.scan_javascript(textwrap.dedent(source))]


# --- Python: each sink -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "rule"),
    [
        ("return open(request.args['name']).read()", "path-traversal"),
        ("return send_file(os.path.join(ROOT, request.args.get('name')))", "path-traversal"),
        ("os.remove(f\"{ROOT}/{request.form['file']}\")", "path-traversal"),
        ("shutil.rmtree(ROOT + request.GET['folder'])", "path-traversal"),
        ("return FileResponse(request.GET['path'])", "path-traversal"),
        ("return requests.get(request.args['url'], timeout=5).text", "ssrf"),
        ("return httpx.post(url=request.json['callback'])", "ssrf"),
        ("return requests.request('GET', request.args['url'])", "ssrf"),
        ("return urllib.request.urlopen(request.values['feed'])", "ssrf"),
        ("return redirect(request.args.get('next'))", "open-redirect"),
        ("return HttpResponseRedirect(request.GET['to'])", "open-redirect"),
        ("return render_template_string('<p>' + request.args['name'] + '</p>')", "template-injection"),
        ("return env.from_string(request.get_data(as_text=True)).render()", "template-injection"),
    ],
)
def test_request_input_reaching_a_sink_is_reported(body: str, rule: str) -> None:
    assert py(f"def view():\n    {body}\n") == [(rule, 2)]


@pytest.mark.parametrize(
    "body",
    [
        "return send_from_directory(ROOT, request.args['name'])",  # safe by design
        "return open(os.path.join(ROOT, secure_filename(request.args['name'])))",
        "return send_file(os.path.join(ROOT, os.path.basename(request.args['name'])))",
        "return open(ROOT + str(int(request.args['id'])) + '.txt')",
        "return redirect(url_for('home'))",
        "return requests.get('https://api.example.com/rates', timeout=5).json()",
        "return render_template('hello.html', name=request.args['name'])",
        "return open(CONFIG_PATH).read()",
        "return requests.get(SETTINGS['url'], params={'q': request.args['q']}).json()",  # only a parameter
    ],
)
def test_safe_look_alikes_are_not_reported(body: str) -> None:
    assert py(f"def view():\n    {body}\n") == []


# --- Python: how values flow -----------------------------------------------------------------------


def test_input_flows_through_assignments_strings_and_calls() -> None:
    assert py(
        """
        def download():
            name = request.args.get("name", "").strip()
            folder = "/srv/" + name
            target = os.path.join(folder, "file.txt")
            with open(target) as handle:
                return handle.read()
        """
    ) == [("path-traversal", 6)]


def test_reassigning_or_sanitizing_a_variable_clears_it() -> None:
    assert py(
        """
        def download():
            name = request.args["name"]
            name = secure_filename(name)
            open(name)
            url = request.args["url"]
            url = "https://api.example.com"
            requests.get(url, timeout=5)
        """
    ) == []


def test_input_flows_through_loops_tuples_augmented_and_walrus_assignments() -> None:
    assert py(
        """
        def bulk():
            for name in request.json["files"]:
                os.remove(name)
            first, second = request.args["a"], "b"
            open(first)
            path = "/srv/"
            path += request.args["tail"]
            open(path)
            if (url := request.args.get("url")):
                requests.get(url, timeout=5)
        """
    ) == [("path-traversal", 4), ("path-traversal", 6), ("path-traversal", 9), ("ssrf", 11)]


def test_branches_handlers_and_match_cases_are_followed() -> None:
    assert py(
        """
        def view(kind):
            target = request.args["next"]
            if kind:
                return redirect(target)
            try:
                return open(target)
            except OSError:
                return requests.get(target, timeout=5)
            match kind:
                case "a":
                    return render_template_string(target)
        """
    ) == [("open-redirect", 5), ("path-traversal", 7), ("ssrf", 9), ("template-injection", 12)]


def test_each_function_is_followed_on_its_own() -> None:
    # A value passed into another function is not followed (a stated limit), and a name tainted
    # in one function is not tainted in another.
    assert py(
        """
        def read(path):
            return open(path).read()

        def view():
            name = request.args["name"]
            return read(name)

        def other():
            return open(name).read()

        async def fetch():
            url = request.args["url"]
            return await client_get(httpx.get(url))
        """
    ) == [("ssrf", 14)]


def test_module_level_code_and_nested_functions_are_followed() -> None:
    assert py(
        """
        target = request.args["next"]
        redirect(target)

        def outer():
            def inner():
                return open(request.form["path"])
            return inner
        """
    ) == [("open-redirect", 3), ("path-traversal", 7)]


def test_a_nested_function_has_its_own_variables() -> None:
    # The helper's parameter shares a name with the view's tainted variable but is its own.
    assert py(
        """
        def view():
            name = request.args["name"]
            def helper(name):
                return open(name)
            reader = lambda name: open(name)
            return helper(CONFIG), reader(CONFIG)
        """
    ) == []


def test_one_finding_per_rule_and_line() -> None:
    assert py("def view():\n    open(request.args['a'] + request.args['b'])\n") == [("path-traversal", 2)]


def test_a_request_object_under_another_name_is_not_a_source() -> None:
    # FastAPI's typed parameters and other objects are not followed (a stated limit).
    assert py("def view(name: str, req=None):\n    return open(name), open(req.args['x'])\n") == []


# --- JavaScript --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("line", "rule"),
    [
        ("res.sendFile(path.join(ROOT, req.query.name));", "path-traversal"),
        ("fs.readFile(ROOT + '/' + req.params.file, 'utf8', done);", "path-traversal"),
        ("fs.createReadStream(`${ROOT}/${req.body.path}`).pipe(res);", "path-traversal"),
        ("const page = await axios.get(req.query.url);", "ssrf"),
        ("fetch(req.body.callback, { method: 'POST' });", "ssrf"),
        ("https.get(req.query.feed, onResponse);", "ssrf"),
        ("res.redirect(req.query.next);", "open-redirect"),
        ("res.send('<h1>Hello ' + req.query.name + '</h1>');", "reflected-xss"),
        ("res.write(`<p>${req.params.id}</p>`);", "reflected-xss"),
    ],
)
def test_express_request_input_reaching_a_sink_is_reported(line: str, rule: str) -> None:
    assert js(f"app.get('/x', async (req, res) => {{\n  {line}\n}});\n") == [(rule, 2)]


@pytest.mark.parametrize(
    "line",
    [
        "res.sendFile(path.basename(req.query.name), { root: ROOT });",
        "res.json({ name: req.query.name });",
        "res.send(escapeHtml(req.query.name));",
        "res.redirect('/');",
        "axios.get('https://api.example.com/rates');",
        "db.query('SELECT 1 FROM t WHERE id = ?', [req.params.id]);",
        "// res.redirect(req.query.next) in a comment",
        "res.send(stdout);",
    ],
)
def test_express_safe_look_alikes_are_not_reported(line: str) -> None:
    assert js(f"app.get('/x', (req, res) => {{\n  {line}\n}});\n") == []


def test_express_input_flows_through_declarations_and_destructuring() -> None:
    assert js(
        """
        app.get('/files', (req, res) => {
          const { name, folder: dir } = req.query;
          const full = path.join(ROOT, dir, name);
          res.sendFile(full);
          let target = req.body.url;
          target = 'https://api.example.com';
          axios.get(target);
          const response = await axios.get(req.query.url);
          res.send(response.data);
        });
        """
    ) == [("path-traversal", 5), ("ssrf", 9), ("reflected-xss", 10)]


def test_a_property_with_a_tainted_variables_name_is_not_tainted() -> None:
    assert js(
        """
        app.get('/u', (req, res) => {
          const name = req.query.name;
          const user = loadUser();
          res.send(user.name);
        });
        """
    ) == []


def test_browser_redirects_from_the_page_address_are_reported() -> None:
    assert js(
        """
        const params = new URLSearchParams(window.location.search);
        function next() {
          window.location.href = params.get('next');
        }
        function hash() {
          const target = location.hash.slice(1);
          location.assign(target);
        }
        function home() {
          window.location.href = '/';
          window.location = HOME;
        }
        """
    ) == [("open-redirect", 4), ("open-redirect", 8)]


# --- In the analyzer --------------------------------------------------------------------------------


def _analyze(tmp_path: Path, path: str, language: str, text: str) -> list[tuple[str, str, int, int | None]]:
    analyzer = SecurityAnalyzer(tmp_path)
    analyzer.add(SnapshotFile(path=path, language=language, size_bytes=len(text), status="text", text=text))
    return [(f.rule_id, f.tool, f.line, f.cwe) for f in analyzer.result().findings if f.tool != "bandit"]


def test_the_analyzer_reports_data_flow_findings_for_python_and_javascript(tmp_path: Path) -> None:
    python = "from flask import request, redirect\n\ndef go():\n    return redirect(request.args['next'])\n"
    javascript = "app.get('/f', (req, res) => {\n  res.sendFile(req.query.name);\n});\n"
    assert ("open-redirect", "codebase-analysis", 4, 601) in _analyze(tmp_path / "a", "web/app.py", "Python", python)
    assert _analyze(tmp_path / "b", "web/server.js", "JavaScript", javascript) == [
        ("path-traversal", "codebase-analysis", 2, 22)
    ]


def test_unparsable_python_is_left_to_bandit_and_ruff(tmp_path: Path) -> None:
    assert [r for r in _analyze(tmp_path, "broken.py", "Python", "def (:\n") if r[0] in dataflow._MESSAGES] == []


def test_each_data_flow_rule_has_its_weakness_and_category() -> None:
    expected = {
        "path-traversal": (22, "A01", "high"),
        "ssrf": (918, "A10", "high"),
        "open-redirect": (601, "A01", "medium"),
        "template-injection": (1336, "A03", "high"),
        "reflected-xss": (79, "A03", "medium"),
    }
    assert set(dataflow._MESSAGES) == set(expected)
    for rule_id, (cwe, owasp, severity) in expected.items():
        rule = RULES[rule_id]
        assert (rule.cwe, rule.owasp, rule.severity, rule.confidence) == (cwe, owasp, severity, "potential")


# --- Paths -------------------------------------------------------------------------------------------


def py_flows(source: str) -> list[tuple[str, tuple[tuple[int, str], ...]]]:
    tree = ast.parse(textwrap.dedent(source))
    return [(m.rule_id, m.flow) for m in dataflow.scan_python(tree)]


def js_flows(source: str) -> list[tuple[str, tuple[tuple[int, str], ...]]]:
    return [(m.rule_id, m.flow) for m in dataflow.scan_javascript(textwrap.dedent(source))]


def test_a_python_finding_records_the_path_from_the_source_to_the_call() -> None:
    assert py_flows(
        """
        def download():
            name = request.args.get("name", "").strip()
            folder = "/srv/" + name
            for part in folder.split("/"):
                target = os.path.join(folder, part)
            return send_file(target)
        """
    ) == [
        (
            "path-traversal",
            ((3, "request.args"), (3, "name"), (4, "folder"), (6, "target"), (7, "send_file()")),
        )
    ]


def test_a_direct_source_reassignments_loops_augmented_and_walrus_steps() -> None:
    assert py_flows(
        """
        def view():
            redirect(request.form["next"])
            url = request.json["a"]
            url = request.values["b"]
            requests.get(url, timeout=5)
            path = "/srv/"
            path += request.cookies["c"]
            open(path)
            for item in request.files:
                os.remove(item)
            if (body := request.get_data()):
                render_template_string(body)
            result = process(
                (page := request.args["p"]),
            )
            open(page)
        """
    ) == [
        ("open-redirect", ((3, "request.form"), (3, "redirect()"))),
        ("ssrf", ((5, "request.values"), (5, "url"), (6, "requests.get()"))),
        ("path-traversal", ((8, "request.cookies"), (8, "path"), (9, "open()"))),
        ("path-traversal", ((10, "request.files"), (10, "item"), (11, "os.remove()"))),
        ("template-injection", ((12, "request.get_data()"), (12, "body"), (13, "render_template_string()"))),
        ("path-traversal", ((15, "request.args"), (15, "page"), (17, "open()"))),  # the walrus's own line
    ]


def test_the_first_tainted_part_of_an_expression_is_followed() -> None:
    assert py_flows(
        """
        def view():
            a = request.args["a"]
            b = request.form["b"]
            open(CONFIG + b + a)
            open(f"{ROOT}/{a}")
            open(a if FLAG else b)
            open({"k": b}["k"])
            open(b or a)
            open(*[a])
            open(clean(x=b))
            t: str = a
            open(t)
        """
    ) == [
        ("path-traversal", ((4, "request.form"), (4, "b"), (5, "open()"))),
        ("path-traversal", ((3, "request.args"), (3, "a"), (6, "open()"))),
        ("path-traversal", ((3, "request.args"), (3, "a"), (7, "open()"))),
        ("path-traversal", ((4, "request.form"), (4, "b"), (8, "open()"))),
        ("path-traversal", ((4, "request.form"), (4, "b"), (9, "open()"))),
        ("path-traversal", ((3, "request.args"), (3, "a"), (10, "open()"))),
        ("path-traversal", ((4, "request.form"), (4, "b"), (11, "open()"))),
        ("path-traversal", ((3, "request.args"), (3, "a"), (12, "t"), (13, "open()"))),
    ]


def test_a_long_path_keeps_its_source_and_its_latest_steps() -> None:
    names = [f"v{i}" for i in range(12)]
    lines = ["def view():", "    v0 = request.args['x']"]
    lines += [f"    {names[i]} = {names[i - 1]}" for i in range(1, 12)]
    lines.append("    open(v11)")
    [(rule, flow)] = py_flows("\n".join(lines) + "\n")
    assert len(flow) == dataflow.MAX_STEPS
    assert flow[0] == (2, "request.args")
    assert flow[1:] == ((8, "v6"), (9, "v7"), (10, "v8"), (11, "v9"), (12, "v10"), (13, "v11"), (14, "open()"))


def test_a_javascript_finding_records_its_path() -> None:
    assert js_flows(
        """
        app.get('/f', (req, res) => {
          const { name } = req.query;
          let full = path.join(ROOT, name);
          res.sendFile(full);
          res.redirect(req.body.next);
        });
        const target = location.hash.slice(1);
        location.assign(target);
        """
    ) == [
        ("path-traversal", ((3, "req.query"), (3, "name"), (4, "full"), (5, "res.sendFile()"))),
        ("open-redirect", ((6, "req.body"), (6, "res.redirect()"))),
        ("open-redirect", ((8, "location.hash"), (8, "target"), (9, "window.location()"))),
    ]


def test_line_rule_matches_have_no_path(tmp_path: Path) -> None:
    analyzer = SecurityAnalyzer(tmp_path)
    text = "app.get('/f', (req, res) => {\n  res.sendFile(req.query.name);\n  eval(code);\n});\n"
    analyzer.add(SnapshotFile(path="s.js", language="JavaScript", size_bytes=len(text), status="text", text=text))
    flows = {f.rule_id: f.flow for f in analyzer.result().findings}
    assert flows["path-traversal"] == ((2, "req.query"), (2, "res.sendFile()"))
    assert all(flow is None for rule, flow in flows.items() if rule != "path-traversal")
