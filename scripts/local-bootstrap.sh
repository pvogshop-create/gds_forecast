#!/usr/bin/env bash
# Apply supabase/local-bootstrap.sql to the running local Supabase Postgres.
#
# Uses `docker exec` rather than psql because psql is not on PATH on this
# machine, and the Supabase CLI has no "run arbitrary SQL" subcommand. The
# container name is discovered rather than hardcoded — it is derived from the
# repo directory name, which changes when the folder is moved (and this folder
# does get moved; see CLAUDE.md).
set -euo pipefail

SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/local-bootstrap.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "error: $SQL_FILE not found" >&2
  exit 1
fi

CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -1)"

if [[ -z "$CONTAINER" ]]; then
  echo "error: no running supabase_db_* container found." >&2
  echo "       Start local Supabase first:  npx supabase start" >&2
  exit 1
fi

echo "Applying local-bootstrap.sql to ${CONTAINER} ..."
docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$SQL_FILE"
echo "Done. Local grants now match the hosted project's provisioning."
