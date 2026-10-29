#!/usr/bin/env bash
# Recreates the local test database: Supabase shim + every migration, in order.
# Usage: scripts/db-local-reset.sh [dbname]   (default: sniffin_test)
set -euo pipefail
DB="${1:-sniffin_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/shim/supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "FAILED: $f" >&2; exit 1; }
done
echo "Local database '$DB' ready ($(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations)."
