"""Severities, confidence levels, OWASP Top 10 (2021) categories and explanations for security
findings.

Confidence has a fixed meaning:

* ``confirmed`` - the insecure code or file is definitely present (an exact match: a private
  key header, a credential in a known format, ``eval`` called, TLS verification turned off,
  or a Bandit finding Bandit reports with HIGH confidence);
* ``potential`` - a pattern that is often a vulnerability but needs a person to review it
  (for example SQL text built from strings, or an HTML sink that may only get safe values).

Neither level claims that a finding is exploitable, and the absence of findings never means
that a project is secure.
"""

from dataclasses import dataclass
from typing import Literal

Severity = Literal["critical", "high", "medium", "low"]
Confidence = Literal["confirmed", "potential"]

SEVERITIES: tuple[Severity, ...] = ("critical", "high", "medium", "low")
CONFIDENCES: tuple[Confidence, ...] = ("confirmed", "potential")

OWASP: dict[str, str] = {
    "A01": "Broken Access Control",
    "A02": "Cryptographic Failures",
    "A03": "Injection",
    "A04": "Insecure Design",
    "A05": "Security Misconfiguration",
    "A06": "Vulnerable and Outdated Components",
    "A07": "Identification and Authentication Failures",
    "A08": "Software and Data Integrity Failures",
    "A09": "Security Logging and Monitoring Failures",
    "A10": "Server-Side Request Forgery",
}
OWASP_KEYS = tuple(OWASP)


@dataclass(frozen=True)
class SecurityRule:
    title: str
    severity: Severity
    confidence: Confidence
    owasp: str
    cwe: int | None
    explanation: str
    recommendation: str


# --- Bandit (Python) --------------------------------------------------------------------------

# Bandit tests that are not run: B101 flags every `assert`, which in test suites is noise.
BANDIT_SKIP = ("B101",)

# OWASP category of each Bandit test; Bandit supplies the CWE, severity and confidence.
BANDIT_OWASP: dict[str, str] = {
    "B102": "A03", "B103": "A01", "B104": "A05", "B105": "A07", "B106": "A07", "B107": "A07",
    "B108": "A01", "B110": "A09", "B112": "A09", "B113": "A05", "B201": "A05", "B202": "A01",
    "B301": "A08", "B302": "A08", "B303": "A02", "B304": "A02", "B305": "A02", "B306": "A01",
    "B307": "A03", "B308": "A03", "B310": "A10", "B311": "A02", "B312": "A02", "B313": "A05",
    "B314": "A05", "B315": "A05", "B316": "A05", "B317": "A05", "B318": "A05", "B319": "A05",
    "B320": "A05", "B321": "A02", "B323": "A02", "B324": "A02", "B401": "A02", "B402": "A02",
    "B403": "A08", "B404": "A03", "B405": "A05", "B406": "A05", "B407": "A05", "B408": "A05",
    "B409": "A05", "B410": "A05", "B411": "A05", "B412": "A05", "B413": "A06", "B415": "A02",
    "B501": "A02", "B502": "A02", "B503": "A02", "B504": "A02", "B505": "A02", "B506": "A08",
    "B507": "A07", "B508": "A02", "B509": "A02", "B601": "A03", "B602": "A03", "B603": "A03",
    "B604": "A03", "B605": "A03", "B606": "A03", "B607": "A03", "B608": "A03", "B609": "A03",
    "B610": "A03", "B611": "A03", "B612": "A05", "B613": "A08", "B614": "A08", "B615": "A08",
    "B701": "A03", "B702": "A03", "B703": "A03", "B704": "A03",
}  # fmt: skip
BANDIT_DEFAULT_OWASP = "A04"

