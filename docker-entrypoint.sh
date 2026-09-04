#!/bin/sh
# Applies pending migrations, then starts the server.
#
# The runner records what it has applied, so this is idempotent and safe on
# every boot. Set AUTO_MIGRATE=0 to skip it (e.g. to run migrations as a
# separate one-off step before a risky release).
set -e

if [ "${AUTO_MIGRATE:-1}" != "0" ]; then
  echo "running database migrations…"
  bun /app/apps/server/db/migrate.ts
fi

exec bun /app/apps/server/index.ts
