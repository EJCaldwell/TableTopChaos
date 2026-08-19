#!/bin/bash
# ---------------------------------------------------------------------------
# 01_stack_login_roles.sh — give the stack's connection roles a password.
#
# Owns: the two LOGIN roles every other service authenticates as. Runs once, on
# an empty volume, immediately after 00_roles_and_auth_helpers.sql.
#
# WHY THIS EXISTS (found during the 6.1 pre-flight, 2026-08-18):
# `supabase/postgres:15.8.1.060` does NOT match the assumptions the compose file
# was written against. Verified against a fresh volume:
#   - its superuser is `supabase_admin`, and there is **no `postgres` role at
#     all** — so GoTrue, storage-api and realtime, which all connect as
#     `postgres://postgres:...`, crashloop on "password authentication failed".
#   - it pre-creates `anon` / `authenticated` / `service_role` / `authenticator`,
#     but `authenticator` has **no password** ("User \"authenticator\" has no
#     password assigned") — so PostgREST crashloops too.
# Only POSTGRES_PASSWORD is applied to `supabase_admin`.
#
# The fix is deliberately here rather than in docker-compose.yml: repointing
# every service at `supabase_admin` would put four services on the image's own
# superuser and fork this stack from the documented Supabase self-host layout.
# Creating the roles the services already expect keeps compose, the Railway
# service variables and the runbook's psql commands all reading the same way.
#
# A .sh (not .sql) because the password lives in an env var, and passing it
# through psql's `-v` + `:'pw'` quoting is the only injection-safe way to get it
# into a role statement. Idempotent, so a retry on a half-initialised volume is
# safe.
#
# SECURITY: `postgres` is created as a superuser because GoTrue and storage-api
# each create and migrate their own schema (auth.*, storage.*) on first boot.
# `authenticator` is deliberately left as the unprivileged NOINHERIT role it
# already is — it only ever switches into anon/authenticated/service_role, and
# giving it rights of its own would bypass every RLS policy in the app.
# ---------------------------------------------------------------------------
set -euo pipefail

# Two ways in, because this file has two callers:
#   - Docker: run automatically by the postgres entrypoint, which supplies
#     POSTGRES_USER/POSTGRES_DB and a local socket.
#   - Railway: run by hand from a laptop, where there is no socket and the only
#     route is the TCP proxy. Set PSQL_DSN to that connection string.
# Railway does not execute docker-entrypoint-initdb.d at all, so without this
# the roles would simply never be created there — and every other service would
# crashloop on password authentication with nothing explaining why.
if [ -n "${PSQL_DSN:-}" ]; then
  psql() { command psql -v ON_ERROR_STOP=1 "$PSQL_DSN" "$@"; }
else
  psql() { command psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"; }
fi

# NOTE: the SQL goes in on stdin, not via `-c`. psql only substitutes `:'var'`
# when it parses the script itself; with `-c` the string is sent to the server
# verbatim and Postgres reports a syntax error at the literal `:'pw'`.
if [ -z "$(psql -tAc "select 1 from pg_roles where rolname = 'postgres'")" ]; then
  # --- postgres: the role the four service DSNs connect as -----------------
  psql -v pw="$POSTGRES_PASSWORD" <<'SQL'
create role postgres with login superuser createdb createrole password :'pw';
SQL
else
  psql -v pw="$POSTGRES_PASSWORD" <<'SQL'
alter role postgres with login superuser password :'pw';
SQL
fi

# --- authenticator: PostgREST's connection role ----------------------------
# Created without a password by the image; PGRST_DB_URI supplies one.
# The grant is re-asserted from 00_*.sql — harmless if already present, and it
# keeps this script correct if the image's role set changes again.
psql -v pw="$POSTGRES_PASSWORD" <<'SQL'
alter role authenticator with login password :'pw';
grant anon, authenticated, service_role to authenticator;
SQL

# --- Default privileges on everything the migrations are about to create ----
# Hosted Supabase ships these as project defaults, so none of the 27 migrations
# issues a table GRANT — they only grant EXECUTE on functions. Without this the
# stack boots perfectly and then 401s **every** query with "permission denied
# for table campaigns", for signed-in users as well as anon, because RLS is
# never even reached: table privileges are checked first.
#
# Default privileges are per-creating-role, so this must name `postgres` — the
# role the migration replay connects as. It applies only to tables created
# AFTER this runs; anything already present is covered by the explicit sweep in
# railway/scripts/90_grant_app_privileges.sql.
#
# SECURITY: granting `anon` table access is correct and is what hosted Supabase
# does — RLS is the access-control layer, and a signed-out caller reaching a
# table still has to satisfy a policy. It is only safe because every table in
# `public` has RLS enabled; the 6.5.2 gate asserts exactly that, and it is why
# realtime's un-policied tables are kept out of `public` (see 00_*.sql).
psql <<'SQL'
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
SQL

echo "01_stack_login_roles.sh: postgres + authenticator logins configured"
