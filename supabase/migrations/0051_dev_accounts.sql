-- ============================================================================
-- 0051_dev_accounts.sql — Phase 9.1a.1: who may see the dev-only test tooling.
--
-- Backs the "view as player" toggle and the other test conveniences. Answers
-- exactly one question, for exactly one caller: *am I a dev account?*
--
-- ============================================================================
-- WHY NOT `profiles.is_dev`, which is the obvious design.
--
-- `profiles_update_own` (migration 0002) lets a user update THEIR OWN ROW. A
-- boolean column there would therefore be self-service: any account could set
-- `is_dev = true` on itself. A permission flag anyone can grant themselves is
-- worse than no flag, because it looks like a control.
--
-- So the list lives in `private`, which PostgREST cannot see at all, with RLS
-- enabled and NO policies — the same shape as `trial_redemptions` and
-- `deleted_accounts`. No client role can read it, write it, or learn it exists.
--
-- ============================================================================
-- WHAT THIS GATE IS AND IS NOT.
--
-- The tooling it guards only ever makes the caller see LESS of their own data —
-- a DM rendering their campaign as a player would see it. It cannot escalate
-- anything, so this is **not a security boundary**; it keeps a development
-- control out of the way of ordinary users. Recorded so nobody later mistakes it
-- for protection it was never providing.
--
-- The real gate is `import.meta.env.DEV`, which keeps the code out of production
-- bundles entirely. Absent code cannot be re-enabled from a console.
-- ============================================================================

create table private.dev_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Why this account is on the list. A bare uuid in a table nobody can read is
  -- unidentifiable six months later.
  note text,
  added_at timestamptz not null default now()
);

comment on table private.dev_accounts is
  'Accounts that may see the dev-only test tooling (Phase 9.1a). In `private` so '
  'it is unreachable over PostgREST; RLS enabled with NO policies, so no client '
  'role can read or write it. Managed by SQL, never by a deploy and never from '
  'the app. NOT a security boundary — see migration 0051.';

alter table private.dev_accounts enable row level security;
-- (No policies, deliberately. Default-deny for every client role.)

-- ----------------------------------------------------------------------------
-- The only thing a client may ask.
--
-- Takes NO ARGUMENT, on purpose: a `is_dev_account(uuid)` could be used to probe
-- whether any given account is on the list. This can answer only about the
-- caller, and only with a boolean — never the list itself.
-- ----------------------------------------------------------------------------
create function public.is_dev_account()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.dev_accounts d where d.user_id = (select auth.uid())
  );
$$;

comment on function public.is_dev_account() is
  'True when the CALLER is a dev account. Takes no argument so it cannot be used '
  'to probe other users, and returns a boolean rather than the list. Gates the '
  'dev-only test tooling (Phase 9.1a).';

-- A new function is EXECUTE-able by PUBLIC, and this project's default
-- privileges additionally grant EXECUTE to `authenticated` BY NAME — so
-- `revoke ... from public` alone restricts nothing (the trap that leaked
-- campaign_entitlements and account_deletion_targets). Revoking by name first,
-- then granting deliberately.
revoke execute on function public.is_dev_account() from public, anon, authenticated;
grant execute on function public.is_dev_account() to authenticated;

-- ----------------------------------------------------------------------------
-- Seed: EXACTLY ONE account (owner decision, 2026-08-28).
--
-- By EMAIL rather than a hardcoded uuid, so this still means something on a
-- restored database or a fresh environment — and matches nothing, harmlessly,
-- where that account does not exist.
-- ----------------------------------------------------------------------------
insert into private.dev_accounts (user_id, note)
select u.id, 'Project owner — sole dev account (0051)'
from auth.users u
where lower(u.email::text) = 'ejcaldwell06@gmail.com'
on conflict (user_id) do nothing;
