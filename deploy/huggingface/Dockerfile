# Hugging Face Spaces image. See DEPLOY-HUGGINGFACE.md.
#
# The Space repository holds only this file and README.md: the app source is cloned from
# GitHub at build time. Everything runs in one container as user 1000 (a Spaces requirement):
# the built frontend behind Caddy on port 7860, the API, the arq worker and a private Redis
# (queue and rate-limit counters only). PostgreSQL is external (Neon), set through the
# DATABASE_URL secret. The disk is not persistent on Spaces: uploaded repositories must be
# ingested again after a restart, while accounts and projects stay in the database.
#
# Local test with the working tree instead of GitHub (from the repository root):
#   docker build -f deploy/huggingface/Dockerfile --build-context source=. -t ai-se-hf .

ARG REPO=https://github.com/shreyasvishwa1/ai-software-engineer-codebase.git
ARG REF=main

FROM alpine/git:v2.47.2 AS fetch
ARG REPO
ARG REF
# The feed changes with every commit, so a new push invalidates the cached clone below.
ADD https://github.com/shreyasvishwa1/ai-software-engineer-codebase/commits/main.atom /tmp/latest.atom
RUN git clone --depth 1 --branch "$REF" "$REPO" /src && rm -rf /src/.git

FROM scratch AS source
COPY --from=fetch /src/ /

FROM node:20-alpine AS frontend
WORKDIR /build
COPY --from=source /frontend/package.json /frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --from=source /frontend/ ./
RUN npm run build

FROM caddy:2-alpine AS caddy

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 user
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    DEBUG=false \
    HOME=/home/user \
    DATA_DIR=/home/user/data \
    PORT=7860 \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    XDG_CONFIG_HOME=/tmp/caddy-config \
    XDG_DATA_HOME=/tmp/caddy-data
WORKDIR /app
COPY --from=source /backend/requirements.txt /backend/constraints.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt -c backend/constraints.txt
COPY --from=source --chown=user /backend/ backend/
COPY --from=frontend --chown=user /build/dist frontend/dist
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=source --chown=user /deploy/ deploy/
USER user
RUN mkdir -p "$DATA_DIR"
EXPOSE 7860
CMD ["bash", "/app/deploy/huggingface/start.sh"]
