-- ---------------------------------------------------------------------------
-- 90_grant_app_privileges.sql — run ONCE, AFTER replaying supabase/migrations/.
--
-- Owns: the table/sequence privileges that hosted Supabase provides as project
-- defaults and that none of the 27 migrations issues for itself. Without these
-- the whole stack boots green and then fails every query with
-- "permission denied for table campaigns" — for signed-in users too, because
-- Postgres checks table privileges BEFORE it evaluates an RLS policy.
--
-- Belt-and-braces with the `alter default privileges` in
-- railway/init/01_stack_login_roles.sh: that covers tables created after init,
-- this sweeps whatever exists right now. Running both means a table is covered
-- whether it was created by the migration replay, by a restore, or by hand.
-- Idempotent — safe to re-run at any point.
--
-- SECURITY: `anon` genuinely does get table access here, exactly as on hosted
-- Supabase. RLS is the access-control layer; a privilege is permission to be
-- *evaluated by a policy*, not permission to read rows. This is safe only while
-- every table in `public` has RLS enabled — assert that (the 6.5.2 gate) rather
-- than assume it. The `private` schema is deliberately NOT granted: its helper
-- functions are reached via the EXECUTE grants the migrations already issue,
-- and its tables must stay unreachable from PostgREST.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- Keep future migrations covered even if they are applied by a different role.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- --- storage schema --------------------------------------------------------
-- storage-api creates these tables itself on first boot, so they miss the
-- `alter default privileges` set for `postgres` in the init script and arrive
-- with no grants for the app roles at all.
--
-- The symptom is badly misleading and cost real time in 6.2: every upload
-- returns `new row violates row-level security policy`, which reads as a policy
-- problem. It is not. The storage-api log shows the true error — SQLSTATE 42501
-- on `select id, file_size_limit, allowed_mime_types from buckets` — i.e.
-- permission denied on storage.buckets while merely *looking up the bucket*,
-- which storage-api then reports as an RLS failure on objects. Do not go
-- hunting through migration 0008's policy when you see that message; check
-- these grants first.
--
-- Privileges below mirror hosted Supabase exactly (verified against the live
-- project 2026-08-18): full access on buckets/objects for all three roles, and
-- multipart tables writable only by service_role.
--
-- SECURITY: as in `public`, a grant here is permission to be *evaluated by a
-- policy*, not permission to read. `storage.objects` has RLS on with migration
-- 0008's member-only SELECT policy, and it defines no INSERT/UPDATE/DELETE
-- policy at all — so an authenticated caller still cannot write objects
-- directly; only service_role (which bypasses RLS) can, via the Edge Function.
grant all on storage.buckets, storage.objects
  to anon, authenticated, service_role;

grant all    on storage.s3_multipart_uploads, storage.s3_multipart_uploads_parts
  to service_role;
grant select on storage.s3_multipart_uploads, storage.s3_multipart_uploads_parts
  to anon, authenticated;

-- --- Service-role-only FUNCTIONS -------------------------------------------
-- Functions are the mirror image of tables here, and the asymmetry is a trap:
--   * a new TABLE starts with NO privileges, so it must be granted;
--   * a new FUNCTION starts EXECUTABLE BY PUBLIC, so it must be revoked.
-- On top of that, this stack's init sets
--     alter default privileges … grant execute on functions
--       to anon, authenticated, service_role;
-- so every new function ALSO gets a grant held by `authenticated` **by name**.
-- `revoke … from public` does not touch a named-role grant, which is why the
-- revokes at the end of migrations 0009 and 0030 read as though they locked
-- those functions down while leaving them callable by any signed-in user.
--
-- Discovered 2026-08-21: an authenticated player could call
-- account_deletion_targets with another user's id and get their Storage paths,
-- and campaign_entitlements for a campaign they were not a member of. See
-- migration 0031.
--
-- Re-applied on EVERY migrate run, deliberately: default privileges re-grant
-- execute at creation time, so this has to be a standing sweep rather than a
-- one-off migration, or the next new function re-opens the hole.
--
-- To add a function here it must be one that does NOT check the caller's
-- identity — i.e. it takes an id and answers without a membership test. A
-- function that reads auth.uid() and describes only the caller (such as
-- account_deletion_preview) belongs to `authenticated` and must NOT be listed.
do $$
declare
  fn text;
  service_only text[] := array[
    'campaign_entitlements(uuid)',  -- 0009: arbitrary campaign id, no membership check
    'lapse_sweep_targets()',        -- 0036: returns every lapsed owner's EMAIL
    'record_lapse_warning(uuid,int)', -- 0036: writing it unlocks deletion
    'refresh_lapse_state()'         -- 0036: writes read_only_since on every campaign
  ];
begin
  foreach fn in array service_only loop
    -- to_regprocedure returns null rather than raising if the function is absent,
    -- so a dropped function does not fail the whole sweep.
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end $$;

-- --- Verification ----------------------------------------------------------
-- Any function here is callable by a signed-in user despite being service-role
-- only. Expected output: no rows. This is informational when the file is run by
-- hand; the enforcing copy of this check lives in railway/migrate/migrate.sh,
-- which exits non-zero so a bad deploy actually fails.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         as service_only_function_executable_by_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('campaign_entitlements', 'account_deletion_targets',
                    'lapse_sweep_targets', 'record_lapse_warning',
                    'refresh_lapse_state')
  and has_function_privilege('authenticated', p.oid, 'execute');

-- Any table listed here is unreachable from the app. Expected output: no rows.
select c.relname as table_without_authenticated_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not has_table_privilege('authenticated', c.oid, 'select');

-- Any table listed here fails OPEN — privileges granted, no RLS to narrow them.
-- This is the highest-risk failure mode of the whole migration. Expected: none.
select c.relname as table_granted_but_rls_disabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
