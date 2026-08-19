#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 62_dump_source.sh — Phase 6.2 step 1: pull data out of the hosted project.
#
# Owns: producing the three artifacts the restore step consumes, into
# railway/migrate-out/ (gitignored). Read-only against the source — it opens no
# transaction that writes and issues no DDL.
#
# Deliberately DATA ONLY. The schema on the new stack comes from replaying
# supabase/migrations/, which keeps those 27 files the single source of truth;
# dumping the hosted schema instead would let the two drift silently and is how
# a policy goes missing without anyone noticing.
#
# Artifacts:
#   public_data.sql   — all 29 public tables, data only
#   auth_users.csv    — auth.users, column-intersected (see below)
#   auth_columns.txt  — which columns that intersection actually covered
#
# The media objects are NOT handled here; they move through the Storage API in
# 62_migrate_media.sh so that storage.objects rows are written by the service
# that owns them.
#
# Usage: railway/scripts/62_dump_source.sh
# Reads: railway/.env.migrate (SOURCE_DB_URL). Never echoes it.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -f railway/.env.migrate ]; then
  echo "error: railway/.env.migrate not found. Copy .env.migrate.example and fill it in." >&2
  exit 1
fi
set -a; . railway/.env.migrate; set +a
: "${SOURCE_DB_URL:?SOURCE_DB_URL is empty in railway/.env.migrate}"

OUT=railway/migrate-out
mkdir -p "$OUT"

# --- 1. public schema, data only ------------------------------------------
# --no-owner / --no-privileges: the hosted project's role names do not exist on
#   the self-hosted stack, and privileges there come from
#   90_grant_app_privileges.sql. Keeping them out avoids a restore full of
#   "role does not exist" errors.
# --disable-triggers: the restore must insert rows exactly as they are. Without
#   this, insert triggers re-fire — most importantly the one that creates a
#   `profiles` row per new user, which would collide with the profiles rows
#   being restored. It also sidesteps FK ordering between the 29 tables.
# --column-inserts is NOT used: COPY is far faster and the column set is
#   identical on both sides, since both come from the same 27 migrations.
echo "==> dumping public data"
pg_dump "$SOURCE_DB_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --schema=public \
  --file="$OUT/public_data.sql"

# --- 2. auth.users, column-by-column --------------------------------------
# GoTrue owns auth.users and its columns vary between versions, so a blind copy
# is a version-coupling bug waiting to happen: the source is hosted Supabase's
# GoTrue, the target is v2.170.0, and they need not agree.
#
# Instead, intersect the source's column list with the target's and move only
# what both understand. `id` is in that set, which is what preserves UUIDs —
# every FK in the app points at auth.users(id), so a regenerated id orphans a
# user's entire campaign history. `encrypted_password` is in it too, which is
# what keeps existing bcrypt passwords working.
echo "==> reading target auth.users columns"
TARGET_DB="postgres://postgres:${POSTGRES_PASSWORD:-}@localhost:54322/postgres"
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  set -a; . railway/.env.stack; set +a
  TARGET_DB="postgres://postgres:${POSTGRES_PASSWORD}@localhost:54322/postgres"
fi

# Generated columns are excluded, not merely renamed-around: GoTrue v2.170.0
# defines auth.users.confirmed_at as `generated always`, and Postgres refuses to
# COPY into one at all ("Generated columns cannot be used in COPY"). Its value is
# derived from confirmed/email_confirmed_at, which ARE copied, so nothing is
# lost. Filtering on writability rather than on a hard-coded exclusion list means
# a future GoTrue that generates another column does not break this again.
TARGET_COLS=$(psql "$TARGET_DB" -tAc \
  "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
   from information_schema.columns
   where table_schema='auth' and table_name='users'
     and is_generated = 'NEVER'
     and is_identity  = 'NO'")

if [ -z "$TARGET_COLS" ]; then
  echo "error: target auth.users has no columns — is the local stack up and has GoTrue booted?" >&2
  exit 1
fi

# Ask the SOURCE which of those it also has. Anything the target has but the
# source does not simply keeps its default on insert.
COLS=$(psql "$SOURCE_DB_URL" -tAc \
  "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
   from information_schema.columns
   where table_schema='auth' and table_name='users'
     and column_name = any (string_to_array('$(echo "$TARGET_COLS" | tr -d '\"')', ','))")

: "${COLS:?could not compute a shared column set for auth.users}"
printf '%s\n' "$COLS" > "$OUT/auth_columns.txt"

echo "==> dumping auth.users"
psql "$SOURCE_DB_URL" -c "\copy (select $COLS from auth.users order by created_at) to '$OUT/auth_users.csv' with (format csv, header true)"

# --- 3. Baseline counts for the 6.2.2 gate --------------------------------
# Captured from the source at dump time so the post-restore comparison is
# against the same instant, not against numbers typed into a doc earlier.
echo "==> capturing row-count baseline"
psql "$SOURCE_DB_URL" -tAc "
select c.relname || ',' || (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r' order by 1" > "$OUT/source_counts.csv"

psql "$SOURCE_DB_URL" -tAc \
  "select name from storage.objects order by name" > "$OUT/source_objects.txt"

echo
echo "done. artifacts in $OUT:"
ls -lh "$OUT"
echo
echo "auth.users columns carried over: $(tr ',' '\n' < "$OUT/auth_columns.txt" | wc -l | tr -d ' ')"
echo "public tables:  $(wc -l < "$OUT/source_counts.csv" | tr -d ' ')"
echo "storage objects: $(wc -l < "$OUT/source_objects.txt" | tr -d ' ')"
