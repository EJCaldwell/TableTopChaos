-- ===========================================================================
-- Migration 0002 — Auth: auto-create profiles + own-profile RLS policies.
--
-- Builds on 0001 (which created public.profiles with RLS enabled but NO
-- policies = default-deny). This migration:
--   1. Adds handle_new_user(): a trigger that creates the profile row whenever
--      a new auth.users row is inserted (i.e. on signup).
--   2. Opens the first two RLS policies on profiles: a user may read and update
--      ONLY their own row.
--
-- Still intentionally absent: any INSERT or DELETE policy on profiles. Rows are
-- created only by the SECURITY DEFINER trigger below (never by the client), and
-- deletion happens via ON DELETE CASCADE from auth.users during account
-- deletion (Phase 5.1). So default-deny still covers insert/delete.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Function: handle_new_user()
-- Runs AFTER INSERT on auth.users and inserts the matching public.profiles row.
--
-- SECURITY DEFINER: the function executes with the definer's (postgres) rights
-- so it can insert into profiles regardless of the caller's RLS — signups come
-- in as the anon role, which has no insert policy. This is the standard
-- Supabase pattern for provisioning app rows on signup.
--
-- search_path = '' hardens against search_path hijacking (advisor 0011); every
-- object is therefore schema-qualified (public.profiles, auth.users columns via
-- the NEW record). display_name is seeded from the signup metadata if provided
-- (supabase-js signUp `options.data.display_name`), else left NULL for the user
-- to set later on the profile screen.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Treat an empty-string display name the same as "not provided".
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT on auth.users: provisions the public.profiles row for a new signup. SECURITY DEFINER so it bypasses RLS; seeds display_name from signup metadata.';

-- Fire the provisioning function once per new auth user.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Because this is a SECURITY DEFINER function in the exposed `public` schema,
-- PostgREST would otherwise publish it as /rest/v1/rpc/handle_new_user, callable
-- by the anon/authenticated roles (advisors 0028/0029). Revoke EXECUTE so it can
-- only ever run as the AFTER INSERT trigger — trigger firing does not depend on
-- the caller holding EXECUTE, so signup provisioning is unaffected.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- RLS policy: profiles_select_own
-- A user may read only their own profile row. Wrapping auth.uid() in a scalar
-- subselect lets Postgres cache it as an initplan (evaluated once per query,
-- not once per row) — the recommended performance pattern for RLS.
-- ---------------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

comment on policy "profiles_select_own" on public.profiles is
  'Read own profile only: row is visible iff its id equals the caller''s auth.uid().';

-- ---------------------------------------------------------------------------
-- RLS policy: profiles_update_own
-- A user may update only their own profile. USING gates which existing rows are
-- updatable; WITH CHECK prevents changing id to point at someone else's row.
-- ---------------------------------------------------------------------------
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

comment on policy "profiles_update_own" on public.profiles is
  'Update own profile only: both the target row and the resulting row must have id = caller''s auth.uid().';
