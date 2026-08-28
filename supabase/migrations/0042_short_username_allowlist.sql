-- ============================================================================
-- 0042_short_username_allowlist.sql — a named exception to the 3-character
-- minimum, and the owner's handle.
--
-- OWNER REQUEST (2026-08-27): keep the general minimum at 3 characters, but let
-- the project owner's account hold `EJ`.
--
-- WHY AN ALLOWLIST RATHER THAN LOWERING THE MINIMUM. Dropping the floor to 2
-- would open every two-character handle at once — roughly 3,900 of them —
-- permanently and for everyone, to grant exactly one. The floor exists partly to
-- stop that land-grab before there is any reason to care who owns `l1`. An
-- explicit list of exceptions keeps the rule intact and makes each exception a
-- visible, deliberate decision in the schema rather than a side effect.
--
-- WHAT THIS DOES *NOT* DO — read before adding to the list. The allowlist makes
-- a short name LEGAL, not OWNED. It is claimable first-come like any other name.
-- What actually protects `EJ` is that the owner's account holds it from this
-- migration onward, and the unique index stops anyone else taking it while they
-- do. **If that account ever renames away from `EJ`, the name is immediately
-- claimable by anyone** — if that matters, move it to
-- private.is_reserved_username instead, which blocks it outright.
--
-- A CHECK constraint cannot look at other rows, so "only this one account may
-- use this name" is not expressible here; it would need a trigger. That is not
-- worth building for a single handle on a single-owner deployment, but it is the
-- reason this is an allowlist rather than an ownership grant.
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
      -- Or a named exception to the minimum. Compared case-insensitively to
      -- match how uniqueness works — only one of `EJ`/`ej` can exist anyway, so
      -- permitting one casing and refusing the other would be arbitrary.
      or lower(p_name) = any (array['ej'])
    )
    -- Reserved words still apply to exceptions. Being on the short-name list
    -- buys a pass on LENGTH, nothing else.
    and not private.is_reserved_username(p_name);
$$;

comment on function private.is_valid_username(text) is
  'Format + reserved-word rule for usernames: 3-20 chars, [A-Za-z0-9_], must '
  'start alphanumeric, not reserved. The array in the body is a named exception '
  'list to the 3-char MINIMUM only (see 0042) — it grants legality, not '
  'ownership; a listed name is claimable by anyone who gets there first.';

-- ----------------------------------------------------------------------------
-- Assign the owner's handle.
--
-- Clearing username_is_provisional too: the account was flagged because 0039
-- generated `ejcaldwell06` from the email address, and this is a deliberate
-- choice, so the "pick your own name" banner should stop asking.
--
-- Guarded by email rather than by a hardcoded uuid so this migration is
-- meaningful on a restored copy or a fresh environment, and simply matches
-- nothing where that account does not exist.
-- ----------------------------------------------------------------------------
update public.profiles p
   set username = 'EJ',
       username_is_provisional = false
  from auth.users u
 where u.id = p.id
   and lower(u.email::text) = 'ejcaldwell06@gmail.com'
   -- Never take the name from somebody else if it has since been claimed; the
   -- unique index would abort the whole migration, which on a restore would
   -- block every later migration behind it.
   and not exists (
     select 1 from public.profiles q
     where lower(q.username) = 'ej' and q.id <> p.id
   );