# Readable titles for Bandit tests whose own names are unclear ("blacklist", "hashlib").
BANDIT_TITLES: dict[str, str] = {
    "B102": "exec() call",
    "B103": "Permissive file permissions",
    "B104": "Server bound to all interfaces",
    "B105": "Hard-coded password",
    "B106": "Hard-coded password argument",
    "B107": "Hard-coded password default",
    "B108": "Insecure temporary file",
    "B110": "Exception silently ignored",
    "B112": "Exception silently skipped",
    "B113": "HTTP request without timeout",
    "B201": "Flask debug mode",
    "B202": "Unsafe tar extraction",
    "B301": "Unsafe deserialization (pickle)",
    "B302": "Unsafe deserialization (marshal)",
    "B303": "Weak hash function",
    "B304": "Insecure cipher",
    "B305": "Insecure cipher mode",
    "B306": "Insecure temporary file name",
    "B307": "eval() call",
    "B308": "HTML marked safe",
    "B310": "URL opened without scheme check",
    "B311": "Insecure random numbers",
    "B312": "Telnet use",
    "B313": "Unsafe XML parsing",
    "B314": "Unsafe XML parsing",
    "B315": "Unsafe XML parsing",
    "B316": "Unsafe XML parsing",
    "B317": "Unsafe XML parsing",
    "B318": "Unsafe XML parsing",
    "B319": "Unsafe XML parsing",
    "B320": "Unsafe XML parsing",
    "B321": "FTP use",
    "B323": "Unverified TLS context",
    "B324": "Weak hash function",
    "B401": "telnetlib imported",
    "B402": "ftplib imported",
    "B403": "pickle imported",
    "B404": "subprocess imported",
    "B405": "Unsafe XML library imported",
    "B406": "Unsafe XML library imported",
    "B407": "Unsafe XML library imported",
    "B408": "Unsafe XML library imported",
    "B409": "Unsafe XML library imported",
    "B410": "Unsafe XML library imported",
    "B411": "Unsafe XML library imported",
    "B413": "Unmaintained crypto library (pycrypto)",
    "B501": "TLS certificate verification disabled",
    "B502": "Insecure TLS version",
    "B503": "Insecure TLS version default",
    "B504": "TLS version not set",
    "B505": "Weak cryptographic key",
    "B506": "Unsafe YAML load",
    "B507": "SSH host key not verified",
    "B601": "Shell command through Paramiko",
    "B602": "Shell command with shell=True",
    "B603": "Subprocess call (review its input)",
    "B604": "Shell command through a function call",
    "B605": "Process started with a shell",
    "B606": "Process started without a shell",
    "B607": "Process started with a partial path",
    "B608": "SQL built from strings",
    "B609": "Wildcard in a shell command",
    "B610": "Django extra() call",
    "B611": "Django RawSQL",
    "B701": "Jinja2 autoescape off",
    "B702": "Mako templates without escaping",
    "B703": "Django mark_safe",
    "B704": "markupsafe Markup",
}

# Bandit's message for these tests contains the hard-coded value itself; it is replaced.
BANDIT_REDACTED = {
    "B105": "Possible hard-coded password in a string (value not shown).",
    "B106": "Possible hard-coded password passed as an argument (value not shown).",
    "B107": "Possible hard-coded password as a default argument value (value not shown).",
}

BANDIT_EXPLANATION = (
    "Bandit, a security linter for Python, found code that commonly leads to a vulnerability "
    "in this category"  # the analyzer appends " (A03: Injection)."
)
BANDIT_RECOMMENDATIONS: dict[str, str] = {
    "A01": "Restrict file permissions and paths to what the program needs.",
    "A02": "Use current algorithms and keep certificate verification on (see the linked "
    "documentation for the safe alternative).",
    "A03": "Never build commands, queries or code from untrusted input; use parameterized "
    "APIs and argument lists instead.",
    "A05": "Use a safe configuration (no debug mode, no wildcard binding, timeouts set, "
    "hardened XML parsers such as defusedxml).",
    "A07": "Load credentials from the environment or a secrets manager, never from code.",
    "A08": "Do not deserialize untrusted data with pickle, marshal or yaml.load; use JSON or "
    "yaml.safe_load.",
    "A09": "Handle or log exceptions instead of silently ignoring them.",
    "A10": "Validate and restrict URLs before the server requests them.",
}
BANDIT_DEFAULT_RECOMMENDATION = "Follow the linked Bandit documentation for the safe alternative."


def bandit_owasp(test_id: str) -> str:
    return BANDIT_OWASP.get(test_id, BANDIT_DEFAULT_OWASP)


