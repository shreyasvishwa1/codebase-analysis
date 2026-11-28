# Technologies used

Everything CodeBase Analysis is built with, what each part is for, and the version in use. The
backend versions are pinned in [backend/requirements.txt](../backend/requirements.txt), and the
frontend versions are locked in [frontend/package-lock.json](../frontend/package-lock.json).

## Languages

| Language | Where |
| --- | --- |
| Python 3.12 | The backend: API, background worker, every analysis, PDF reports |
| TypeScript 5.9 | The frontend (React components, data fetching, charts) |
| SQL (PostgreSQL) | The database, through SQLAlchemy and Alembic migrations; full-text search for the AI chat |
| HTML and CSS (Tailwind) | The user interface |
| Bash and PowerShell | Deployment start scripts (Linux), and the Windows setup, start and stop scripts |

## Backend

| Library | Version | Used for |
| --- | --- | --- |
| FastAPI | 0.165.0 | The REST API (`/api/v1`): routing, validation, dependency injection, streamed answers |
| Uvicorn | 0.29.0 | The web server that runs FastAPI |
| Pydantic and pydantic-settings | 2.14.4, 2.1.0 | Request and response models; settings from environment variables |
| SQLAlchemy (async) | 2.0.29 | The database layer (models, queries) |
| asyncpg | 0.30.0 | The PostgreSQL driver |
| Alembic | 1.13.1 | Database migrations (16 so far) |
| arq | 0.28.0 | The background job queue (imports and full analyses run in a worker) |
| Redis | 7 | The job queue's store and the rate-limit counters |
| PyJWT | 2.15.1 | Sign-in tokens (JWT, HS256) |
| argon2-cffi | 23.1.0 | Password hashing (Argon2) |
| httpx | 0.27.0 | Outgoing requests: GitHub downloads, PyPI, npm, OSV.dev, Google Gemini |
| anthropic | 1.11.0 | The official Anthropic SDK, for the optional Claude AI chat |
| python-multipart | 0.0.34 | ZIP uploads |
| ReportLab | 5.1.0 | PDF reports with tables and charts |
| PyYAML | 6.0.3 | Reading Docker Compose files (safe loader) for the architecture view |
| packaging | 26.3 | Comparing package versions (PEP 440) for the dependency check |
| python-dotenv | 1.2.4 | Reading `.env` files in development |

## Analysis tools

Repository code is never run: every tool reads a private copy of the files.

| Tool | Version | Used for |
| --- | --- | --- |
| Python `ast` and `tokenize` (standard library) | 3.12 | Code navigation (definitions, references, call and type hierarchies), diagnostics, the data-flow security checks, chunking the code for the chat |
| Ruff | 0.8.4 | Code-quality issues in Python (bug risks, unused code, naming, style) |
| Bandit | 1.9.4 | Python security findings |
| Lizard | 1.26.1 | Cyclomatic complexity of every function, in about twenty languages |
| Radon | 6.0.1 | The maintainability index of Python files |
| The app's own rules | | Secrets, JavaScript and React risks, configuration, Dockerfiles, `.env` files, and data flow from request input to file paths, URLs, redirects, templates and responses |
| PyPI and npm registries | | The latest version of each declared package |
| OSV.dev | | Known vulnerabilities (CVE ids, CVSS scores, fixed versions) |
| Semgrep | 1.184.0 | Evaluation only: the comparison in [EVALUATION.md](EVALUATION.md), not part of the app |

## AI

| Service | Used for |
| --- | --- |
| Google Gemini (REST API) or Anthropic Claude (SDK) | The optional AI chat and file explanations: answers come from retrieved code passages and stored analysis results, cite their sources, and appear as they are written (server-sent events). Off unless a key is set |
| PostgreSQL full-text search | Finding the code passages that answer a question (retrieval-augmented generation, without vector embeddings) |

## Frontend

| Library | Version | Used for |
| --- | --- | --- |
| React and React DOM | 18.3.1 | The user interface |
| Vite | 6.4.6 | The development server and production build |
| React Router | 6.30.6 | Pages and navigation |
| TanStack Query | 5.108.2 | Fetching and caching API data, polling running analyses |
| Axios | 1.21.1 | API requests (with the sign-in token), including streamed chat answers |
| Recharts | 2.15.4 | Charts (language donut, health trend) |
| Tailwind CSS | 3.4.19 | Styling, with PostCSS 8.5.33 and Autoprefixer 10.7.0 |
| lucide-react | 0.577.0 | Icons |

## Testing and quality

| Tool | Version | Used for |
| --- | --- | --- |
| pytest, pytest-asyncio, pytest-cov | 9.2.0, 1.5.0, 7.1.0 | Backend tests (3,937), against real PostgreSQL and Redis |
| respx | 0.21.1 | Faking the AI providers' HTTP APIs in tests |
| mypy | 1.14.1 | Backend type checking |
| Ruff | 0.8.4 | Backend linting |
| Vitest | 4.1.12 | Frontend tests (1,603) |
| Testing Library and jsdom | 15.0.7, 26.1.0 | Rendering components in tests the way a user sees them |
| ESLint and typescript-eslint | 9.39.5, 8.74.0 | Frontend linting (with the React hooks rules) |
| TypeScript compiler | 5.9.3 | Frontend type checking |
| Mutation testing | | Each change was checked by deliberately breaking the code and confirming a test fails (scripts kept outside the repository) |
| SecurityEval (dataset) | v2.1 | The independent security benchmark in [EVALUATION.md](EVALUATION.md), downloaded at a pinned commit, not stored here |

## Infrastructure and deployment

| Technology | Version | Used for |
| --- | --- | --- |
| Docker | | Container images; every production container runs as an unprivileged user |
| Docker Compose | | PostgreSQL 16 and Redis 7 for local development |
| Caddy | 2 | Web server in front of the app: serves the frontend, passes `/api` on, adds security headers |
| Node.js | 22 | Building the frontend |
| Render (free plan) | | The live demo: one container with Caddy, the API, the worker and Redis ([DEPLOY-RENDER.md](../DEPLOY-RENDER.md)) |
| Neon | | The live demo's PostgreSQL database |
| GitHub Actions | | On every push: backend and frontend tests, linting, type checks, and a weekly audit of every package for known vulnerabilities; also a ping that keeps the free demo awake |
| Dependabot | | Weekly pull requests for minor and patch updates |
