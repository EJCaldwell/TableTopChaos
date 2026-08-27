-- ============================================================================
-- 0031_lock_service_role_functions.sql — close an EXECUTE over-grant on the
-- functions that are supposed to be service-role only.
--
-- WHAT WAS WRONG (found 2026-08-21 while QAing 7.1):
--   public.account_deletion_targets(uuid) — added minutes earlier in 0030 — and
--   public.campaign_entitlements(uuid) — shipped in 0009 — were both callable by
--   any ORDINARY SIGNED-IN USER, despite both migrations ending in
--   `revoke all on function … from public` + `grant execute … to service_role`.
--
--   Verified against the live stack: an authenticated player could call
--   account_deletion_targets with ANOTHER user's id and receive that user's
--   Storage paths, and could call campaign_entitlements for a campaign they are
--   not a member of and receive its storage usage and active status.
--
-- WHY THE REVOKE DID NOT HOLD. Two things compound:
--   1. Postgres grants EXECUTE on a new function to PUBLIC *by default* — the
--      opposite of tables, which start with no privileges. So a function is
--      world-executable the moment it is created.
--   2. `revoke … from public` removes only the PUBLIC grant. It does NOT remove a
--      grant held by a named role. The stack's init sets
--        alter default privileges … grant execute on functions
--          to anon, authenticated, service_role;
--      so `authenticated` receives its OWN execute grant at creation time, which
--      survives the revoke from PUBLIC untouched.
--
--   The two together mean **the revoke pattern used in 0009 and 0030 does not
--   actually restrict anything**, while reading as though it does. That is the
--   dangerous part: the intent was documented, asserted in a comment, and wrong.
--
-- THE FIX, in order of how much it is relied on:
--   1. DROP public.account_deletion_targets entirely. It was only ever called by
--      the delete-account Edge Function, which holds the service role and can
--      read the two tables directly. A privileged RPC that takes a user id and
--      reports on that account is a surface with no reason to exist — removing
--      it beats defending it.
--   2. Revoke EXECUTE from `anon` and `authenticated` BY NAME on the functions
--      that must stay service-role only.
--   3. railway/scripts/90_grant_app_privileges.sql now re-applies these revokes
--      and ASSERTS that no service-role-only function is executable by
--      authenticated. That runs on every `migrate` deploy, so a future migration
--      cannot silently re-open this: default privileges would grant execute
--      again at creation, and the sweep takes it away again.
--
-- Note private.account_owned_media stays: the `private` schema is not exposed to
-- PostgREST at all, which is the one protection here that does not depend on
-- getting a grant right.
-- ============================================================================

-- --- 1. Remove the RPC rather than defend it ------------------------------
-- The delete-account function now queries media_assets and campaign_subscriptions
-- directly with the service role (which bypasses RLS), so nothing calls this.
drop function if exists public.account_deletion_targets(uuid);

-- --- 2. Revoke by NAME, not just from PUBLIC ------------------------------
-- `from public` was the bug; these are the grants that were actually in force.
revoke execute on function public.campaign_entitlements(uuid) from anon, authenticated;
revoke execute on function public.campaign_entitlements(uuid) from public;
grant  execute on function public.campaign_entitlements(uuid) to service_role;

comment on function public.campaign_entitlements(uuid) is
  'service_role ONLY — takes an arbitrary campaign id and answers without any '
  'membership check, so `authenticated` must never hold EXECUTE. Revoking from '
  'PUBLIC alone is NOT enough: default privileges grant execute to anon and '
  'authenticated by name at creation time. See 0031 and the assertion in '
  'railway/scripts/90_grant_app_privileges.sql.';

-- --- 3. account_deletion_preview stays available to authenticated --------
-- Correct as-is: it takes NO arguments and reads auth.uid(), so a caller can
-- only ever describe their own account. `anon` is revoked because with no JWT
-- auth.uid() is null and every count is zero — a meaningless answer there is no
-- reason to serve.
revoke execute on function public.account_deletion_preview() from anon;
revoke execute on function public.account_deletion_preview() from public;
grant  execute on function public.account_deletion_preview() to authenticated;
