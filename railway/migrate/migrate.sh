#!/bin/sh
# ---------------------------------------------------------------------------
# migrate.sh — applies supabase/migrations/*.sql to the self-hosted Postgres.
#
# Owns: ordered, once-only application of migration files, plus the two things
# that MUST happen after any new table appears (the grant sweep and a PostgREST
# schema reload). Runs as an on-demand Railway service: redeploying it is what
# triggers a run (see railway/DEPLOY.md §9).
#
# WHY THIS EXISTS: after the Phase 6 cutover, production is the Railway stack,
# which has no public database endpoint by design. Without this, every schema
# change needs a temporary TCP proxy opened by hand — a manual step in front of
# every migration, which is exactly where "we forgot to apply it" comes from.
# See QA/6_tests/ and the 0023 drift incident.
#
# DESIGN NOTES
#
# Tracking table: `supabase_migrations.schema_migrations`, deliberately the same
# schema/table the Supabase CLI uses, so that reaching for the CLI later agrees
# with what this script recorded rather than trying to replay everything.
#
# Baseline: the Railway database already had all 27 migrations applied (by hand,
# during 6.1/6.2) with nothing recording that fact. So on a database that is
# already provisioned but untracked, the first run RECORDS the existing files
# WITHOUT executing them. Re-running 27 migrations against live data is not
# something to leave to luck about whether each one happens to be idempotent.
# A genuinely empty database runs everything instead. The two cases are
# distinguished by whether `public.campaigns` exists, and the choice is logged
# loudly because silently picking the wrong one would be severe.
#
# Grant sweep: runs on EVERY invocation, not just when migrations applied. No
# migration issues a table GRANT — hosted Supabase supplied those as project
# defaults — so a new table arrives readable by nobody and the app 401s on it.
# This is the single most expensive lesson of Phase 6.1; keeping the sweep
# unconditional means a new table cannot ship ungranted.
#
# Idempotent by construction: safe to redeploy at any time. With nothing new to
# do it re-runs the grant sweep, reloads the schema cache, and exits 0.
# ---------------------------------------------------------------------------
set -eu

: "${MIGRATE_DB_URL:?MIGRATE_DB_URL is required}"

MIGRATIONS_DIR=/migrations
GRANTS_FILE=/scripts/90_grant_app_privileges.sql
REAPPLY_FILE=/scripts/91_reapply_deletions.sql

# All DDL goes through one connection with ON_ERROR_STOP so a failed statement
# fails the deploy rather than leaving the schema half-applied.
psqlq() { psql -v ON_ERROR_STOP=1 -qtAX "$MIGRATE_DB_URL" "$@"; }

echo "migrate: connecting"
WHOAMI=$(psqlq -c "select current_user || ' (superuser=' || (select usesuper from pg_user where usename = current_user) || ')'")
echo "migrate: connected as $WHOAMI"

# --- Tracking table -------------------------------------------------------
psqlq -c "create schema if not exists supabase_migrations;
          create table if not exists supabase_migrations.schema_migrations (
            version    text primary key,
            name       text,
            applied_at timestamptz not null default now()
          );" >/dev/null

# --- Baseline decision ----------------------------------------------------
# Only reached when the tracking table was absent until a moment ago; `count`
# is therefore 0 on both a fresh database and an already-provisioned one, which
# is exactly why the provisioned case needs its own detection.
TRACKED=$(psqlq -c "select count(*) from supabase_migrations.schema_migrations")
PROVISIONED=$(psqlq -c "select count(*) from pg_tables where schemaname='public' and tablename='campaigns'")

BASELINE=no
if [ "$TRACKED" = "0" ] && [ "$PROVISIONED" != "0" ]; then
  BASELINE=yes
  echo "migrate: ================================================================"
  echo "migrate: BASELINING. public.campaigns exists but no migrations are"
  echo "migrate: recorded, so this database was provisioned by hand. Existing"
  echo "migrate: migration files will be RECORDED AS APPLIED WITHOUT RUNNING."
  echo "migrate: Only files added after this run will actually execute."
  echo "migrate: ================================================================"
elif [ "$TRACKED" = "0" ]; then
  echo "migrate: empty database — every migration will be applied for real"
fi

