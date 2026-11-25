"""Pattern checks: line rules for JavaScript/TypeScript and settings, committed secrets, and
file checks for environment files and Dockerfiles.

Content is only matched against the fixed patterns below; it is never executed. Every
pattern is linear (bounded classes, no nested quantifiers) and only the first MAX_LINE_CHARS
characters of a line are examined. A finding never contains the matched text.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import PurePosixPath

# The committed-secret rules of the secret scan, reused unchanged.
from app.services.secret_scan import RULES as SECRET_RULES

MAX_LINE_CHARS = 4096

JS_LANGUAGES = frozenset({"JavaScript", "TypeScript", "TSX", "Vue", "Svelte"})
# Languages whose string assignments are checked for hard-coded credentials (Python is
# covered by Bandit's B105-B107).
CREDENTIAL_LANGUAGES = frozenset(
    {
        *JS_LANGUAGES, "Java", "Kotlin", "Go", "PHP", "Ruby", "C#", "Scala", "Rust", "Swift",
        "Dart", "Groovy", "YAML", "JSON", "TOML", "INI", "XML", "Shell", "PowerShell",
    }
)  # fmt: skip
SETTINGS_NAME = re.compile(r"(?:^|_)(?:settings|config|conf|production|prod)(?:_|\.py$)", re.I)

_COMMENT_PREFIXES = ("//", "#", "/*", "*", "<!--", "--")


@dataclass(frozen=True)
class Match:
    rule_id: str
    line: int
    message: str
    #: for data-flow findings, the value's path as (line, label) steps; empty otherwise
    flow: tuple[tuple[int, str], ...] = ()


@dataclass(frozen=True)
class _LineRule:
    rule_id: str
    pattern: re.Pattern[str]
    message: str
    languages: frozenset[str] | None  # None: every text file


def _r(pattern: str, flags: int = 0) -> re.Pattern[str]:
    return re.compile(pattern, flags)


# SQL statement shapes rather than bare keywords: a lone "Delete" or "DELETE" also starts UI
# text (`Delete ${name}`) and HTTP method strings (`DELETE ${url}`), which are not SQL. A WHERE
# comparison catches queries split across strings ("SELECT " + cols + " FROM t WHERE id = " + id).
_SQL_COLUMN = r"(?:\*|DISTINCT\b|[\w.\"]+|\$\{[^}]{0,100}\})"
_SQL_KEYWORDS = (
    r"(?:SELECT\s+" + _SQL_COLUMN + r"(?:\s*,\s*" + _SQL_COLUMN + r")*\s+FROM\b"
    r"|INSERT\s+INTO\b|UPDATE\s+\S+\s+SET\b|DELETE\s+FROM\b"
    r"|WHERE\s+[\w.\"]+\s*(?:=|<>|!=|<|>|LIKE\b|IN\b))"
)
LINE_RULES: tuple[_LineRule, ...] = (
    _LineRule(
        "js-eval", _r(r"(?<![\w.$])eval\s*\("), "eval() runs a string as code.", JS_LANGUAGES
    ),
    _LineRule(
        "js-new-function",
        _r(r"\bnew\s+Function\s*\("),
        "new Function() compiles a string into code.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "js-child-process",
        _r(r"\b(?:exec|execSync)\s*\(\s*(?:`[^`]{0,500}\$\{|['\"][^'\"]{0,500}['\"]\s*\+)"),
        "A shell command is built from strings.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "js-sql-concat",
        _r(
            # A template literal with ${...}, or a quoted string followed by "+". Each quote
            # style is matched on its own, so the SQL may contain the other quote, as in
            # "... WHERE name = '" + value + "'".
            r"(?:`[^`]{0,500}\b" + _SQL_KEYWORDS + r"[^`]{0,500}\$\{"
            r"|\"[^\"]{0,500}\b" + _SQL_KEYWORDS + r"[^\"]{0,500}\"\s*\+"
            r"|'[^']{0,500}\b" + _SQL_KEYWORDS + r"[^']{0,500}'\s*\+)",
            re.I,
        ),
        "SQL text is built with string concatenation or a template literal.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "js-inner-html",
        _r(r"\.(?:innerHTML|outerHTML)\s*(?:\+)?=(?!=)|\binsertAdjacentHTML\s*\("),
        "HTML is inserted into the page from a string.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "js-document-write",
        _r(r"\bdocument\.write(?:ln)?\s*\("),
        "document.write() inserts raw markup.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "react-dangerous-html",
        _r(r"\bdangerouslySetInnerHTML\b"),
        "dangerouslySetInnerHTML bypasses React's escaping.",
        JS_LANGUAGES,
    ),
    _LineRule(
        "tls-verification-disabled",
        _r(r"\brejectUnauthorized\s*:\s*false\b|\bNODE_TLS_REJECT_UNAUTHORIZED\b\W{0,6}0\b"),
        "TLS certificate verification is turned off.",
        None,
    ),
    _LineRule(
        "jwt-insecure",
        _r(
            r"\balgorithms?['\"]?\s*[:=]\s*\[?\s*['\"]none['\"]"
            r"|['\"]verify_signature['\"]\s*:\s*False\b"
            r"|\bignoreExpiration\s*:\s*true\b",
            re.I,
        ),
        "JWT signatures or expiry are not checked.",
        None,
    ),
    _LineRule(
        "cors-wildcard",
        _r(
            r"Access-Control-Allow-Origin['\"]?\s*[,:]\s*['\"]\*['\"]"
            r"|\borigin\s*:\s*['\"]\*['\"]"
            r"|\bCORS_(?:ORIGIN_)?ALLOW_ALL(?:_ORIGINS)?\s*=\s*True\b"
            r"|\ballow_origins\s*=\s*\[\s*['\"]\*['\"]"
        ),
        "Cross-origin requests are allowed from every origin.",
        None,
    ),
)

_SETTINGS_RULES: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("debug-enabled", _r(r"^DEBUG\s*=\s*True\b"), "DEBUG is set to True."),
    (
        "allowed-hosts-wildcard",
        _r(r"^ALLOWED_HOSTS\s*=\s*[\[(]\s*['\"]\*['\"]"),
        "ALLOWED_HOSTS allows every host.",
    ),
)

# The credential word may end a longer name, DB_PASSWORD, payment-api-secret or
# myDbPassword (snake, kebab or camel case), but not start one (passwordHint, SECRET_NAME).
_CREDENTIAL = _r(
    r"\b(?:[A-Za-z0-9]+[_-]|[A-Za-z][a-z0-9]*(?=[A-Z]))*"
    r"(?i:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token"
    r"|client[_-]?secret|private[_-]?key)\b['\"]?\s*[:=]\s*['\"]([^'\"\s]{8,200})['\"]",
)
_PLACEHOLDER_WORDS = (
    "example", "changeme", "change_me", "change-me", "your", "xxx", "placeholder", "dummy",
    "sample", "test", "fake", "redacted", "secret", "password", "todo",
)  # fmt: skip
_PLACEHOLDER_CHARS = ("<", ">", "${", "{{", "%(", "***", "process.env", "os.environ")


def _placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(word in lowered for word in _PLACEHOLDER_WORDS) or any(
        mark in value for mark in _PLACEHOLDER_CHARS
    )


def _is_comment(line: str) -> bool:
    return line.lstrip().startswith(_COMMENT_PREFIXES)


def scan_lines(path: str, language: str | None, text: str) -> Iterator[Match]:
    """Line findings of one file, in line order; each rule at most once per line."""
    settings = language == "Python" and SETTINGS_NAME.search(PurePosixPath(path).name)
    credentials = language in CREDENTIAL_LANGUAGES
    for number, raw in enumerate(text.split("\n"), start=1):
        line = raw.removesuffix("\r")[:MAX_LINE_CHARS]
        # Secrets leak from comments too, so they are checked on every line.
        for secret in SECRET_RULES:
            if secret.pattern.search(line):
                yield Match(secret.id, number, f"{secret.description} found (value not shown).")
        if _is_comment(line):
            continue
        for rule in LINE_RULES:
            if (rule.languages is None or language in rule.languages) and rule.pattern.search(line):
                yield Match(rule.rule_id, number, rule.message)
        if settings:
            for rule_id, pattern, message in _SETTINGS_RULES:
                if pattern.search(line):
                    yield Match(rule_id, number, message)
        if credentials:
            found = _CREDENTIAL.search(line)
            if found and not _placeholder(found.group(1)):
                yield Match(
                    "hardcoded-credential",
                    number,
                    "A credential-like name is assigned a literal value (value not shown).",
                )


# --- File checks ----------------------------------------------------------------------------

_ENV_TEMPLATES = (".example", ".sample", ".template", ".dist", ".defaults")
_ENV_ASSIGNMENT = _r(r"^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S")


def is_env_file(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    if name != ".env" and not name.startswith(".env."):
        return False
    return not name.endswith(_ENV_TEMPLATES)


def scan_env_file(text: str) -> Match | None:
    count = sum(1 for line in text.splitlines() if _ENV_ASSIGNMENT.match(line[:MAX_LINE_CHARS]))
    if count == 0:
        return None
    noun = "variable" if count == 1 else "variables"
    return Match("env-file-committed", 1, f"The file sets {count} {noun} (values not shown).")


_FROM = _r(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", re.I)
_USER = _r(r"^\s*USER\s+(\S+)", re.I)
_ADD_URL = _r(r"^\s*ADD\s+(?:--\S+\s+)*https?://", re.I)
_STAGE = _r(r"\bAS\s+(\S+)\s*$", re.I)


def is_dockerfile(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    return name == "dockerfile" or name.startswith("dockerfile.") or name.endswith(".dockerfile")


def scan_dockerfile(text: str) -> list[Match]:
    found: list[Match] = []
    stages: set[str] = set()
    user: str | None = None
    last_from = 0  # the final stage's FROM line
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw[:MAX_LINE_CHARS]
        image = _FROM.match(line)
        if image:
            last_from = number
            user = None  # every stage starts as root
            reference = image.group(1)
            stage = _STAGE.search(line)
            if reference.lower() not in stages and reference != "scratch" and "$" not in reference:
                name = reference.split("@", 1)[0]
                tag = name.rsplit("/", 1)[-1].partition(":")[2]
                if "@" not in reference and tag in ("", "latest"):
                    found.append(
                        Match(
                            "docker-unpinned-image",
                            number,
                            f"Base image {name} has no pinned version.",
                        )
                    )
            if stage:
                stages.add(stage.group(1).lower())
            continue
        named = _USER.match(line)
        if named:
            user = named.group(1).split(":", 1)[0]
        if _ADD_URL.match(line):
            found.append(Match("docker-remote-add", number, "ADD downloads a remote URL."))
    if last_from and user in (None, "root", "0"):
        found.append(
            Match(
                "docker-root-user",
                last_from,
                "The final stage has no USER instruction for an unprivileged user.",
            )
        )
    return sorted(found, key=lambda match: match.line)
