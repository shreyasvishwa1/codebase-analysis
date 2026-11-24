#!/usr/bin/env bash
# Brings the database up to this version of the app before it starts (run from backend/).
#
# A newer deploy may already have migrated the database and then failed to start, after
# which the platform falls back to this older version. Its migrations end before the
# database's revision, so Alembic reports "Can't locate revision". This version then starts
# without migrating, which is safe because every migration only adds tables, indexes and
# optional columns (checked by backend/tests/test_deploy_config.py): everything this version
# uses is still there. Any other failure stops the start, since an app on a half-migrated
# database is worse than no app.
set -uo pipefail

if output=$(alembic upgrade head 2>&1); then
  printf '%s\n' "$output"
  exit 0
fi
printf '%s\n' "$output" >&2
if printf '%s\n' "$output" | grep -q "Can't locate revision identified by"; then
  echo "WARNING: a newer version of the app has already migrated the database. Starting this" \
    "version without migrating; deploy the latest commit to bring the app up to date." >&2
  exit 0
fi
echo "The database migration failed; the app is not started." >&2
exit 1
