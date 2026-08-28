-- ============================================================================
-- 0041_campaign_character_names.sql — Phase 7.4.2: let the roster show
-- "username (Character)".
--
-- OWNER DECISION (2026-08-17), not a maybe: the campaign overview roster shows
-- BOTH the username and the character name. It reads better than either alone
-- at the table, where people are known by both, and the roster is the one place
-- the whole party is listed together.
--
-- WHY THIS NEEDS A MIGRATION AND NOT JUST A QUERY. `private.can_read_character`
-- (0010) is **owner OR campaign DM**, so today a player cannot read ANY part of
-- another player's character row — the name included. The roster as specified is
-- therefore not implementable client-side; it needs a deliberate, narrow
-- widening.
--
-- THREE OPTIONS WERE CONSIDERED (PLANNING 7.4.2):
--   1. Show the pairing only where already permitted — the DM sees everyone,
--      each player sees only their own row. No RLS change, but the roster then
--      reads inconsistently for players, which is not what was asked for.
--   2. Expose `characters.name` ONLY, to campaign members. ← this migration.
--   3. Widen can_read_character to any campaign member. **Explicitly rejected.**
--      That predicate also gates sheet_fields, inventory and lore (0010/0012),
--      so it would expose a player's entire sheet, their gear and their
--      backstory to everyone in the campaign — to put a name on a roster line.
--
-- WHAT THIS EXPOSES, EXACTLY: `owner_id` and `name`, for characters in ONE
-- campaign, to members of that campaign. Nothing else — not the id, not the
-- portrait, not a single sheet field. `can_read_character` is untouched, so
-- sheets, inventory, journals and lore remain exactly as private as they were.
-- The QA for this asserts that directly rather than assuming it.
--
-- A FUNCTION RATHER THAN A NEW RLS POLICY ON `characters`, deliberately: a
-- policy admitting members to the row would admit them to every COLUMN of it,
-- since Postgres RLS is row-level and this codebase has no column privileges on
-- that table. A function returns two columns and can never accidentally return
-- a third.
-- ============================================================================

create function public.campaign_character_names(p_campaign_id uuid)
returns table (user_id uuid, character_name text)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  -- The whole access-control story, in one place. Without this a SECURITY
  -- DEFINER function would happily read any campaign's characters for any
  -- caller — the definer rights are precisely what make the check mandatory.
  if not private.is_campaign_member(p_campaign_id) then
    raise exception 'Not a member of this campaign'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select c.owner_id, c.name
    from public.characters c
    where c.campaign_id = p_campaign_id
    order by c.created_at;
end;
$$;

comment on function public.campaign_character_names(uuid) is
  'Campaign members may see WHO plays WHAT: owner_id + character name only, for '
  'one campaign. Does not widen private.can_read_character — sheets, inventory, '
  'journals and lore stay owner-or-DM. See migration 0041.';

-- Callable by any signed-in user; the membership check inside is the gate, and
-- it is what stops this being a "list the characters in any campaign" oracle.
-- anon is excluded: a signed-out caller has no auth.uid() and would fail the
-- membership check anyway, but saying so explicitly costs nothing.
revoke execute on function public.campaign_character_names(uuid) from public, anon;
grant execute on function public.campaign_character_names(uuid) to authenticated;