# --- CodeBase Analysis rules ------------------------------------------------------------------

_HARDCODED = (
    "A credential written in source code is readable by everyone with access to the "
    "repository, its history and every copy of it, and cannot be rotated without a code change."
)
_ROTATE = (
    "Revoke and rotate this credential now, remove it from the repository history, and load it "
    "from an environment variable or a secrets manager."
)

RULES: dict[str, SecurityRule] = {
    # Committed secrets (the secret-scan rules, reused).
    "private-key": SecurityRule(
        "Private key committed", "critical", "confirmed", "A02", 321,
        "A private key in the repository lets anyone who can read it impersonate the server or "
        "decrypt its traffic.",
        "Revoke the key, generate a new one, remove the file from the repository history and "
        "keep keys outside the code.",
    ),
    "aws-access-key-id": SecurityRule(
        "AWS access key committed", "critical", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "github-token": SecurityRule(
        "GitHub token committed", "critical", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "slack-token": SecurityRule(
        "Slack token committed", "critical", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "stripe-live-key": SecurityRule(
        "Stripe live secret key committed", "critical", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "anthropic-api-key": SecurityRule(
        "Anthropic API key committed", "critical", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "google-api-key": SecurityRule(
        "Google API key committed", "high", "confirmed", "A07", 798, _HARDCODED, _ROTATE
    ),
    "hardcoded-credential": SecurityRule(
        "Possible hard-coded credential", "high", "potential", "A07", 798,
        _HARDCODED + " The value looks like a real secret rather than a placeholder.",
        "If this is a real credential, rotate it and load it from the environment or a "
        "secrets manager.",
    ),
    # Data flow from request input (app.analysis.security.dataflow), Python and JavaScript.
    "path-traversal": SecurityRule(
        "Path built from request input", "high", "potential", "A01", 22,
        "A file path that includes request input can point outside the intended folder "
        "(../../etc/passwd), letting an attacker read or delete files (path traversal).",
        "Keep only the file name (secure_filename or os.path.basename; path.basename in Node), "
        "serve from a fixed folder (send_from_directory, res.sendFile with root), or look the "
        "file up by an id.",
    ),
    "ssrf": SecurityRule(
        "Outgoing request to a URL from request input", "high", "potential", "A10", 918,
        "When request input decides the address the server connects to, an attacker can make it "
        "reach internal services or cloud metadata (server-side request forgery).",
        "Allow only known hosts (an allow-list), never pass a URL from the request straight "
        "through, and block private and link-local addresses.",
    ),
    "open-redirect": SecurityRule(
        "Redirect to a URL from request input", "medium", "potential", "A01", 601,
        "Redirecting to an address taken from the request lets an attacker send users from a "
        "trusted link to a phishing site (open redirect).",
        "Redirect only to known paths (url_for, a fixed list) or to relative paths on this site.",
    ),
    "template-injection": SecurityRule(
        "Template built from request input", "high", "potential", "A03", 1336,
        "Rendering a template whose source includes request input lets an attacker run template "
        "code on the server (server-side template injection), and inject HTML.",
        "Keep templates fixed (render_template with a file) and pass request input as a variable.",
    ),
    "reflected-xss": SecurityRule(
        "Request input sent back unescaped", "medium", "potential", "A03", 79,
        "Sending request input back in the response renders it as HTML, so a crafted link can run "
        "script in the visitor's browser (reflected cross-site scripting).",
        "Return JSON (res.json), or escape the value before writing it into HTML.",
    ),
    # JavaScript / TypeScript.
    "js-eval": SecurityRule(
        "eval() call", "high", "confirmed", "A03", 95,
        "eval runs a string as code. If any part of the string comes from a user, an attacker "
        "can run arbitrary code.",
        "Remove eval; parse data with JSON.parse and use explicit logic instead of generated code.",
    ),
    "js-new-function": SecurityRule(
        "Function constructor", "high", "potential", "A03", 95,
        "new Function(...) compiles a string into code, like eval.",
        "Replace generated code with ordinary functions.",
    ),
    "js-child-process": SecurityRule(
        "Shell command built from strings", "high", "potential", "A03", 78,
        "A shell command assembled from strings can be changed by an attacker who controls part "
        "of it (command injection).",
        "Use execFile or spawn with an argument array, never a shell string with user input.",
    ),
    "js-sql-concat": SecurityRule(
        "SQL built from strings", "high", "potential", "A03", 89,
        "SQL text assembled with + or a template literal lets an attacker change the query "
        "when a value comes from user input (SQL injection).",
        "Use parameterized queries (placeholders such as ? or $1) and pass values separately.",
    ),
    "js-inner-html": SecurityRule(
        "Unsafe HTML sink", "medium", "potential", "A03", 79,
        "Assigning to innerHTML or outerHTML (or insertAdjacentHTML) renders markup; with "
        "user-controlled text this is cross-site scripting (XSS).",
        "Use textContent for text, or sanitize HTML with a vetted library such as DOMPurify.",
    ),
    "js-document-write": SecurityRule(
        "document.write()", "medium", "potential", "A03", 79,
        "document.write inserts raw markup into the page, a common cross-site scripting sink.",
        "Build elements with the DOM API and set textContent.",
    ),
    "react-dangerous-html": SecurityRule(
        "dangerouslySetInnerHTML", "medium", "potential", "A03", 79,
        "React escapes text by default; dangerouslySetInnerHTML bypasses that protection.",
        "Render text normally, or sanitize the HTML (for example with DOMPurify) first.",
    ),
    # Any language.
    "tls-verification-disabled": SecurityRule(
        "TLS certificate verification disabled", "high", "confirmed", "A02", 295,
        "With certificate verification off, anyone on the network path can intercept and "
        "change the traffic (man-in-the-middle).",
        "Keep verification on; if a private CA is used, configure its certificate instead.",
    ),
    "jwt-insecure": SecurityRule(
        "JWT signature not verified", "high", "confirmed", "A07", 347,
        "Accepting the 'none' algorithm or skipping signature verification lets anyone forge "
        "tokens and log in as any user.",
        "Always verify signatures with an explicit list of strong algorithms.",
    ),
    "cors-wildcard": SecurityRule(
        "CORS allows every origin", "medium", "potential", "A05", 942,
        "A wildcard CORS policy lets any website call this API from a visitor's browser.",
        "List the exact origins that need access.",
    ),
    "debug-enabled": SecurityRule(
        "Debug mode enabled in settings", "medium", "potential", "A05", 489,
        "Debug mode shows stack traces, settings and sometimes an interactive console to "
        "anyone who triggers an error.",
        "Turn debug off in production and read the setting from the environment.",
    ),
    "allowed-hosts-wildcard": SecurityRule(
        "Any host allowed", "medium", "potential", "A05", 16,
        "ALLOWED_HOSTS = ['*'] disables Django's protection against Host header attacks.",
        "List the domains the site is served from.",
    ),
    # Files.
    "env-file-committed": SecurityRule(
        "Environment file committed", "high", "confirmed", "A05", 538,
        "A .env file usually holds the real secrets of an environment (database passwords, API "
        "keys). Committed, they are visible to everyone with repository access.",
        "Remove the file from the repository and its history, rotate its secrets, add .env to "
        ".gitignore and commit a .env.example with placeholder values instead.",
    ),
    "docker-root-user": SecurityRule(
        "Container runs as root", "medium", "potential", "A05", 250,
        "Without a USER instruction (or with USER root) the container's processes run as root, "
        "so a compromised application gets full control of the container.",
        "Create an unprivileged user in the Dockerfile and switch to it with USER.",
    ),
    "docker-unpinned-image": SecurityRule(
        "Unpinned base image", "low", "potential", "A06", 1104,
        "A base image without a version tag (or with :latest) changes underneath the build, so "
        "builds are not reproducible and can pick up an untested or compromised image.",
        "Pin the base image to a specific version (or digest) and update it deliberately.",
    ),
    "docker-remote-add": SecurityRule(
        "Remote file added without verification", "low", "potential", "A08", 494,
        "ADD with a URL downloads a file at build time without checking its integrity.",
        "Download with curl or wget and verify a checksum, or COPY a vetted local file.",
    ),
}  # fmt: skip
