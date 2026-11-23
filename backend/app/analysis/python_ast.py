"""One syntax tree per Python file for a whole analysis pass.

A full analysis hands every file to each analyzer in turn, and five of them need the file's
syntax tree (code quality, complexity twice, architecture and the chat index). ``parse``
returns the same tree for the same text, so each file is parsed once instead of five times.

The tree is shared: callers only read it, never modify it. Errors are raised exactly as
``ast.parse`` raises them and are never cached, so every caller keeps its own handling.
"""

import ast
from functools import lru_cache

# The analyzers read one file after another, so the last few trees are all that is reused.
CACHED_TREES = 4


@lru_cache(maxsize=CACHED_TREES)
def parse(text: str) -> ast.Module:
    """``ast.parse(text)``, shared between the analyzers of a pass."""
    return ast.parse(text)  # a syntax tree only; nothing is compiled or run


def clear() -> None:
    """Drop the cached trees (called when a pass ends, so they are not kept in memory)."""
    parse.cache_clear()


_STATEMENT_LISTS = ("body", "orelse", "finalbody", "handlers", "cases")


def count_classes(tree: ast.Module) -> int:
    """The number of class definitions anywhere in the module, nested ones included.

    The same count as ``sum(isinstance(n, ast.ClassDef) for n in ast.walk(tree))``, without
    visiting every expression: a class definition is a statement, so it can only appear in a
    statement list (a body, an else or finally block, an except handler or a match case).
    """
    count = 0
    pending: list[ast.AST] = [tree]
    while pending:
        node = pending.pop()
        for field in _STATEMENT_LISTS:
            for child in getattr(node, field, None) or ():
                if isinstance(child, ast.ClassDef):
                    count += 1
                pending.append(child)
    return count
