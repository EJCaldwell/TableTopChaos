#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 62_restore_local.sh — Phase 6.2 step 2: load the dump into the local stack.
#
# Owns: restoring auth.users and then the 29 public tables, in that order, and
# proving the row counts match the source afterwards.
#
# ORDER MATTERS. Every campaign, profile and character FKs to auth.users(id), so
# users go first or the public restore fails wholesale on foreign keys.
#
# Assumes the local stack is up and the 27 migrations have been replayed
# (Phase 6.1). It does NOT create the schema — see 62_dump_source.sh for why the
# migration files stay the only source of schema truth.
#
# Idempotency: this is a load into an EMPTY database, not a merge. Re-running it
# over existing rows will fail on primary keys, which is deliberate — a restore
# that silently half-applies is worse than one that stops. To retry, recreate the
# stack (`down -v`), replay migrations, re-run the grant pass, then run this.
#
# Usage: railway/scripts/62_restore_local.sh
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."

set -a; . railway/.env.stack; set +a
DB="postgres://postgres:${POSTGRES_PASSWORD}@localhost:54322/postgres"
OUT=railway/migrate-out

for f in "$OUT/public_data.sql" "$OUT/auth_users.csv" "$OUT/auth_columns.txt" "$OUT/source_counts.csv"; do
  [ -f "$f" ] || { echo "error: missing $f — run 62_dump_source.sh first" >&2; exit 1; }
done

COLS=$(cat "$OUT/auth_columns.txt")

# --- Refuse to run against a non-empty database ---------------------------
# Cheap guard against the worst outcome here: a partial second restore leaving
# the row counts plausible but the data doubled.
EXISTING=$(psql "$DB" -tAc "select count(*) from auth.users")
if [ "$EXISTING" != "0" ]; then
  echo "error: auth.users already has $EXISTING rows. Recreate the stack before restoring." >&2
  exit 1
fi

# --- 1. auth.users --------------------------------------------------------
# UUIDs come across verbatim; see 62_dump_source.sh for why that is the single
# most important property of this whole subphase.
#
# Triggers are disabled for the duration. `handle_new_user` fires on insert into
# auth.users and creates a `profiles` row for each — which then collides with
# the real profiles rows in public_data.sql:
#   duplicate key value violates unique constraint "profiles_pkey"
# The trigger's job is to bootstrap a NEW signup; during a restore the profile
# already exists and carries the display name, so letting it fire would both
# break the load and lose data. This mirrors what pg_dump --disable-triggers
# does for the public tables, and needs superuser — hence connecting as
# `postgres`, which 01_stack_login_roles.sh creates as one.
echo "==> restoring auth.users"
psql "$DB" -v ON_ERROR_STOP=1 <<SQL
begin;
alter table auth.users disable trigger all;
\copy auth.users ($COLS) from '$OUT/auth_users.csv' with (format csv, header true)
alter table auth.users enable trigger all;
commit;
SQL

# --- 2. public data -------------------------------------------------------
# The dump carries --disable-triggers, which requires superuser on the target;
# we connect as `postgres`, which 01_stack_login_roles.sh created as one.
#
# VERSION GAP: the source is PostgreSQL 17.6 (hosted) and this stack is pinned to
# 15.8, so pg_dump emits preamble GUCs that 15 does not recognise — currently
# `SET transaction_timeout = 0`, which aborts the restore on line 13 with
# "unrecognized configuration parameter". These are session settings in the
# header, not data, so dropping them changes nothing that gets inserted.
#
# This is a WORKAROUND, not the fix. The real fix is pinning this stack to a
# Postgres 17 image so the two majors match; tracked for 6.3. Each new major
# adds preamble GUCs, so the filter below will need revisiting until that
# happens — which is precisely the argument for closing the gap instead.
echo "==> restoring public data"
UNSUPPORTED='^SET (transaction_timeout)'
STRIPPED=$(grep -Ec "$UNSUPPORTED" "$OUT/public_data.sql" || true)
[ "$STRIPPED" -gt 0 ] && echo "    (stripped $STRIPPED preamble GUC(s) unknown to this server)"
grep -Ev "$UNSUPPORTED" "$OUT/public_data.sql" \
  | psql "$DB" -v ON_ERROR_STOP=1 > /dev/null

# --- 3. PostgREST schema cache -------------------------------------------
# Not strictly needed after a data-only load, but free, and a stale cache is the
# failure that cost the most time in 6.1.
psql "$DB" -c "notify pgrst, 'reload schema'" > /dev/null

# --- 4. Gate: per-table row counts must match the source ------------------
echo
echo "==> comparing row counts against the source"
psql "$DB" -tAc "
select c.relname || ',' || (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r' order by 1" > "$OUT/target_counts.csv"

if diff -u "$OUT/source_counts.csv" "$OUT/target_counts.csv" > "$OUT/counts.diff"; then
  echo "PASS — all table counts match ($(wc -l < "$OUT/source_counts.csv" | tr -d ' ') tables)."
else
  echo "FAIL — counts differ:"
  cat "$OUT/counts.diff"
  exit 1
fi

USERS=$(psql "$DB" -tAc "select count(*) from auth.users")
echo "auth.users restored: $USERS"
echo
echo "Media objects are NOT migrated by this script — run 62_migrate_media.sh next."
