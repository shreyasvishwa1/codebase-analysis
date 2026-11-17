#!/usr/bin/env bash
# Hugging Face Spaces entrypoint: start a private Redis on localhost, then the usual app
# entrypoint (migrations, API, worker, Caddy). If either stops, exit so the Space restarts.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ] || [ -z "${SECRET_KEY:-}" ]; then
  echo "Set the DATABASE_URL and SECRET_KEY secrets in the Space settings (see DEPLOY-HUGGINGFACE.md)." >&2
  exit 1
fi

# Queue and rate-limit counters only: no persistence, reachable only inside the container.
redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no --dir /tmp --protected-mode yes &
for _ in $(seq 1 50); do
  redis-cli -h 127.0.0.1 ping >/dev/null 2>&1 && break
  sleep 0.1
done

bash /app/deploy/start.sh &

wait -n
exit 1
