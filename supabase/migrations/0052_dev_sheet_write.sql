-- ============================================================================
-- 0052 — dev-account write access to a party member's character sheet (9.1a.2)
--
-- WHAT THIS GRANTS, stated plainly because it is a real grant and not a test
-- double: an account listed in `private.dev_accounts` may WRITE the character
-- sheets of players in campaigns where that account is the DM. Today that is
-- exactly one account (EJ, seeded by 0051).
--
-- WHY IT HAS TO BE HERE AND NOT IN THE CLIENT. The dev tooling's other gate,
-- `import.meta.env.DEV`, is a compile-time constant in the browser bundle. The
-- database never sees it — from Postgres's side there is only "EJ, role
-- authenticated". So a switcher that merely LOOKS at another sheet can be
-- client-side, but one that SAVES cannot: the permission must exist server-side
-- or the write is refused. There is no dev-only database.
--
-- WHY IT IS ACCEPTABLY CONTAINED:
--   * `private.dev_accounts` has RLS enabled and NO policies, so no client can
--     read it, and — the part that matters — no client can insert itself into
--     it. Only the service role writes that table. A user cannot grant
--     themselves this.
--   * `is_dev_account()` takes NO argument, so it can only ever answer about the
--     caller. It cannot be used to probe or act as anyone else.
--   * It is still scoped to campaigns the dev account actually DMs. It is not a
--     global write.
--   * It does NOT bypass the read-only lapse lock: campaign_is_active is still
--     required, exactly as for an owner. A dev account cannot write a lapsed
--     campaign either.
--
-- WHAT IS DELIBERATELY EXCLUDED: the **journal**. It is private even from the
-- DM by design (2.4), and a testing convenience is not a good enough reason to
-- put a hole in the one thing users were promised is theirs alone. An inspected
-- journal stays empty and unwritable.
--
-- The 8.2 matrix asserts BOTH halves of this: that the dev account can write,
-- and that a non-dev DM still cannot. The second is the one that would catch
-- this predicate being accidentally widened later.
-- ============================================================================

-- True if the caller is a dev account AND the DM of the campaign owning this
-- character AND that campaign is writable. Separate from can_write_character so
-- the dev clause is greppable as one named thing rather than buried in an OR.
create or replace function private.dev_can_write_character(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.characters c
    where c.id = p_character_id
      and public.is_dev_account()
      and private.is_campaign_dm(c.campaign_id)
      and coalesce(private.campaign_is_active(c.campaign_id), false)
  );
$$;

comment on function private.dev_can_write_character(uuid) is
  'True if the caller is an allowlisted dev account acting as DM of this character''s (writable) campaign. Backs the 9.1a character switcher''s saves. Not a user-grantable privilege: private.dev_accounts is service-role only.';

grant execute on function private.dev_can_write_character(uuid) to authenticated;

-- Reads a character's CURRENT owner. SECURITY DEFINER on purpose: it is called
-- from a policy ON public.characters, and a plain subquery there would re-enter
-- that table's own RLS. Returns only a uuid the caller may already read.
create or replace function private.character_owner(p_character_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select c.owner_id from public.characters c where c.id = p_character_id;
$$;

grant execute on function private.character_owner(uuid) to authenticated;

-- Fold the dev clause into the single chokepoint. can_write_character already
-- backs sheet_sections, sheet_fields (via can_write_section), inventory,
-- abilities, spells and HP/conditions, so widening it here reaches all of them
-- without touching a single policy.
create or replace function private.can_write_character(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.characters c
    where c.id = p_character_id
      and c.owner_id = (select auth.uid())
  )
  or private.dev_can_write_character(p_character_id);
$$;

comment on function private.can_write_character(uuid) is
  'True if the current user owns the character, or is an allowlisted dev account DMing its campaign (0052). SECURITY DEFINER to avoid RLS recursion; backs owner-only write policies.';

-- The `characters` row ITSELF (name, lore fields) is governed by policies that
-- test owner_id inline rather than calling the predicate, so it needs its own.
-- Added as a SEPARATE policy rather than by editing characters_update_owner:
-- policies on a table are OR-ed, so this leaves the owner path exactly as it
-- was and makes the dev path deletable in one statement.
--
-- UPDATE only. No dev INSERT (a character created for someone else would be
-- owned by nobody sensible) and no dev DELETE (nothing about testing needs to
-- destroy a player's sheet, and that is the one mistake with no undo).
drop policy if exists characters_update_dev on public.characters;
create policy characters_update_dev on public.characters for update to authenticated
  using (private.dev_can_write_character(id))
  with check (
    private.dev_can_write_character(id)
    -- Ownership may not be reassigned through this path: a dev account may edit
    -- a sheet, never take it. Without this, `using` would admit the row and the
    -- update could rewrite owner_id to anyone.
    and owner_id = private.character_owner(id)
  );

-- ---------------------------------------------------------------------------
-- Self-assertion: fail the migration if the grant is wider than advertised.
-- ---------------------------------------------------------------------------
do $$
begin
  -- The dev predicate must be false for a caller who is not a dev account. This
  -- runs as the migration role (not an allowlisted account), so it stands in for
  -- "any non-dev caller".
  if exists (
    select 1 from public.characters c
    where private.dev_can_write_character(c.id)
    limit 1
  ) then
    raise exception '0052: dev_can_write_character is true for a non-dev caller';
  end if;
end $$;

-- 0051 described this table as "NOT a security boundary", which was true when
-- the tooling it gated only made the caller see LESS of their own data. As of
-- this migration it grants write access to other people's sheets, so it IS one.
-- Correcting the comment rather than leaving a reassuring sentence that stopped
-- being true.
comment on table private.dev_accounts is
  'Accounts that may see the dev-only test tooling (Phase 9.1a) AND, since 0052, '
  'write party members'' character sheets in campaigns they DM. In `private` so it '
  'is unreachable over PostgREST; RLS enabled with NO policies, so no client role '
  'can read or write it. Managed by SQL, never by a deploy and never from the app. '
  'THIS IS A SECURITY BOUNDARY as of 0052 — an entry here confers write access to '
  'other users'' data. Add to it only deliberately.';
