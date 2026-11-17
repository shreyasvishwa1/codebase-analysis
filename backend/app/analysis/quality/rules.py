"""Categories, severities, explanations and suggested corrections for code-quality findings.

Every finding is classified by a documented table instead of a guess: the most specific rule
code wins (``F821`` before ``F8`` before ``F``), so each Ruff rule maps to one category and
severity. Suggestions come from the tool when it offers a fix, otherwise from this table.
"""

from dataclasses import dataclass
from typing import Literal

Severity = Literal["high", "medium", "low", "info"]
Category = Literal[
    "syntax_error",
    "bug_risk",
    "unused_code",
    "dead_code",
    "duplication",
    "naming",
    "documentation",
    "formatting",
    "maintainability",
]

SEVERITIES: tuple[Severity, ...] = ("high", "medium", "low", "info")
CATEGORIES: tuple[Category, ...] = (
    "syntax_error",
    "bug_risk",
    "unused_code",
    "dead_code",
    "duplication",
    "naming",
    "documentation",
    "formatting",
    "maintainability",
)

# Ruff rule groups enabled for repository analysis. Syntax errors are always reported.
RUFF_SELECT = ("E", "W", "F", "N", "D1", "B", "SIM", "C4", "PIE", "RET", "UP", "PLE", "PLW")
# Too noisy for whole-repository reports: D105/D107 (magic methods and __init__ docstrings).
RUFF_IGNORE = ("D105", "D107")


@dataclass(frozen=True)
class RuleInfo:
    category: Category
    severity: Severity
    explanation: str
    suggestion: str


_GENERIC = RuleInfo(
    "maintainability",
    "low",
    "The code does something in a way that is harder to read or maintain than necessary.",
    "Follow the linked rule documentation to rewrite this code.",
)

