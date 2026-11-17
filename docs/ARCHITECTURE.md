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
   ├──► PostgreSQL 16 (+ pgvector): users, projects, repositories, files, jobs,
   │       analysis runs and results, code chunks, chat, reports
   ├──► Redis 7: arq job queue, rate-limit counters
   │       └──► arq worker: ingestion, full analysis (all analyzers), maintenance
   ├──► Repository storage (DATA_DIR): verified, read-only copies of ingested files
   └──► External services (optional, all server-side):
            OSV.dev (vulnerabilities), PyPI / npm registries (latest versions),
            Gemini or Anthropic (chat, explanations, embeddings), Brevo or SMTP (email)
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
| Code quality | 3 | 2 | Ruff (pyflakes, pycodestyle, naming, docstrings, bugbear, simplify) and the existing AST diagnostics; duplicate blocks (token windows, all languages); TODO/FIXME markers |
| Security | 4 | 3 | Bandit (Python), pattern rules for JavaScript/TypeScript (XSS sinks, `eval`, SQL built from strings), the secret scan, insecure configuration checks; Semgrep when installed |
| Complexity | 5 | 4 | Radon: cyclomatic complexity per function, maintainability index, classes and functions; a lightweight brace-based estimate for JavaScript/TypeScript |
| Dependencies | 6 | 5 | Manifest inventory (`package.json`, `pyproject.toml`, `requirements*.txt`), latest versions from PyPI/npm, known vulnerabilities from OSV.dev |
| Architecture | 7 | 6 | Evidence rules: frameworks (manifests and imports), entry points, API routes, database access, authentication code, configuration and infrastructure files; components and edges built from the import graph |
| Health score | 8 | 7 | Documented formula over the results above (section 6) |

## 4. Backend modules

```
backend/app/
  api/v1/routes/      REST endpoints (thin: ownership, validation, rate limits)
  analysis/           analysis-run pipeline
    exclusions.py     paths that are never analyzed (node_modules, dist, ...)
    snapshot.py       captures a snapshot and reads files through the verified reader
    summary.py        summary analyzer (languages, lines of code)
    runner.py         run lifecycle: start, claim, analyze, store, history
    quality/ security/ complexity/ dependencies/ architecture/ health/   (later phases)
  ai/                 LLM providers (Anthropic, Gemini) and provider selection
  chat/               retrieval (full text + vectors) and conversation service   (phase 8)
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
| `code_issues` | Code quality findings | `run_id` (FK), `path`, `line`, `column`, `tool`, `rule_id`, `category`, `severity`, `message`, `suggestion`; indexes (`run_id`, `severity`) and (`run_id`, `path`) |
| `security_findings` | Security findings | `run_id`, `path`, `line`, `tool`, `rule_id`, `title`, `severity` (critical/high/medium/low), `confidence` (confirmed/potential), `cwe`, `description`, `remediation` |
| `complexity_metrics` | Per-file complexity | `run_id`, `path`, `language`, `lines`, `functions`, `classes`, `avg_complexity`, `max_complexity`, `maintainability_index`, `rank` |
| `complexity_functions` | Per-function complexity | `run_id`, `path`, `name`, `line`, `complexity`, `rank` |
| `dependency_records` | Dependency health | `run_id`, `manifest_path`, `ecosystem`, `name`, `specifier`, `scope`, `latest_version`, `outdated`, `vulnerabilities` (JSONB) |
| `architecture_insights` | Architecture model | `run_id` (PK), `stack`, `components`, `edges`, `entry_points`, `observations` (JSONB, each item with evidence) |
| `health_scores` | Scores per run | `run_id` (PK), overall and six dimension scores, `details`, `weights`, `methodology_version` |
| `code_chunks` | Retrieval units for the chat | `run_id`, `path`, `start_line`, `end_line`, `symbol`, `content`, `search` (tsvector, GIN index), `embedding` (vector, nullable) |
| `chat_conversations` / `chat_messages` | Chat history per user and repository | conversation: `user_id`, `repository_id`, `run_id`, `title`; message: `role`, `content`, `citations` (JSONB) |
| `generated_reports` | Report history | `run_id`, `user_id`, `created_at`, `size_bytes`, `sha256` |

Every result table cascades on delete from its run. Runs cascade from their repository, and
repositories from their project. Ownership is always checked through the project's
`owner_id`, so users never see each other's data.

## 6. Code Health Score (phase 7)

Each dimension is scored from 0 to 100 with a documented formula. The overall score is a
weighted average whose weights are configurable and stored with each score:

| Dimension | Default weight | Basis |
| --- | --- | --- |
| Security | 25% | Findings weighted by severity and confidence, per 1,000 lines of code |
| Code quality | 20% | Issues weighted by severity per 1,000 lines of code, plus the duplication percentage |
| Complexity | 15% | Share of functions above cyclomatic complexity 10 and the average complexity |
| Maintainability | 15% | Average maintainability index, documentation coverage, long files |
| Dependency health | 15% | Vulnerable and outdated direct dependencies, unparseable manifests |
| Architecture | 10% | Detected separation of layers, configuration hygiene, tests present, entry points identified |

The report shows each dimension's inputs and the improvements that would raise it.

## 7. AI codebase chat (phase 8)

- **Indexing:** during a run, source files are split into chunks: Python by function and
  class (using `ast`), other files by line windows. Chunks are indexed with PostgreSQL full
  text search and, when an embedding key is configured, with pgvector embeddings.
- **Retrieval:** each question retrieves the top chunks (hybrid of full-text and vector
  ranking) plus the relevant analysis results (findings, metrics, architecture) for the run.
- **Generation:** the provider gets a fixed system prompt, the retrieved passages marked as
  untrusted data, and the conversation so far. Answers cite `path:line` for every claim.
  When retrieval finds nothing relevant, the answer says so instead of guessing.
- **History:** conversations and messages are stored per user and repository.

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
