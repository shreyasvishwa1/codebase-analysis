# Configuration

Every environment variable the backend reads. Set them in `backend/.env` for local development, or in the hosting platform's settings.

The backend reads `backend/.env`; real environment variables override it. Every variable
below exists in the code.

| Variable | Status | Default | Purpose |
| --- | --- | --- | --- |
| `SECRET_KEY` | Required | — | Signs JWTs; at least 32 characters; the placeholder is rejected in production |
| `DATABASE_URL` | Required | — | Must use `postgresql+asyncpg://` (the built-in default is not usable) |
| `ENVIRONMENT` | Optional | `development` | `development`, `test` or `production`; production disables `/docs`, `/redoc` and `/openapi.json` |
| `REDIS_URL` | Optional | `redis://localhost:6379/0` | Job queue and rate limits |
| `CORS_ORIGINS` | Optional | `http://localhost:5173,http://127.0.0.1:5173` | Exact allowed origins; `*` is rejected |
| `DATA_DIR` | Optional | `<repository>/data` | Storage for repositories and uploads |
| `JWT_ALGORITHM` | Optional | `HS256` | `HS256`, `HS384` or `HS512` |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Optional | `60` | Token lifetime |
| `MAX_UPLOAD_SIZE_MB` | Optional | `100` | Upload size limit |
| `MAX_ARCHIVE_FILE_COUNT` | Optional | `10000` | Entries per archive |
| `MAX_EXTRACTED_SIZE_MB` | Optional | `500` | Total extracted size |
| `MAX_EXTRACTED_FILE_SIZE_MB` | Optional | `25` | Per-file extracted size (at most `MAX_EXTRACTED_SIZE_MB`) |
| `MAX_COMPRESSION_RATIO` | Optional | `100` | Per-entry compression ratio (zip-bomb guard) |
| `LLM_PROVIDER` | Optional | empty | `anthropic` or `gemini`; empty chooses by which key is set (Anthropic first) |
| `ANTHROPIC_API_KEY` | Optional | empty | Enables AI file explanations and the AI chat with Anthropic; empty keeps them disabled |
| `LLM_MODEL` | Optional | `claude-opus-5-5` | Claude model for explanations |
| `GEMINI_API_KEY` | Optional | empty | Enables AI file explanations and the AI chat with Google Gemini (free tier available) |
| `GEMINI_MODEL` | Optional | `gemini-3.8-flash` | Gemini model for explanations and the chat |
| `GEMINI_FALLBACK_MODEL` | Optional | `gemini-3.5-flash-lite` | Asked once when `GEMINI_MODEL` stays overloaded after two retries or times out; empty turns the fallback off |
| `SMTP_HOST` | Optional | empty | Mail server for password-reset emails, such as `smtp.gmail.com`; password reset stays off until `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` and `APP_BASE_URL` are all set |
| `SMTP_PORT` | Optional | `587` | Mail server port; the connection is upgraded with STARTTLS |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Optional | empty | Mail server login; for Gmail, the address and a Google app password (not the account password) |
| `SMTP_FROM` | Optional | empty | Sender address of reset emails |
| `APP_BASE_URL` | Optional | empty | Public origin of the frontend, such as `http://127.0.0.1:5173`; reset links point to `<APP_BASE_URL>/reset-password` |
| `CLIENT_IP_HEADER` | Optional (deployments) | `X-Forwarded-For` | Header the bundled Caddy reads the visitor's address from; `Cf-Connecting-Ip` behind Cloudflare (set in `render.yaml`) |
| `REGISTER_IP_LIMIT` | Optional | `5` | Sign-ups per hour from one network address; raise it for a class sharing one Wi-Fi |
| `LOGIN_IP_LIMIT` | Optional | `10` | Login attempts per minute from one network address; raise it the same way |
| `DEPENDENCY_LOOKUPS` | Optional | `true` | Dependency analysis looks up latest versions on PyPI and npm and vulnerabilities on OSV.dev (sending package names and versions); `false` lists declarations only |
| `BREVO_API_KEY` | Optional | empty | Sends reset emails through Brevo's HTTPS API instead of SMTP (for hosts that block SMTP, such as Render's free plan) |
| `EMAIL_FROM` | Optional | `SMTP_FROM` | Sender address of reset emails for either transport |
| `PASSWORD_RESET_TOKEN_MINUTES` | Optional | `30` | Reset link lifetime (5 to 1,440 minutes) |
| `DEBUG` | Optional, development only | `false` | Logs SQL statements, including bound parameter values; keep it off outside local development |
| `APP_NAME`, `APP_VERSION` | Optional | `CodeBase Analysis`, `1.0.0` | Shown in the API title and health responses |
| `API_PREFIX` | Optional | `/api` | API mount prefix; the frontend expects `/api/v1`, so keep the default |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Development only (Docker Compose) | — | Required by `docker-compose.yml`; read from the repository-root `.env` or the shell |
| `POSTGRES_PORT` | Development only (Docker Compose) | `5432` | Local PostgreSQL port |
| `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`, `TEST_REDIS_URL` | Tests only | — | See [Testing](../README.md#testing) |
