# Architecture: AI-Based Software Repository Intelligence and Code Analysis System

CodeBase Analysis analyzes software repositories (a ZIP upload or a public GitHub archive):
- code quality, security, complexity, dependencies and architecture;
- an overall Code Health Score;
- answers to questions about the code through an AI chat grounded in the repository.

This document is the design reference for the system and its development phases.

## 1. Principles

- **Real analysis, never guesses.** Findings come from established tools (Ruff, Bandit, Radon,
  OSV.dev) and from deterministic analyzers built on Python's `ast` and `tokenize`. The AI
  only explains and summarizes findings that the analyzers produced, or code it was given.
- **Repository code is untrusted data.** Nothing from a repository is executed, imported or
  installed. Tools run as separate processes on stored copies, with time limits. Text inside
  repositories, such as comments that look like instructions, is never treated as an
  instruction.
- **Evidence everywhere.** Every finding carries its file, line, tool and rule. The
  architecture view shows only components it can point to in the code. The chat cites the
  passages it retrieved, or says it has no evidence.
- **History is preserved.** Each analysis run is stored with its results, keyed by file path.
  Re-ingesting a repository never rewrites earlier runs.

## 2. System overview

```
Browser (React + TypeScript + Tailwind + Recharts)
   │  /api/v1 (JSON, bearer token)
   ▼
FastAPI (uvicorn)  ── auth, ownership, rate limits, validation
   ├──► PostgreSQL 16: users, projects, repositories, files, jobs,
   │       analysis runs and results, code chunks, chat, reports
   ├──► Redis 7: arq job queue, rate-limit counters
   │       └──► arq worker: ingestion, full analysis (all analyzers), maintenance
   ├──► Repository storage (DATA_DIR): verified, read-only copies of ingested files
   └──► External services (optional, all server-side):
            OSV.dev (vulnerabilities), PyPI / npm registries (latest versions),
            Gemini or Anthropic (chat, explanations), Brevo or SMTP (email)
```

## 3. Analysis pipeline

1. **Ingestion** (existing): the archive is validated entry by entry (paths, links, sizes,
   compression ratio) and extracted. Every stored file gets a SHA-256 checksum.
2. **Full analysis** (`full_analysis` job), for a ready repository:
   1. Capture the snapshot (the files rows) and apply exclusions such as `node_modules/`,
      `.git/`, `dist/`, `build/`, `vendor/` and virtual environments.
   2. Run the analyzers in order. Each reads files only through the verified reader, which
      checks containment, refuses links, bounds sizes and verifies checksums.
   3. Store all results and the run summary in one transaction, after checking that the
      snapshot was not replaced meanwhile.
3. **Results** are served per run (`/analysis-runs/{run_id}/...`) and aggregated across a
   user's repositories for the Overview dashboard.

