# Security

How CodeBase Analysis protects accounts, repositories and the server. A summary is in the [README](../README.md#security).

- **Passwords**: hashed with Argon2 (argon2-cffi). The rules follow NIST SP 800-63B:
  - 8 to 128 characters (anything longer is refused without being hashed);
  - not a commonly used password, not too simple, and not the account's email.
- **Authentication**: JWT bearer tokens (PyJWT).
  - Signed with `SECRET_KEY` using HS256 by default.
  - The `sub` and `exp` claims are required, and tokens last 60 minutes by default.
  - Every missing or invalid token gets the same 401 response.
- **Session**: the frontend keeps the token in `sessionStorage`, so the session ends when the
  tab closes. The token is attached only to the app's own `/api/v1` requests, and any 401
  clears it.
- **Password reset** (optional, off unless SMTP is configured):
  - The reset link carries a signed token in the URL fragment, so it never reaches server logs.
    The page removes it from the address bar as soon as it is read.
  - Reset tokens use a key derived from `SECRET_KEY` that is separate from sign-in tokens, so
    neither kind can stand in for the other. They expire after 30 minutes by default.
  - Each token is bound to a fingerprint of the current password hash, so it works once and
    stops working when the password changes.
  - Requests get the same answer whether or not the account exists, and the email is sent
    after the response. Requests are limited per IP and per email, confirmations per IP.
  - Emails go out over SMTP (for example Gmail with an app password) or, when
    `BREVO_API_KEY` is set, through Brevo's HTTPS API, which works on hosts that block SMTP.
  - Without either, reset requests answer 503 "Password reset by email is not available".
- **Ownership**: every endpoint that addresses a project or repository checks ownership first.
  Another user's project or repository answers 404 ("Project not found", "Repository not
  found"), exactly like a missing one.
- **Rate limiting**: fixed windows in Redis, updated by atomic Lua scripts. Keys store SHA-256
  digests, never raw user ids, emails or IPs.
  - Search, per-file analyses, secret scans and explanations have per-user limits.
  - Login is limited per IP and per email, registration per IP. The per-IP limits are
    adjustable (`LOGIN_IP_LIMIT`, `REGISTER_IP_LIMIT`) for classrooms that share one address.
  - Limited requests receive 429 with `Retry-After`.
  - If Redis is unavailable, requests proceed without limits.
- **Verified file reads**: every read checks that the path stays inside the repository
  directory, refuses links and junctions, bounds the size, and compares the SHA-256 recorded at
  ingestion. A mismatch answers 409 "Repository changed during analysis; run it again".
- **Archive safety**: every entry is checked before anything is written.
  - Rejected: absolute, drive, UNC or `..` paths; symbolic links; encrypted or unsupported
    entries; and duplicate or case-colliding paths.
  - Limited: entry count, total and per-file size, and compression ratio (zip bombs).
  - Extraction re-checks the actual sizes and destinations.
- **GitHub downloads**:
  - Only `https://github.com/<owner>/<repository>` is accepted, and the download URL is built
    on the server.
  - Redirects are followed only to GitHub hosts, and every resolved address must be public.
  - The download is size-limited, with no git and no credentials.
- **No repository code execution**: nothing is run, imported or compiled to bytecode.
  Dependency manifests are parsed, never installed.
- **Plain-text rendering**: repository content and every server-provided string are rendered
  as text, never as HTML. External URLs are shown as text, not links.
- **Production exposure**:
  - `/docs`, `/redoc` and `/openapi.json` are disabled when `ENVIRONMENT=production`.
  - CORS accepts exact origins only.
  - `SECRET_KEY` must be at least 32 characters, and the placeholder value is rejected in
    production.
  - Caddy sends these headers:
    - a strict Content-Security-Policy (scripts only from the site itself);
    - HSTS, Permissions-Policy, Cross-Origin-Opener-Policy, `X-Frame-Options: DENY` and
      `nosniff`.
  - Caddy also enforces these limits:
    - request bodies are capped at 2 MB, except repository uploads;
    - hidden paths such as `/.env` or `/.git` get a plain 404.
  - Both production images run as an unprivileged user, never as root.
- **Dependency monitoring**:
  - Dependabot proposes minor and patch updates every week.
  - A GitHub Actions audit checks every pinned package against the public vulnerability
    databases, on each push and every week.
- **AI boundary**: explanations and the chat are off unless `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` is set.
  - Only the requested, verified file (at most 64 KiB) is sent, always to
    `https://api.anthropic.com` or `https://generativelanguage.googleapis.com`.
  - The Gemini key travels only in a request header, never in the URL, and redirects are
    not followed.
  - The prompt is fixed on the server and the model gets no tools.
  - Nothing is stored or logged.
