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

-- --- Verification ----------------------------------------------------------
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
