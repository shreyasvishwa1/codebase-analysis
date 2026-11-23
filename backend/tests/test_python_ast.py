"""The shared syntax tree of an analysis pass, the statement-only class count and Radon's
maintainability index from the shared tree: each gives exactly what it replaced."""

import ast
from pathlib import Path
from unittest import mock

import pytest
from radon.metrics import mi_visit

from app.analysis import python_ast, runner
from app.analysis.complexity import measure

BACKEND = Path(__file__).resolve().parents[1]
PYTHON_FILES = sorted(p for p in BACKEND.rglob("*.py") if ".venv" not in p.parts)

NESTED = '''
class Top:
    class Inner:
        pass

def outer():
    class InFunction:
        pass
    if True:
        class InIf: ...
    else:
        class InElse: ...
    for _ in range(1):
        class InFor: ...
    else:
        class InForElse: ...
    while False:
        class InWhile: ...
    try:
        class InTry: ...
    except Exception:
        class InHandler: ...
    else:
        class InTryElse: ...
    finally:
        class InFinally: ...
    with open("x") as f:
        class InWith: ...
    match f:
        case 1:
            class InCase: ...

async def coroutine():
    async with lock:
        class InAsyncWith: ...
    async for item in items:
        class InAsyncFor: ...

try:
    pass
except* ValueError:
    class InExceptStar: ...

value = lambda: [x for x in "class Fake: pass"]  # not a class
'''


def _walk_count(tree: ast.AST) -> int:
    return sum(isinstance(node, ast.ClassDef) for node in ast.walk(tree))


def test_the_class_count_matches_a_full_walk_on_every_nesting() -> None:
    tree = ast.parse(NESTED)
    assert python_ast.count_classes(tree) == _walk_count(tree) == 17


@pytest.mark.parametrize("path", PYTHON_FILES, ids=lambda p: p.relative_to(BACKEND).as_posix())
def test_the_class_count_matches_a_full_walk_on_real_files(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assert python_ast.count_classes(tree) == _walk_count(tree)


def test_the_same_text_is_parsed_once_and_the_tree_equals_ast_parse() -> None:
    python_ast.clear()
    text = "def f(x):\n    return x + 1\n"
    with mock.patch.object(python_ast.ast, "parse", wraps=ast.parse) as parse:
        first = python_ast.parse(text)
        second = python_ast.parse(text)
    assert first is second
    assert parse.call_count == 1
    assert ast.dump(first, include_attributes=True) == ast.dump(ast.parse(text), include_attributes=True)


def test_errors_are_raised_as_by_ast_parse_and_never_cached() -> None:
    python_ast.clear()
    with mock.patch.object(python_ast.ast, "parse", wraps=ast.parse) as parse:
        for _ in range(2):
            with pytest.raises(SyntaxError):
                python_ast.parse("def broken(:\n")
    assert parse.call_count == 2
    with pytest.raises(Exception) as expected:
        ast.parse("x = 1\x00")  # null bytes
    with pytest.raises(type(expected.value)):
        python_ast.parse("x = 1\x00")


def test_only_the_last_few_trees_are_kept_and_a_pass_clears_them() -> None:
    python_ast.clear()
    for number in range(python_ast.CACHED_TREES + 3):
        python_ast.parse(f"x = {number}\n")
    assert python_ast.parse.cache_info().currsize == python_ast.CACHED_TREES
    runner.analyze_snapshot(Path("."), [])
    assert python_ast.parse.cache_info().currsize == 0


@pytest.mark.parametrize("path", PYTHON_FILES, ids=lambda p: p.relative_to(BACKEND).as_posix())
def test_the_maintainability_index_equals_radons_own(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    try:  # the replaced code: Radon's mi_visit, failures giving no value
        expected = round(max(0.0, float(mi_visit(text, multi=True))), 1)
    except (SyntaxError, ValueError, RecursionError, MemoryError, TypeError):
        expected = None
    assert measure._python_mi(text) == expected


def test_python_classes_and_index_return_none_for_unparsable_code() -> None:
    assert measure._python_classes("class (:\n") is None
    assert measure._python_mi("class (:\n") is None
