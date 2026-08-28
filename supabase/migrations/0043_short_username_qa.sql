-- ============================================================================
-- 0043_short_username_qa.sql — add `QA` to the short-name exception list and
-- rename the QA fixture account to it.
--
-- OWNER REQUEST (2026-08-27). Same mechanism as 0042: the 3-character minimum
-- stays for everyone, and `qa` joins the named exception list.
--
-- A NOTE ON WHERE THIS IS HEADING. Every addition here widens the general rule
-- to serve one account. Two entries is a list of exceptions; ten is a
-- 2-character minimum with extra steps, and at that point the honest move is to
-- lower the floor rather than keep the pretence. `qa` also differs from `ej` in
-- kind: `ej` is the owner's real handle, this one is a test fixture, so it
-- spends a permanent, global allowance on something disposable. A 3-character
-- fixture name (`QAP`, `QA1`) would have cost nothing. Recorded so the trade-off
-- is visible next time rather than rediscovered at entry six.
--
-- As in 0042: this grants LEGALITY, not ownership. `QA` is protected only
-- because the fixture account holds it and the unique index stops anyone else.
-- ============================================================================

create or replace function private.is_valid_username(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (
      -- The general rule: 3–20 characters, starting with a letter or digit.
      p_name ~ '^[A-Za-z0-9][A-Za-z0-9_]{2,19}$'
      -- Named exceptions to the MINIMUM only. Compared case-insensitively, to
      -- match how uniqueness works.
      --   ej — the owner's handle (0042)
      --   qa — the QA fixture account (0043)
      or lower(p_name) = any (array['ej', 'qa'])
    )
    -- Reserved words still apply to exceptions: the list buys a pass on LENGTH
    -- and nothing else.
    and not private.is_reserved_username(p_name);
$$;

-- Guarded by email rather than a hardcoded uuid, and skipped entirely if the
-- name has since been taken — a unique violation here would abort the migration
-- and, on a restore, block every later migration behind it.
update public.profiles p
   set username = 'QA',
       username_is_provisional = false
  from auth.users u
 where u.id = p.id
   and lower(u.email::text) = 'ejcaldwell.test@gmail.com'
   and not exists (
     select 1 from public.profiles q
     where lower(q.username) = 'qa' and q.id <> p.id
   );
