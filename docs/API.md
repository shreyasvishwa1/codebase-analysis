# API reference

The REST API behind the web app. Interactive documentation is at `/docs` when `ENVIRONMENT` is not `production`.

All endpoints are under `/api/v1`. Repository endpoints share the prefix
`/projects/{project_id}/repositories/{repository_id}`, written `…` below.
- Per-file endpoints take `?path=<file path>`.
- Go to definition and name occurrences also take `line` and `column`.
- Find references and the three hierarchy endpoints also take `line`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health`, `GET /api/health`, `GET /api/v1/health` |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm` |
| Account | `PATCH /auth/me` (display name), `POST /auth/change-password` (ends other sessions; returns a new token), `DELETE /auth/me` (deletes the account and its data; needs the password), `GET /auth/me/summary` |
| Projects | `GET /projects`, `POST /projects`, `GET`/`PATCH`/`DELETE /projects/{project_id}` |
| Repositories | `GET`/`POST /projects/{project_id}/repositories`, `GET`/`PATCH`/`DELETE …` |
| Ingestion and jobs | `POST …/ingest`, `GET …/jobs`, `GET …/jobs/{job_id}`, `POST …/jobs/{job_id}/cancel` |
| Files | `GET …/tree`, `GET …/languages`, `GET …/files/content` |
| Search | `POST …/search` (code), `POST …/symbols/search` |
| Code intelligence | `GET …/files/outline`, `…/files/imports`, `…/files/importers`, `…/files/definition`, `…/files/references`, `…/files/occurrences`, `…/files/call-hierarchy`, `…/files/type-hierarchy`, `…/files/method-overrides` |
| Diagnostics | `GET …/files/unused-imports`, `…/files/unbound-names`, `…/files/unused-variables`, `…/files/replaced-definitions`, `…/files/unreachable-code` |
| Repository analysis | `GET`/`POST …/analysis/code-metrics`, `GET …/analysis/dependencies`, `GET …/analysis/secrets` |
| Full analysis | `POST …/analysis-runs` (start), `GET …/analysis-runs` (latest job and history), `GET …/analysis-runs/{run_id}` |
| Overview | `GET /dashboard` |
| Reports and history | `POST …/analysis-runs/{run_id}/reports` (create a PDF report), `GET /reports` (the user's reports, optionally `?repository_id=`), `GET /reports/{id}/download`, `DELETE /reports/{id}`, `GET /analysis-history` (runs with headline numbers; `?repository_id=`, `?limit=`) |
| AI chat | `GET`/`POST …/chat/conversations` (list; start with a first question), `GET`/`DELETE …/chat/conversations/{id}`, `POST …/chat/conversations/{id}/messages` (a follow-up question), `GET /chat` (repositories ready to chat and recent conversations), `GET /chat/status` |
| Health score | `GET …/analysis-runs/{run_id}/health` (the run's score, dimensions and weights), `GET …/health-history` (scores per run, oldest first), `GET /health-score` (each repository's latest score), `GET`/`PUT`/`DELETE /health-score/weights` (the user's weights; `DELETE` restores the defaults) |
| Architecture | `GET …/analysis-runs/{run_id}/architecture` (the run's architecture document), `GET /architecture` (each repository's latest summary) |
| Dependencies | `GET …/analysis-runs/{run_id}/dependencies` (filters: `ecosystem`, `scope`, `update`, `vulnerable`, `conflict`, `q`; `sort`; paged), `GET /dependency-analysis` (each repository's latest results) |
| Complexity | `GET …/analysis-runs/{run_id}/complexity/files` (filters: `rank`, `maintainability`, `q`; `sort`; paged), `GET …/complexity/functions` (filters: `rank`, `path`, `q`; paged), `GET /complexity` (each repository's latest results) |
| Security | `GET …/analysis-runs/{run_id}/security-findings` (filters: `severity`, `confidence`, `owasp`, `path`, `q`; paged), `GET /security` (each repository's latest results) |
| Code analysis | `GET …/analysis-runs/{run_id}/issues` (filters: `severity`, `category`, `path`, `q`; paged), `GET /code-quality` (each repository's latest results) |
| AI | `POST …/files/explain` |
| Usability survey | `GET`/`PUT /usability/me` (the account's own answers; `PUT` replaces them), `GET /usability/results` (every response, summarized anonymously), `GET /usability/results.csv` (the anonymous answers) |
