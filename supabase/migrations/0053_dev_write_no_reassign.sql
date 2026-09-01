-- ============================================================================
-- 0053 — stop a dev account reassigning a character's owner (fixes 0052)
--
-- WHAT WENT WRONG. 0052 tried to stop ownership transfer inside the policy:
--
--     with check (... and owner_id = private.character_owner(id))
--
-- The intent was "the new owner must equal the existing owner". It did not
-- work, and the RLS matrix caught it on the first run: a dev DM reassigned a
-- player's character to themselves and the update was ACCEPTED.
--
-- WHY. A WITH CHECK expression is evaluated after the row has been updated, and
-- the STABLE function reading `public.characters` back inside that same command
-- observed the NEW owner_id, not the old one. So the test reduced to
-- `owner_id = owner_id` — a tautology that looked like a guard. This is the
-- general trap: a policy cannot reliably compare a row against its own previous
-- value, because policies see rows, not transitions.
--
-- A trigger can, because OLD and NEW are exactly what it is handed. So the
-- guard moves to a BEFORE UPDATE trigger and the tautological clause is dropped
-- from the policy.
--
-- HOW BADLY IT READ. The failure was not one assertion, it was eight. Once the
-- character had been reassigned to the DM, the fixture player no longer owned
-- their own character, so "player reads only their own character", "reads own
-- inventory", "reads own journal" and "can rename their own character" all
-- failed too — and the dev DM could then read the player's journal, because the
-- journal follows character ownership. Every one of those was a knock-on of the
-- single real defect. Worth remembering when reading a failing matrix: count
-- the causes, not the failures.
-- ============================================================================

-- Ownership may change only at the hand of the current owner. Applies to
-- everyone, not just dev accounts: no policy today allows anyone else to move a
-- character, so this closes the door rather than narrowing an existing path.
create or replace function private.forbid_character_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and old.owner_id is distinct from (select auth.uid()) then
    raise exception 'a character''s owner may only be changed by its owner'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function private.forbid_character_owner_change() is
  'Blocks owner_id transfer by anyone but the current owner. Exists because a WITH CHECK policy cannot see a row''s previous value — see migration 0053.';

drop trigger if exists characters_forbid_owner_change on public.characters;
create trigger characters_forbid_owner_change
  before update on public.characters
  for each row
  execute function private.forbid_character_owner_change();

-- Drop the clause that never did anything, so nobody reads it later and assumes
-- the protection lives in two places.
drop policy if exists characters_update_dev on public.characters;
create policy characters_update_dev on public.characters for update to authenticated
  using (private.dev_can_write_character(id))
  with check (private.dev_can_write_character(id));

-- character_owner() existed only to serve that clause. Removed rather than left
-- as an unused SECURITY DEFINER function reachable by `authenticated`.
drop function if exists private.character_owner(uuid);
