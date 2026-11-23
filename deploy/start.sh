#!/usr/bin/env bash
# Container entrypoint: migrate, then run the API, the worker and Caddy. If any of them stops,
# the container exits so the platform restarts it.
set -euo pipefail

# Hosting platforms provide postgresql:// (or postgres://) URLs; the app requires asyncpg.
case "${DATABASE_URL:-}" in
  postgresql://*) export DATABASE_URL="postgresql+asyncpg://${DATABASE_URL#postgresql://}" ;;
  postgres://*) export DATABASE_URL="postgresql+asyncpg://${DATABASE_URL#postgres://}" ;;
esac

# The app runs unprivileged. A volume mounted at DATA_DIR may belong to root (Railway mounts
# volumes that way); then keep the files in the home folder instead. Nothing is lost: every
# repository's files are kept in the database and its folder is rebuilt from there on demand.
export DATA_DIR="${DATA_DIR:-/data}"
if ! mkdir -p "$DATA_DIR" 2>/dev/null || [ ! -w "$DATA_DIR" ]; then
  echo "DATA_DIR $DATA_DIR is not writable by $(id -un); using $HOME/data instead." >&2
  export DATA_DIR="$HOME/data"
  mkdir -p "$DATA_DIR"
fi
cd /app/backend

alembic upgrade head

# Only Caddy (on this host) may set the client address through X-Forwarded-For.
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1 &
caddy run --config /app/deploy/Caddyfile --adapter caddyfile &

# On small instances the API and the worker compete for CPU while starting; let the API come
# up first (it listens once startup is complete), then start the worker. Give up waiting
# after five minutes so a slow start never leaves jobs without a worker.
for _ in $(seq 1 300); do
  (echo > /dev/tcp/127.0.0.1/8000) 2>/dev/null && break
  sleep 1
done
arq app.workers.worker.WorkerSettings &

wait -n
exit 1
