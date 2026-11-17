# Render (free plan) image. See DEPLOY-RENDER.md; render.yaml at the repository root uses it.
#
# One container: the built frontend behind Caddy on $PORT, the API, the arq worker and a
# private Redis (queue and rate-limit counters only; Render's free Key Value can be wiped at
# any time). PostgreSQL is external (for example Neon), set through DATABASE_URL. The disk is
# not persistent on the free plan: uploaded repositories must be ingested again after the
# service restarts or wakes from sleep, while accounts and projects stay in the database.

FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine AS caddy

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    DEBUG=false \
    HOME=/home/app \
    DATA_DIR=/home/app/data \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    XDG_CONFIG_HOME=/tmp/caddy-config \
    XDG_DATA_HOME=/tmp/caddy-data
WORKDIR /app
COPY backend/requirements.txt backend/constraints.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt -c backend/constraints.txt
COPY --chown=app backend/ backend/
COPY --from=frontend --chown=app /build/dist frontend/dist
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --chown=app deploy/ deploy/
# Precompile once at build time: the free plan's 0.1 CPU would otherwise spend most of each
# cold start compiling Python (PYTHONDONTWRITEBYTECODE stops the cache being written later).
RUN python -m compileall -q -j 0 /app/backend /usr/local/lib/python3.12 || true
USER app
RUN mkdir -p "$DATA_DIR"
EXPOSE 10000
CMD ["bash", "/app/deploy/render/start.sh"]
