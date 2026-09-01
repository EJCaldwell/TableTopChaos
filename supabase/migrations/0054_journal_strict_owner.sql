-- ============================================================================
-- 0054 — restore the journal's owner-only guarantee (fixes 0052)
--
-- WHAT WENT WRONG. 0052 said, in its own header, that the journal was
-- "deliberately excluded" from the dev write grant. It was not. The matrix
-- caught it: an allowlisted dev DM could both READ and WRITE a player's private
-- journal.
--
-- WHY. 0052 widened `private.can_write_character` because it was the single
-- chokepoint every character-scoped table routes through — which was true, and
-- was exactly the problem. The journal routes through it too. Worse, it uses it
-- as its "is this the owner?" READ test, on the reasoning recorded in 0015:
--
--     -- (can_write_character is owner-only, so it's the right "is owner" test here.)
--
-- That comment was correct when written and silently stopped being correct the
-- moment the function's meaning changed. A predicate borrowed for its side
-- meaning is a trap: widening it edits every policy that borrowed it, and the
-- policies do not mention the change anywhere.
--
-- THE FIX. Give "is the owner, strictly" its own name and point the journal at
-- it, so the two ideas can never be widened together again. `can_write_character`
-- keeps its new, broader meaning for the sheet; `is_character_owner` means what
-- 0015 actually wanted and will not drift.
-- ============================================================================

-- Strict ownership. No dev clause, no DM clause, now or later — if a future
-- migration needs a wider test it must add a different function, which is the
-- entire point of this one existing separately.
create or replace function private.is_character_owner(p_character_id uuid)
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
  );
$$;

comment on function private.is_character_owner(uuid) is
  'True ONLY if the current user owns the character. Deliberately separate from can_write_character, which since 0052 also admits dev accounts — see migration 0054. Do not widen this function; add another.';

grant execute on function private.is_character_owner(uuid) to authenticated;

-- Same shape as owner_can_write_character (0049) but on the strict predicate,
-- so the journal keeps the read-only lapse lock it already had.
create or replace function private.owner_can_write_journal(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_character_owner(p_character_id)
     and coalesce(private.campaign_is_active(
           (select c.campaign_id from public.characters c where c.id = p_character_id)
         ), false);
$$;

grant execute on function private.owner_can_write_journal(uuid) to authenticated;

-- Read: owner always; DM only for entries the player has explicitly shared.
drop policy if exists journal_entries_select_owner_or_shared_dm on public.journal_entries;
create policy journal_entries_select_owner_or_shared_dm
  on public.journal_entries for select to authenticated
  using (
    private.is_character_owner(character_id)
    or (shared and private.is_character_dm(character_id))
  );

comment on policy journal_entries_select_owner_or_shared_dm on public.journal_entries is
  'Owner reads all their entries; the DM reads only entries the player has shared; other players none. Uses is_character_owner, NOT can_write_character — see 0054.';

-- Write: owner only, always, including a dev account. There is no testing need
-- that justifies writing someone's private journal.
drop policy if exists journal_entries_insert_owner on public.journal_entries;
create policy journal_entries_insert_owner on public.journal_entries for insert to authenticated
  with check (private.owner_can_write_journal(character_id));

drop policy if exists journal_entries_update_owner on public.journal_entries;
create policy journal_entries_update_owner on public.journal_entries for update to authenticated
  using (private.owner_can_write_journal(character_id))
  with check (private.owner_can_write_journal(character_id));

drop policy if exists journal_entries_delete_owner on public.journal_entries;
create policy journal_entries_delete_owner on public.journal_entries for delete to authenticated
  using (private.owner_can_write_journal(character_id));

-- ---------------------------------------------------------------------------
-- Structural assertion: no journal policy may consult can_write_character
-- again. This is the assertion that would have caught 0052 before it shipped.
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename = 'journal_entries'
    and coalesce(qual, '') || coalesce(with_check, '') like '%can_write_character%';
  if v_bad is not null then
    raise exception '0054: journal policy(s) still use can_write_character: %', v_bad;
  end if;
end $$;
