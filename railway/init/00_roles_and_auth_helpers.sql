-- ---------------------------------------------------------------------------
-- 00_roles_and_auth_helpers.sql — prerequisites the 27 app migrations assume.
--
-- Owns: the roles and the `auth.*` claim-reader functions that hosted Supabase
-- provides implicitly. This runs ONCE, BEFORE any migration in
-- supabase/migrations/. Without it, every migration referencing `auth.uid()`
-- (30 references across the policy set) fails, and `grant ... to authenticated`
-- errors on an undefined role.
--
-- Written to be fully idempotent so re-running it during a retry is safe.
--
-- The supabase/postgres image already creates most of this. This file exists so
-- the stack does not silently depend on undocumented image internals — if that
-- image changes, the migrations still have solid ground to stand on.
-- ---------------------------------------------------------------------------

-- --- Extensions the app migrations rely on --------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid(), digest()
create extension if not exists "uuid-ossp";

-- --- Roles ----------------------------------------------------------------
-- These three names are a hard contract with PostgREST: it runs
-- `set local role <role>` from the JWT's `role` claim, and every RLS policy in
-- supabase/migrations/ is written against these exact names.
--
--   anon          — unauthenticated callers (signed-out browser)
--   authenticated — any signed-in user; RLS narrows what they actually see
--   service_role  — BYPASSES RLS; Edge Functions only
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- bypassrls is what makes the service-role Edge Function client work.
    create role service_role nologin noinherit bypassrls;
  end if;
  -- The PostgREST connection role, which switches into the three above.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- --- auth schema ----------------------------------------------------------
-- GoTrue owns auth.users and manages its own migrations there. We only ensure
-- the schema exists so the helper functions below can be created before GoTrue's
-- first boot (ordering between containers is not guaranteed).
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- --- Claim readers --------------------------------------------------------
-- PostgREST places the verified JWT payload into the `request.jwt.claims` GUC for
-- the duration of the transaction. These functions read it. They are the entire
-- bridge between "a signed-in HTTP request" and "an RLS policy decision", so the
-- security of all 100 policies rests on them.
--
-- SECURITY: these are intentionally NOT `security definer`. They only read a
-- request-scoped setting and must never gain privileges of their own.
--
-- `current_setting(..., true)` returns NULL rather than raising when the GUC is
-- unset — that is what makes signed-out requests evaluate policies as NULL (deny)
-- instead of erroring out.

-- Full verified JWT payload for the current request, or NULL if unauthenticated.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- The signed-in user's id (the JWT `sub` claim), or NULL when signed out.
-- This is the single most-referenced function in the policy set.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- The Postgres role claimed by the current request ('anon' | 'authenticated' | …).
create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    ),
    ''
  )::text
$$;

-- The signed-in user's email, used by a few policies/views.
create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.email', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
    ),
    ''
  )::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- --- storage schema -------------------------------------------------------
-- storage-api runs its own migrations to create storage.buckets/objects, but
-- migration 0008 inserts the 'media' bucket AND defines an RLS policy on
-- storage.objects. Ensure the schema is grantable so 0008 can apply.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

-- --- Realtime publication -------------------------------------------------
-- useRealtimeRefresh.ts subscribes to postgres_changes, which requires the
-- tables to be in this publication. Created empty here; the app migrations (or
-- a follow-up) add specific tables. Deliberately NOT `for all tables`: that
-- would stream every change, including DM-only rows, to the Realtime service.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