# Most specific prefix first is not required: lookup tries the full code, then shorter prefixes.
RULES: dict[str, RuleInfo] = {
    "E9": RuleInfo(
        "syntax_error",
        "high",
        "The file cannot be parsed, so it cannot run and no other analysis is possible for it.",
        "Fix the syntax at this line (an unclosed bracket, a missing colon or bad indentation).",
    ),
    "F821": RuleInfo(
        "bug_risk",
        "high",
        "A name is used that is never defined in scope, which raises NameError when this line runs.",
        "Define or import the name, or correct its spelling.",
    ),
    "F811": RuleInfo(
        "bug_risk",
        "medium",
        "A function, class or import is defined again before the first definition is used, so "
        "the first one is silently replaced.",
        "Remove or rename one of the definitions.",
    ),
    "F63": RuleInfo(
        "bug_risk",
        "high",
        "A comparison or assertion that is always true or always false, which is almost always a bug.",
        "Check the comparison: use == for values, `is` only for None, True and False.",
    ),
    "F7": RuleInfo(
        "bug_risk",
        "high",
        "A statement is used where Python does not allow it (for example `return` outside a function).",
        "Move the statement into a valid context or remove it.",
    ),
    "F401": RuleInfo(
        "unused_code",
        "low",
        "An import is never used. It slows loading and hides which dependencies the module really needs.",
        "Remove the unused import.",
    ),
    "F841": RuleInfo(
        "unused_code",
        "low",
        "A local variable is assigned but never read, which often signals a forgotten step or a typo.",
        "Use the variable or remove the assignment.",
    ),
    "F": RuleInfo(
        "bug_risk",
        "medium",
        "Pyflakes found a likely logical error in this code.",
        "Correct the code as the message describes.",
    ),
    "PLE": RuleInfo(
        "bug_risk",
        "high",
        "Pylint found an error that will fail at runtime.",
        "Correct the code as the message describes.",
    ),
    "PLW": RuleInfo(
        "bug_risk",
        "medium",
        "Pylint found a pattern that usually indicates a bug.",
        "Review this code and correct it as the message describes.",
    ),
    "B006": RuleInfo(
        "bug_risk",
        "high",
        "A mutable default argument (list, dict or set) is shared between calls, so changes leak "
        "from one call into the next.",
        "Use None as the default and create the object inside the function.",
    ),
    "B": RuleInfo(
        "bug_risk",
        "medium",
        "flake8-bugbear found a construct that is likely to cause a bug.",
        "Rewrite the code as the message describes.",
    ),
    "E722": RuleInfo(
        "bug_risk",
        "medium",
        "A bare `except:` also catches KeyboardInterrupt and SystemExit and hides real errors.",
        "Catch specific exceptions, or at least `except Exception:`.",
    ),
    "E501": RuleInfo(
        "formatting",
        "info",
        "The line is longer than 100 characters, which makes code harder to read and review.",
        "Break the line or simplify the expression.",
    ),
    "E": RuleInfo(
        "formatting",
        "info",
        "The code does not follow the PEP 8 layout conventions.",
        "Reformat the line (a formatter such as `ruff format` or Black does this automatically).",
    ),
    "W": RuleInfo(
        "formatting",
        "info",
        "Whitespace that does not follow PEP 8 (trailing spaces or missing final newline).",
        "Remove the extra whitespace or add the final newline.",
    ),
    "N": RuleInfo(
        "naming",
        "low",
        "The name does not follow PEP 8 naming conventions, which makes the code harder to read.",
        "Use snake_case for functions and variables, CapWords for classes, UPPER_CASE for constants.",
    ),
    "D1": RuleInfo(
        "documentation",
        "info",
        "A public module, class or function has no docstring, so its purpose is undocumented.",
        "Add a short docstring that says what it does, its parameters and its return value.",
    ),
    "RET503": RuleInfo(
        "bug_risk",
        "low",
        "Some paths of the function return a value and others fall off the end and return None.",
        "Add an explicit `return` (or `return None`) at the end of the function.",
    ),
    "RET": RuleInfo(
        "maintainability",
        "low",
        "The return statements can be written more simply.",
        "Simplify the returns as the message describes.",
    ),
    "SIM": RuleInfo(
        "maintainability",
        "low",
        "This code can be written more simply.",
        "Apply the simplification the message describes.",
    ),
    "C4": RuleInfo(
        "maintainability",
        "low",
        "A comprehension or collection call can be written more directly.",
        "Rewrite it as the message describes.",
    ),
    "PIE": RuleInfo(
        "maintainability",
        "low",
        "The code contains an unnecessary statement or construct.",
        "Remove or simplify it as the message describes.",
    ),
    "UP": RuleInfo(
        "maintainability",
        "info",
        "The code uses syntax that newer Python versions can express more simply.",
        "Update the syntax as the message describes.",
    ),
}

# Findings produced by CodeBase Analysis itself (not by Ruff).
OWN_RULES: dict[str, RuleInfo] = {
    "unreachable-code": RuleInfo(
        "dead_code",
        "medium",
        "These statements come after a return, raise, break or continue (or an endless loop), "
        "so they can never run. Dead code misleads readers and often hides a logic error.",
        "Remove the unreachable statements, or move them before the statement that leaves.",
    ),
    "duplicate-code": RuleInfo(
        "duplication",
        "medium",
        "The same block of code appears in more than one place. A fix applied to one copy is "
        "easily forgotten in the others.",
        "Extract the shared code into one function or module and call it from both places.",
    ),
    "todo-marker": RuleInfo(
        "maintainability",
        "info",
        "A TODO, FIXME, HACK or XXX comment marks unfinished or known-problematic code.",
        "Resolve the comment, or track it in an issue tracker and remove the marker.",
    ),
    "long-file": RuleInfo(
        "maintainability",
        "low",
        "The file is very long (1,000 lines or more), which makes it hard to navigate, test and review.",
        "Split the file into smaller modules by responsibility.",
    ),
}


def ruff_rule(code: str | None) -> RuleInfo:
    """Classification of a Ruff rule code; a missing code means a syntax error."""
    if not code:
        return RULES["E9"]
    for length in range(len(code), 0, -1):
        info = RULES.get(code[:length])
        if info is not None:
            return info
    return _GENERIC