| Analyzer | Module | Phase | Engine |
| --- | --- | --- | --- |
| Summary | 2 | 1 | Files, languages, lines of code, excluded paths |
| Code quality | 3 | 2 | Ruff (pyflakes, pycodestyle, naming, docstrings, bugbear, simplify) and the existing unreachable-code AST diagnostic; duplicate blocks (normalized line windows, all languages); TODO/FIXME markers; very long files |
| Security | 4 | 3 | Bandit (Python); pattern rules for JavaScript/TypeScript (XSS sinks, `eval`, SQL and shell commands built from strings) and any language (TLS verification off, insecure JWT, CORS wildcard); the secret-scan rules; settings, `.env` and Dockerfile checks |
| Complexity | 5 | 4 | Lizard: cyclomatic complexity, lines and parameters of every function in about twenty languages; Radon: the maintainability index of Python files (the same formula estimated from Lizard's tokens elsewhere); classes |
| Dependencies | 6 | 5 | The existing manifest parsers (`package.json`, `pyproject.toml`, `requirements*.txt`); latest versions from PyPI and npm; known vulnerabilities from OSV.dev (CVSS v3 scores computed from the published vectors); conflicting declarations; vulnerable versions also become security findings (A06) |
| Architecture | 7 | 6 | Components (directories) and the imports between them (Python syntax trees and the code explorer's module index; JavaScript/TypeScript relative and `@/` imports); technologies from manifests and imports; data stores; API routes (FastAPI/Flask/Django, Express-style, Next.js); entry points; Dockerfiles, Docker Compose, CI, deployment and Kubernetes files; rule-based observations with evidence |
| Health score | 8 | 7 | Documented formulas over the stored results above, computed when read with the user's weights (section 6) |

### Architecture (phase 6)

- **Components** are directories. The depth shown is the deepest (at most 4) that gives at
  most 40 components, so large repositories stay readable.
- **Edges** are imports between files of different components, resolved to repository
  files: Python with the code explorer's module index (absolute and relative imports;
  ambiguous matches go to the file nearest the importer), JavaScript/TypeScript by relative
  path with the usual extensions, `index` files, `.js` imports of `.ts` sources and the `@/`
  alias for `src/`. Each edge keeps up to three example imports (file and line). Dependency
  cycles are the strongly connected components (Tarjan) of the component graph.
- **Roles** come from files: tests (directories or names), user interface (`.tsx/.jsx/.vue/
  .svelte`), API (route declarations), data access (`models/`, `db/`, ...), authentication
  (`auth`, `login`, `jwt`, ... in the path), workers and configuration. A component's primary
  role places it in the diagram; API and data access count from a single file, the others
  need half of the files.
- **Technologies** are known packages (a catalog of about 70) declared in a manifest or
  imported. **Data stores** come from database drivers and Docker Compose images.
- **Routes**: FastAPI/Flask decorators (with the router prefix declared in the same file),
  Django `path()`, Express-style `app.get('/...')` and Next.js file routes. **Entry points**:
  web applications, `__main__` scripts, frontend mounts, servers that listen, `package.json`
  main/bin/scripts and `index.html`. **Infrastructure**: Dockerfiles (images, ports,
  commands), Docker Compose (read with PyYAML's safe loader, at most 256 KiB), CI, deployment,
  web-server, Terraform and Kubernetes files.
- **Observations** are fixed rules, each with evidence: frontend and backend in separate
  top-level directories, a layered structure (API and data-access components), circular
  dependencies, the most depended-on component (3 or more importers), containers,
  continuous integration, no tests.
- **Diagram** (frontend): components in columns by role (tests, interface, API, core and
  services, data access, data stores), columns wrapping after 7 rows, drawn at natural size in
  a scrollable box with zoom. Arrow width follows the number of imports; red arrows join two
  components that import each other; dashed arrows lead to data stores. Selecting a
  component shows its roles' evidence, its imports and its users.

### Dependencies (phase 5)

- **Declarations** come from the existing manifest parsers, in the same pass as the other
  analyzers (manifests in excluded directories such as `node_modules/` are skipped). Each
  declaration records its manifest, line, scope and the version to check: `pinned`
  (`==2.25.0`, `2.25.0`), `minimum` (the lowest version a range allows: `>=2.25`, `^4.17.1`) or
  `none` (no constraint, a tag, a URL, a path or a git reference). Python versions follow
  PEP 440 (`packaging`), npm versions semver.
- **Lookups** run after the pass, outside any database transaction, unless
  `DEPENDENCY_LOOKUPS=false`: the latest version from PyPI (`/pypi/<name>/json`) or npm
  (`/<name>/latest`), and advisories from OSV.dev (one `querybatch`, then `/v1/vulns/<id>`).
  Only these fixed HTTPS hosts are contacted, with quoted, validated names; no redirects,
  no proxy settings, timeouts, response size caps, at most 500 packages, 300 advisories, 8
  requests at a time and 120 seconds in total. What is sent: package names and versions.
  Whatever is not answered in time is reported as `partial` or `failed`, never guessed.
- **Advisories** for the same vulnerability (a PYSEC and a GHSA record of one CVE) are merged.
  Severity is the CVSS v3 rating computed from the published vector, else the advisory
  database's rating, else "unrated". The fix is the lowest fixed version newer than the checked one.
- **Updates** compare the checked version with the latest release: major, minor, patch, up to
  date or unknown. A **conflict** is a package declared with different specifiers.
- **Security**: each advisory of a checked version becomes a security finding (OWASP A06,
  the advisory's CWE or CWE-1395): confirmed for a pinned version, potential when only the
  lowest version of a range is affected; unrated advisories count as medium.
- Results describe the advisories published when the run was analyzed; a new run picks up
  newer ones.

### Complexity (phase 4)

- **Lizard** measures every function of each measurable file (a programming language Lizard
  has a reader for; not excluded, not generated, at most 512 KiB): cyclomatic complexity
  (McCabe: 1 + decision points), lines of code without comments and blanks (NLOC) and
  parameters. It runs in-process on text that was read through the verified reader; it
  tokenizes and never runs code.
- **Maintainability index** (0-100) uses the Radon / Visual Studio formula
  `max(0, (171 - 5.2 ln V - 0.23 G - 16.2 ln L) * 100 / 171)`. Python files use Radon's own
  value (it also credits comments). Other languages use the formula with Halstead volume
  V = N log2 n from Lizard's tokens and are marked "estimated". The repository's index is the
  mean over files, so a few very long files cannot hide the rest of the code base.
- **Ranks**: functions are low (1-10), medium (11-20) or high (21+); a file is as complex as
  its most complex function. Maintainability is good (20+), moderate (10-19) or poor (<10).
- **Classes** are counted from the Python syntax tree, or from class, interface, struct,
  enum and trait declarations elsewhere.
- **Limits**: every measured file and function is counted; up to 20,000 files and the 10,000
  most complex functions are stored. A file a tool cannot handle is counted, never fatal.
- The Complexity page also shows the run's duplication percentage from the code analysis.

### Security (phase 3)

- **Bandit** runs on the same private working copy as Ruff (one copy per run, shared), with
  the same safeguards (isolated, minimal environment, 300-second timeout, 64 MiB report cap).
  `--ignore-nosec` reports findings even where the code says `# nosec`; B101 (`assert`) is
  skipped as noise. Bandit's messages for hard-coded passwords (B105-B107) contain the value,
  so they are replaced with a message that does not.
- **Own checks** (`app/analysis/security/patterns.py`): the secret-scan rules on every line of
  every text file (comments too); JavaScript/TypeScript rules for `eval`, `new Function`,
  shell commands and SQL built from strings, and HTML sinks (`innerHTML`, `document.write`,
  `dangerouslySetInnerHTML`); TLS verification off, insecure JWT options and CORS wildcards in
  any language; `DEBUG = True` and `ALLOWED_HOSTS = ['*']` in Python settings files;
  hard-coded credentials in other languages and configuration files (placeholders such as
  `your-password` or `${TOKEN}` are ignored); committed `.env` files (templates such as
  `.env.example` are not); Dockerfiles without an unprivileged `USER`, with an unpinned base
  image, or with `ADD <url>`. Code rules skip comment lines; patterns are linear.
- **Classification** (`app/analysis/security/rules.py`): severity critical/high/medium/low
  (critical is reserved for committed credentials in a known format and private keys);
  confidence **confirmed** (the insecure code or file is definitely present, including Bandit
  findings with HIGH confidence) or **potential** (a pattern that needs review); an OWASP Top 10
  (2021) category; a CWE when one applies; an explanation and a recommendation.
- **Never claims a project is secure.** Every security view states that automated checks
  find known patterns only. Matched secret values are never stored or returned.
- **Limits**: every finding is counted; the 5,000 most severe are stored; at most 100 own
  findings per file; one finding per rule and line.
- **Not yet covered**: vulnerable dependency versions (OSV.dev) arrive with dependency
  analysis in phase 5.

### Code quality (phase 2)

- **Ruff** runs as a subprocess on a private temporary copy that holds only the snapshot's
  verified, readable Python files, never on repository storage. It runs with `--isolated`
  (repository configuration files are ignored), a minimal environment (no application
  secrets), a 240-second timeout and a 64 MiB cap on its report. Ruff parses source text and
  never imports or runs it. If it cannot finish, the run records why and keeps the checks
  that work for every language.
- **Unreachable code** reuses the code explorer's AST diagnostic (statements after `return`,
  `raise`, `break`, `continue`, an `if`/`else` where every branch leaves, or an endless loop).
- **Duplication** compares windows of 6 significant lines (whitespace collapsed; blank,
  comment-only, import and brace-only lines dropped) across all programming-language files.
  Windows with fewer than 3 different lines (data tables) and overlapping repetition within
  one file are ignored. Duplication % = lines inside a duplicated window / significant lines.
- **Classification** is a documented table (`app/analysis/quality/rules.py`): the most
  specific rule code wins (`F821` before `F8` before `F`). Every issue has a category, a
  severity (high, medium, low, info), an explanation and a suggested correction. Ruff's own
  fix message is used as the suggestion when it offers one.
- **Limits**: every issue is counted; the 5,000 most severe are stored. A syntax error is
  reported once per file (Ruff's follow-on errors are dropped).

## 4. Backend modules

```
backend/app/
  api/v1/routes/      REST endpoints (thin: ownership, validation, rate limits)
  analysis/           analysis-run pipeline
    exclusions.py     paths that are never analyzed (node_modules, dist, ...)
    snapshot.py       captures a snapshot and reads files through the verified reader
    summary.py        summary analyzer (languages, lines of code)
    runner.py         run lifecycle: start, claim, analyze, store, history
    quality/ security/ complexity/ dependencies/ architecture/   one package per analysis
    health.py         the Code Health Score (formulas over the stored summaries)
  ai/                 LLM providers (Anthropic, Gemini) and provider selection
    chunks.py         the AI chat's retrieval units (secrets masked)
  chat/               retrieval (PostgreSQL full-text search), analysis context, prompt
  reports/            PDF report builder   (phase 9)
  services/           existing services: ingestion, archive, GitHub, code intelligence
  models/ schemas/    SQLAlchemy models, Pydantic schemas
  workers/            arq worker and queue
```

## 5. Database design

The existing tables are `users`, `projects`, `repositories`, `files`, `analysis_jobs` and
`file_metrics`. New tables are added, each with its own migration, in the phase that uses
it:

| Table | Purpose | Key columns and relations |
| --- | --- | --- |
| `analysis_runs` | One completed full analysis | `id`, `analysis_job_id` (FK, unique), `repository_id` (FK), `project_id` (FK), file and line counts, `languages` (JSONB), `excluded_paths` count, timestamps; index (`repository_id`, `created_at`) |
| `code_issues` | Code quality findings (migration 0005) | `run_id` (FK, cascade), `path`, `line`, `column`, `end_line`, `tool`, `rule_id`, `category`, `severity`, `message`, `explanation`, `suggestion`, `doc_url`; indexes (`run_id`, `severity`), (`run_id`, `category`), (`run_id`, `path`). The run's totals are in `analysis_runs.quality` (JSONB) |
| `security_findings` | Security findings (migration 0006) | `run_id` (FK, cascade), `path`, `line`, `end_line`, `tool`, `rule_id`, `title`, `owasp` (A01-A10), `cwe`, `severity` (critical/high/medium/low), `confidence` (confirmed/potential), `message`, `explanation`, `recommendation`, `doc_url`; indexes (`run_id`, `severity`), (`run_id`, `owasp`), (`run_id`, `path`). The run's totals are in `analysis_runs.security` (JSONB) |
| `complexity_files` | Per-file complexity (migration 0007) | `run_id` (FK, cascade), `path` (unique per run), `language`, `nloc`, `functions`, `classes`, `total_cyclomatic`, `max_cyclomatic`, `average_cyclomatic`, `rank`, `maintainability_index`, `maintainability`, `mi_estimated`; index (`run_id`, `max_cyclomatic`) |
| `complexity_functions` | Per-function complexity (migration 0007) | `run_id` (FK, cascade), `path`, `name`, `line`, `end_line`, `cyclomatic`, `nloc`, `parameters`, `rank`; indexes (`run_id`, `cyclomatic`), (`run_id`, `path`). The run's totals are in `analysis_runs.complexity` (JSONB) |
| `dependency_records` | Dependency health (migration 0008) | `run_id` (FK, cascade), `manifest`, `ecosystem`, `name`, `specifier`, `scope`, `line`, `version`, `version_source` (pinned/minimum/none), `latest_version`, `update`, `vulnerability_count`, `max_severity`, `vulnerabilities` (JSONB: id, aliases, summary, severity, score, fixed_in, cwe, url), `conflict`; indexes (`run_id`, `name`), (`run_id`, `vulnerability_count`). The run's totals are in `analysis_runs.dependencies` (JSONB) |
| `architecture_reports` | Architecture model (migration 0009) | `run_id` (FK, cascade, unique), `document` (JSONB: depth, components with roles and evidence, edges with example imports, cycles, technologies, data stores, routes, entry points, infrastructure, Compose services, observations, truncation flags). The run's counts are in `analysis_runs.architecture` (JSONB) |
| `users.health_weights` | Health-score weights (migration 0010) | JSONB, one integer 0-100 per dimension; null means the defaults. Scores are not stored: they are computed from the run's summaries when read, so a change of weights or formulas applies to every run at once |
| `code_chunks` | Retrieval units for the chat (migration 0011) | `run_id` (FK, cascade), `path`, `language`, `start_line`, `end_line`, `symbol`, `content` (secrets masked), `search` (tsvector: path and symbol weight A, body D; GIN index); index (`run_id`, `path`). The run's counts are in `analysis_runs.chat_index` (JSONB) |
| `chat_conversations` / `chat_messages` | Chat history per user and repository (migration 0011) | conversation: `user_id`, `project_id`, `repository_id`, `run_id` (all FK, cascade), `title`, `created_at`, `updated_at`; message: `conversation_id` (FK, cascade), `role` (user/assistant), `content`, `citations` (JSONB: number, path, lines, symbol), `model`, token counts, `created_at` |
| `generated_reports` | Report history | `run_id`, `user_id`, `created_at`, `size_bytes`, `sha256` |

Every result table cascades on delete from its run. Runs cascade from their repository, and
repositories from their project. Ownership is always checked through the project's
`owner_id`, so users never see each other's data.

## 6. Code Health Score (phase 7)

Each dimension is scored from 0 to 100 from numbers the analyses already stored
(`app/analysis/health.py`); nothing reads code again. The overall score is the weighted
average of the dimensions that apply to the run. A dimension that does not apply (no
functions, no declared dependencies, dependency lookups turned off or failed, no source
components) has no score and is left out, so it neither helps nor hurts. Grades: A from 85,
B from 70, C from 55, D from 40, F below.

Densities are per 1,000 lines of code (at least 1,000). A density `d` becomes a score with
`100 / (1 + d / H)`: 100 with nothing found, 50 at the half-point `H`, approaching 0.

| Dimension | Default weight | Formula |
| --- | --- | --- |
| Security | 25 | Points: critical 10, high 5, medium 2, low 0.5; potential findings count half. `H` = 2 points per 1,000 lines. A confirmed critical finding caps the score at 40, a confirmed high one at 70 |
| Code quality | 20 | 75%: issue points (high 5, medium 2, low 0.5, info 0.1; duplicate blocks excluded) with `H` = 10. 25%: duplication, `100 - 4 x percent` (0 at 25%) |
| Complexity | 15 | `100 - 150 x share of medium functions (11-20) - 400 x share of high functions (above 20) - 5 x (average - 5, if above 0)` |
| Maintainability | 15 | Maintainability index mapped to 0 at 10 and 100 at 65. With Python files analyzed by Ruff: 70% index, 30% documentation (missing docstrings with `H` = 10) |
| Dependency health | 15 | `100 - 200 x weighted share of vulnerable dependencies` (each counted once by its worst vulnerability: critical 1, high 0.7, medium 0.4, low 0.15, unknown 0.4) `- 20 x share a major version behind - 5 x share a minor version behind - 5 per conflicting package (at most 20) - 5 per unparsable manifest`. A critical vulnerability caps the score at 60, a high one at 80 |
| Architecture | 10 | Checks worth 100: automated tests 30, no circular dependencies 25 (minus 10 per cycle), entry points identified 15, continuous integration 15, separated layers (API and data access, or a frontend and a backend) 15 |

- **Weights** are relative integers from 0 to 100 (at least one above 0), stored per user and
  applied to every repository; a dimension counts its weight divided by the total weight of
  the scored dimensions.
- **Explanations**: every dimension returns its inputs, the calculation with the actual
  numbers, and the improvements that would raise it, linked to the page that lists them.
- **Older runs**: runs stored before phase 7 lack three summary fields. Security then counts
  every finding as confirmed, dependency health counts every vulnerable dependency as high,
  and the architecture checks are read from the stored architecture document. Runs without
  code-quality results are not scored.
- **History**: the score of each run, oldest first, drawn as a trend.

## 7. AI codebase chat (phase 8)

- **Indexing** (`app/analysis/chunks.py`, part of every full analysis): text files are split
  into chunks: Python files by top-level function and class (`ast`, decorators included; the
  code between definitions becomes windows), other files by windows of 60 lines, blank
  windows skipped. Definitions over 120 lines are split into windows, chunks are cut at
  6,000 characters and a run indexes at most 20,000 chunks (files over 256 KiB are skipped).
  Committed secrets (the secret scan's rules, credential assignments and private-key blocks)
  are masked before anything is stored, and `.env` files are left out, so secrets never reach
  the AI provider.
- **Search terms:** identifiers are split into words in Python (`getUserName`,
  `get_user_name` -> `get`, `user`, `name`, plus the whole identifier), which PostgreSQL's
  parser does not do. The full-text vector weighs a chunk's path and symbol (A) above its
  body (D). No vector embeddings are used: retrieval is PostgreSQL full-text search only.
- **Retrieval** (`app/chat/retrieval.py`): the question becomes an OR query of its terms
  (common English words dropped, prefix matching from four characters with simple plural and
  -ed/-ing stems; terms contain only letters and digits, so no query syntax can be
  injected). Chunks are ranked with `ts_rank_cd`; test files count 0.4 unless the question is
  about tests. Files the question names come first, and named files that are not in the
  analysis are reported to the model. At most 8 passages, 3 per file and 36,000 characters.
  A follow-up question also searches with the previous question.
- **Analysis context** (`app/chat/context.py`): every question also gets a summary of the run
  from its stored results: languages, the health score, the most severe security findings,
  code quality, the most complex functions, vulnerable dependencies and the architecture,
  each with its file and line.
- **Generation** (`app/chat/service.py`): a fixed system prompt; the user message holds the
  analysis in `<analysis>`, the passages in numbered `<source>` tags and the question in
  `<question>`, all marked as untrusted data (closing tags inside repository text are
  neutralized). The model must cite passages as `[n]`, say when the sources do not contain
  the answer, and never claim the project is secure. It gets no tools, and the answer is
  shown as text, never as HTML. The last six messages of the conversation are sent as
  plain questions and answers.
- **Citations:** the passages whose numbers appear in the answer are stored with it and
  shown as links that open the file at that line in the explorer.
- **History:** a conversation belongs to one user and repository and stays bound to the run
  it started on. A question and its answer are stored together, only once the answer
  exists. Limits: 30 questions per user per hour; questions up to 2,000 characters.

## 8. Security controls

- Argon2 password hashing, JWT bearer tokens and ownership checks on every repository route.
- Per-user rate limits for analysis runs, the chat and reports. Per-IP limits for sign-up and
  login use the visitor's real address behind proxies (`CLIENT_IP_HEADER`).
- Archive validation (path traversal, links, sizes, compression ratio). The GitHub host and
  every redirect are checked, which blocks server-side request forgery (SSRF). Repository
  storage is isolated per repository.
- No execution of repository code. External tools run with time limits on stored copies.
- Secrets are never shown: findings carry the location and rule, never the matched value.
- Error messages are fixed text and never echo internal details.

## 9. Development phases

| Phase | Deliverable |
| --- | --- |
| 1 | This design, the analysis-run pipeline (job type, `analysis_runs`, history API, exclusions, summary analyzer), the sidebar dashboard shell, the Overview with real data, the Upload Repository flow |
| 2 | Code quality engine and Code Analysis page |
| 3 | Security analysis and Security page |
| 4 | Complexity analysis and Complexity page |
| 5 | Dependency health (latest versions, OSV vulnerabilities) |
| 6 | Architecture insights and the interactive diagram |
| 7 | Code Health Score with an explained breakdown |
| 8 | AI codebase chat (retrieval-augmented generation, RAG) with conversation history |
| 9 | PDF reports and the analysis history page |
| 10 | Profile and settings, final polish, deployment |

Each phase is implemented with tests, verified end to end with sample repositories, and
committed on its own.