# --- Apply ----------------------------------------------------------------
# `sort` on the numeric filename prefix is the ordering contract: 0001_… before
# 0030_…. Zero-pad new migrations to keep it lexicographic.
APPLIED=0
SKIPPED=0
for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  base=$(basename "$f")
  version=$(echo "$base" | cut -d_ -f1)

  already=$(psqlq -c "select count(*) from supabase_migrations.schema_migrations where version = '$version'")
  if [ "$already" != "0" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$BASELINE" = "yes" ]; then
    echo "migrate: baseline  $base (recorded, NOT run)"
  else
    echo "migrate: applying  $base"
    # --single-transaction: a migration either lands whole or not at all, so a
    # failure never leaves a partially-migrated schema to unpick by hand.
    psql -v ON_ERROR_STOP=1 -qX --single-transaction "$MIGRATE_DB_URL" -f "$f"
  fi

  psqlq -c "insert into supabase_migrations.schema_migrations (version, name)
            values ('$version', '$base') on conflict (version) do nothing" >/dev/null
  APPLIED=$((APPLIED + 1))
done

echo "migrate: $APPLIED new, $SKIPPED already recorded"

# --- Grants (ALWAYS) ------------------------------------------------------
# Deliberately unconditional; see the header. The script ends in two assertions
# that return no rows when correct, so a missing grant or an RLS-disabled table
# fails this deploy instead of silently reaching production.
if [ -f "$GRANTS_FILE" ]; then
  echo "migrate: applying grant sweep"
  psql -v ON_ERROR_STOP=1 -qX "$MIGRATE_DB_URL" -f "$GRANTS_FILE"
else
  echo "migrate: WARNING — $GRANTS_FILE missing; new tables may be unreadable" >&2
fi

# --- RLS assertion --------------------------------------------------------
# The highest-risk failure in this stack: a table that arrives with RLS disabled
# fails OPEN — the app looks normal while every DM note is world-readable to any
# signed-in user. Nothing visibly breaks, so it must be asserted explicitly.
UNPROTECTED=$(psqlq -c "select coalesce(string_agg(c.relname, ', '), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
if [ -n "$UNPROTECTED" ]; then
  echo "migrate: FAILED — public tables with RLS DISABLED: $UNPROTECTED" >&2
  echo "migrate: these fail OPEN. Add 'alter table … enable row level security'." >&2
  exit 1
fi
echo "migrate: RLS check OK — every public table has RLS enabled"

# --- Function privilege assertion ----------------------------------------
# The mirror image of the RLS check, and an easier mistake to make. A new TABLE
# starts with no privileges; a new FUNCTION starts EXECUTABLE BY PUBLIC, and this
# stack's init additionally grants execute on functions to `authenticated` BY
# NAME via default privileges. So `revoke … from public` — the pattern used at
# the end of migrations 0009 and 0030 — does NOT lock a function down, while
# reading exactly as though it does.
#
# Found 2026-08-21: an authenticated player could call account_deletion_targets
# with someone else's user id and receive their Storage paths. The grant sweep
# re-revokes these on every run; this asserts the result.
LEAKY=$(psqlq -c "select coalesce(string_agg(p.proname, ', '), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('campaign_entitlements', 'account_deletion_targets',
                      'lapse_sweep_targets', 'record_lapse_warning',
                      'refresh_lapse_state')
    and has_function_privilege('authenticated', p.oid, 'execute')")
if [ -n "$LEAKY" ]; then
  echo "migrate: FAILED — service-role-only functions executable by authenticated: $LEAKY" >&2
  echo "migrate: these answer without any membership check. Revoke from anon and" >&2
  echo "migrate: authenticated BY NAME — 'revoke from public' does not do it." >&2
  exit 1
fi
echo "migrate: function privilege check OK — no service-role-only function is public"

# --- Re-apply erasures (ALWAYS) -------------------------------------------
# Backups include auth.users, so restoring one taken before a deletion brings the
# person back — password hash included — silently undoing a right-to-erasure
# request. A post-restore checklist would hold right up until the restore that
# happens mid-incident, which is exactly when a step gets skipped. Running it on
# every deploy means the next thing anyone does re-applies the erasure.
#
# Idempotent: normally matches nothing. See railway/scripts/91_reapply_deletions.sql.
if [ -f "$REAPPLY_FILE" ]; then
  psql -v ON_ERROR_STOP=1 -qX "$MIGRATE_DB_URL" -f "$REAPPLY_FILE"
  RESURRECTED=$(psqlq -c "select case when to_regclass('public.deleted_accounts') is null then ''
    else coalesce((select string_agg(d.user_id::text, ', ')
                   from public.deleted_accounts d
                   join auth.users u on u.id = d.user_id), '') end")
  if [ -n "$RESURRECTED" ]; then
    echo "migrate: FAILED — accounts that were erased are still present: $RESURRECTED" >&2
    exit 1
  fi
  echo "migrate: erasure check OK — no deleted account has been resurrected"
fi

# --- PostgREST schema cache ----------------------------------------------
# Without this a new table or column 404s ("relation does not exist") until
# PostgREST happens to restart, which reads as a broken migration.
psqlq -c "notify pgrst, 'reload schema'" >/dev/null
echo "migrate: PostgREST schema reload requested"

echo "migrate: done"
