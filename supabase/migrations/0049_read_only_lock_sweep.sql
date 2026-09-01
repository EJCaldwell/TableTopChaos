-- ============================================================================
-- 0049_read_only_lock_sweep.sql — make the read-only lock real.
--
-- THE BUG THIS FIXES. `private.campaign_is_active()` has existed since migration
-- 0005 and is the switch behind "a lapsed campaign becomes read-only". Until
-- now **no content table consulted it**: 69 write policies, 0 references. It was
-- invisible because `enforce_active` is false, so the function returns true for
-- everything and every policy behaved identically either way.
--
-- Found 2026-08-28 while writing migration 0048, whose policies were the first
-- to include the check.
--
-- WHAT IT WOULD HAVE COST. After the launch flip:
--   * a lapsed campaign stays fully writable — sheets, inventory, journals, DM
--     notes, NPCs, quests, encounters, the lot. The paywall would gate joining
--     and image uploads and nothing else, so cancelling costs a customer nothing;
--   * the Refunds page states "everyone can still read everything, and nobody can
--     write". That would be false, in the document Phase 7.2 exists to keep true.
--
-- QA/1.5_tests/read-only-lock.md instructed every later phase to add this check
-- to its content tables. Phases 2, 3 and 4 did not. This is that debt, paid.
--
-- ============================================================================
-- READS ARE NOT TOUCHED. Only INSERT/UPDATE/DELETE policies change. The promise
-- is "read everything, write nothing", so a lapsed campaign must stay fully
-- visible and fully exportable. This is why the lock could NOT simply be added
-- to `private.is_campaign_dm` or `can_write_character` — those predicates are
-- shared with SELECT policies, and locking them would HIDE a lapsed campaign's
-- content instead of freezing it. New write-only predicates are introduced
-- instead.
--
-- ============================================================================
-- FOUR THINGS ARE DELIBERATELY LEFT UNLOCKED. Each would make a lapsed campaign
-- unrecoverable or would punish the wrong person:
--
--   1. `campaigns` INSERT — a brand-new campaign has no subscription, so
--      campaign_is_active() is FALSE for it. Locking this would make it
--      impossible to create a campaign at all once enforcement is on.
--   2. `campaigns` UPDATE — campaign settings and the billing screen live here.
--      Freezing them would make a lapsed campaign harder to manage at exactly
--      the moment its owner is deciding whether to pay.
--   3. `campaign_members` DELETE — leaving a campaign must always work. Trapping
--      players in a frozen campaign because the DM stopped paying is not a
--      paywall, it is a hostage situation.
--   4. `invite_codes` DELETE — revoking a code is a safety action. Creating one
--      is locked; taking one back never is.
--
-- `profiles` UPDATE is untouched because it is not campaign-scoped at all.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Write-time predicates. Each is "the existing permission check AND the campaign
-- is writable". Suffix `_can_write` so a policy reads as what it is, and so
-- grepping for the read counterparts stays unambiguous.
--
-- All are SECURITY DEFINER + STABLE, matching the predicates they wrap.
-- ----------------------------------------------------------------------------

create function private.dm_can_write(p_campaign_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.is_campaign_dm(p_campaign_id)
     and coalesce(private.campaign_is_active(p_campaign_id), false);
$$;

create function private.member_can_write(p_campaign_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.is_campaign_member(p_campaign_id)
     and coalesce(private.campaign_is_active(p_campaign_id), false);
$$;

-- Owner-of-character write access, plus the lock. Resolves the character's
-- campaign itself rather than taking it as an argument, so a policy cannot pass
-- the wrong campaign id.
create function private.owner_can_write_character(p_character_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.can_write_character(p_character_id)
     and coalesce(private.campaign_is_active(
           (select c.campaign_id from public.characters c where c.id = p_character_id)
         ), false);
$$;

create function private.owner_can_write_section(p_section_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.can_write_section(p_section_id)
     and coalesce(private.campaign_is_active(
           (select c.campaign_id
              from public.sheet_sections s
              join public.characters c on c.id = s.character_id
             where s.id = p_section_id)
         ), false);
$$;

create function private.dm_can_write_encounter(p_encounter_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.is_encounter_dm(p_encounter_id)
     and coalesce(private.campaign_is_active(
           (select e.campaign_id from public.encounters e where e.id = p_encounter_id)
         ), false);
$$;

create function private.dm_can_write_npc(p_npc_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.is_npc_dm(p_npc_id)
     and coalesce(private.campaign_is_active(
           (select n.campaign_id from public.npcs n where n.id = p_npc_id)
         ), false);
$$;

create function private.dm_can_write_npc_section(p_section_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.is_npc_section_dm(p_section_id)
     and coalesce(private.campaign_is_active(
           (select n.campaign_id
              from public.npc_stat_sections s
              join public.npcs n on n.id = s.npc_id
             where s.id = p_section_id)
         ), false);
$$;

create function private.can_write_rsvp(p_session_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select private.can_access_session(p_session_id)
     and coalesce(private.campaign_is_active(
           (select s.campaign_id from public.schedule_sessions s where s.id = p_session_id)
         ), false);
$$;

grant execute on function private.dm_can_write(uuid) to authenticated;
grant execute on function private.member_can_write(uuid) to authenticated;
grant execute on function private.owner_can_write_character(uuid) to authenticated;
grant execute on function private.owner_can_write_section(uuid) to authenticated;
grant execute on function private.dm_can_write_encounter(uuid) to authenticated;
grant execute on function private.dm_can_write_npc(uuid) to authenticated;
grant execute on function private.dm_can_write_npc_section(uuid) to authenticated;
grant execute on function private.can_write_rsvp(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- DM-owned campaign content: is_campaign_dm -> dm_can_write
-- ---------------------------------------------------------------------------
drop policy if exists dm_notes_insert_dm on public.dm_notes;
create policy dm_notes_insert_dm on public.dm_notes for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists dm_notes_update_dm on public.dm_notes;
create policy dm_notes_update_dm on public.dm_notes for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists dm_notes_delete_dm on public.dm_notes;
create policy dm_notes_delete_dm on public.dm_notes for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists encounters_insert_dm on public.encounters;
create policy encounters_insert_dm on public.encounters for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists encounters_update_dm on public.encounters;
create policy encounters_update_dm on public.encounters for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists encounters_delete_dm on public.encounters;
create policy encounters_delete_dm on public.encounters for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists initiative_entries_insert_dm on public.initiative_entries;
create policy initiative_entries_insert_dm on public.initiative_entries for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists initiative_entries_update_dm on public.initiative_entries;
create policy initiative_entries_update_dm on public.initiative_entries for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists initiative_entries_delete_dm on public.initiative_entries;
create policy initiative_entries_delete_dm on public.initiative_entries for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists npcs_insert_dm on public.npcs;
create policy npcs_insert_dm on public.npcs for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists npcs_update_dm on public.npcs;
create policy npcs_update_dm on public.npcs for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists npcs_delete_dm on public.npcs;
create policy npcs_delete_dm on public.npcs for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists quests_insert_dm on public.quests;
create policy quests_insert_dm on public.quests for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists quests_update_dm on public.quests;
create policy quests_update_dm on public.quests for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists quests_delete_dm on public.quests;
create policy quests_delete_dm on public.quests for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists schedule_sessions_insert_dm on public.schedule_sessions;
create policy schedule_sessions_insert_dm on public.schedule_sessions for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists schedule_sessions_update_dm on public.schedule_sessions;
create policy schedule_sessions_update_dm on public.schedule_sessions for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists schedule_sessions_delete_dm on public.schedule_sessions;
create policy schedule_sessions_delete_dm on public.schedule_sessions for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists sessions_insert_dm on public.sessions;
create policy sessions_insert_dm on public.sessions for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists sessions_update_dm on public.sessions;
create policy sessions_update_dm on public.sessions for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists sessions_delete_dm on public.sessions;
create policy sessions_delete_dm on public.sessions for delete to authenticated
  using (private.dm_can_write(campaign_id));
drop policy if exists shared_items_insert_dm on public.shared_items;
create policy shared_items_insert_dm on public.shared_items for insert to authenticated
  with check (private.dm_can_write(campaign_id));
drop policy if exists shared_items_update_dm on public.shared_items;
create policy shared_items_update_dm on public.shared_items for update to authenticated
  using (private.dm_can_write(campaign_id))
  with check (private.dm_can_write(campaign_id));
drop policy if exists shared_items_delete_dm on public.shared_items;
create policy shared_items_delete_dm on public.shared_items for delete to authenticated
  using (private.dm_can_write(campaign_id));

-- ---------------------------------------------------------------------------
-- Character-owned content: can_write_character -> owner_can_write_character
-- ---------------------------------------------------------------------------
drop policy if exists abilities_insert_owner on public.abilities;
create policy abilities_insert_owner on public.abilities for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists abilities_update_owner on public.abilities;
create policy abilities_update_owner on public.abilities for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists abilities_delete_owner on public.abilities;
create policy abilities_delete_owner on public.abilities for delete to authenticated
  using (private.owner_can_write_character(character_id));
drop policy if exists character_status_insert_owner on public.character_status;
create policy character_status_insert_owner on public.character_status for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists character_status_update_owner on public.character_status;
create policy character_status_update_owner on public.character_status for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists character_status_delete_owner on public.character_status;
create policy character_status_delete_owner on public.character_status for delete to authenticated
  using (private.owner_can_write_character(character_id));
drop policy if exists inventory_items_insert_owner on public.inventory_items;
create policy inventory_items_insert_owner on public.inventory_items for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists inventory_items_update_owner on public.inventory_items;
create policy inventory_items_update_owner on public.inventory_items for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists inventory_items_delete_owner on public.inventory_items;
create policy inventory_items_delete_owner on public.inventory_items for delete to authenticated
  using (private.owner_can_write_character(character_id));
drop policy if exists journal_entries_insert_owner on public.journal_entries;
create policy journal_entries_insert_owner on public.journal_entries for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists journal_entries_update_owner on public.journal_entries;
create policy journal_entries_update_owner on public.journal_entries for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists journal_entries_delete_owner on public.journal_entries;
create policy journal_entries_delete_owner on public.journal_entries for delete to authenticated
  using (private.owner_can_write_character(character_id));
drop policy if exists sheet_sections_insert_owner on public.sheet_sections;
create policy sheet_sections_insert_owner on public.sheet_sections for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists sheet_sections_update_owner on public.sheet_sections;
create policy sheet_sections_update_owner on public.sheet_sections for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists sheet_sections_delete_owner on public.sheet_sections;
create policy sheet_sections_delete_owner on public.sheet_sections for delete to authenticated
  using (private.owner_can_write_character(character_id));
drop policy if exists spells_insert_owner on public.spells;
create policy spells_insert_owner on public.spells for insert to authenticated
  with check (private.owner_can_write_character(character_id));
drop policy if exists spells_update_owner on public.spells;
create policy spells_update_owner on public.spells for update to authenticated
  using (private.owner_can_write_character(character_id))
  with check (private.owner_can_write_character(character_id));
drop policy if exists spells_delete_owner on public.spells;
create policy spells_delete_owner on public.spells for delete to authenticated
  using (private.owner_can_write_character(character_id));

-- ---------------------------------------------------------------------------
-- sheet_fields — scoped through its section
-- ---------------------------------------------------------------------------
drop policy if exists sheet_fields_insert_owner on public.sheet_fields;
create policy sheet_fields_insert_owner on public.sheet_fields for insert to authenticated
  with check (private.owner_can_write_section(section_id));
drop policy if exists sheet_fields_update_owner on public.sheet_fields;
create policy sheet_fields_update_owner on public.sheet_fields for update to authenticated
  using (private.owner_can_write_section(section_id))
  with check (private.owner_can_write_section(section_id));
drop policy if exists sheet_fields_delete_owner on public.sheet_fields;
create policy sheet_fields_delete_owner on public.sheet_fields for delete to authenticated
  using (private.owner_can_write_section(section_id));

-- ---------------------------------------------------------------------------
-- Encounter children
-- ---------------------------------------------------------------------------
drop policy if exists encounter_images_insert_dm on public.encounter_images;
create policy encounter_images_insert_dm on public.encounter_images for insert to authenticated
  with check (private.dm_can_write_encounter(encounter_id));
drop policy if exists encounter_images_update_dm on public.encounter_images;
create policy encounter_images_update_dm on public.encounter_images for update to authenticated
  using (private.dm_can_write_encounter(encounter_id))
  with check (private.dm_can_write_encounter(encounter_id));
drop policy if exists encounter_images_delete_dm on public.encounter_images;
create policy encounter_images_delete_dm on public.encounter_images for delete to authenticated
  using (private.dm_can_write_encounter(encounter_id));
drop policy if exists encounter_npcs_insert_dm on public.encounter_npcs;
create policy encounter_npcs_insert_dm on public.encounter_npcs for insert to authenticated
  with check (private.dm_can_write_encounter(encounter_id));
drop policy if exists encounter_npcs_update_dm on public.encounter_npcs;
create policy encounter_npcs_update_dm on public.encounter_npcs for update to authenticated
  using (private.dm_can_write_encounter(encounter_id))
  with check (private.dm_can_write_encounter(encounter_id));
drop policy if exists encounter_npcs_delete_dm on public.encounter_npcs;
create policy encounter_npcs_delete_dm on public.encounter_npcs for delete to authenticated
  using (private.dm_can_write_encounter(encounter_id));

-- ---------------------------------------------------------------------------
-- NPC stat blocks
-- ---------------------------------------------------------------------------
drop policy if exists npc_stat_sections_insert_dm on public.npc_stat_sections;
create policy npc_stat_sections_insert_dm on public.npc_stat_sections for insert to authenticated
  with check (private.dm_can_write_npc(npc_id));
drop policy if exists npc_stat_sections_update_dm on public.npc_stat_sections;
create policy npc_stat_sections_update_dm on public.npc_stat_sections for update to authenticated
  using (private.dm_can_write_npc(npc_id))
  with check (private.dm_can_write_npc(npc_id));
drop policy if exists npc_stat_sections_delete_dm on public.npc_stat_sections;
create policy npc_stat_sections_delete_dm on public.npc_stat_sections for delete to authenticated
  using (private.dm_can_write_npc(npc_id));
drop policy if exists npc_stat_fields_insert_dm on public.npc_stat_fields;
create policy npc_stat_fields_insert_dm on public.npc_stat_fields for insert to authenticated
  with check (private.dm_can_write_npc_section(section_id));
drop policy if exists npc_stat_fields_update_dm on public.npc_stat_fields;
create policy npc_stat_fields_update_dm on public.npc_stat_fields for update to authenticated
  using (private.dm_can_write_npc_section(section_id))
  with check (private.dm_can_write_npc_section(section_id));
drop policy if exists npc_stat_fields_delete_dm on public.npc_stat_fields;
create policy npc_stat_fields_delete_dm on public.npc_stat_fields for delete to authenticated
  using (private.dm_can_write_npc_section(section_id));

-- ---------------------------------------------------------------------------
-- characters — owner writes, now gated on the campaign being writable
-- ---------------------------------------------------------------------------
drop policy if exists characters_insert_own on public.characters;
create policy characters_insert_own on public.characters for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.member_can_write(campaign_id)
  );

drop policy if exists characters_update_owner on public.characters;
create policy characters_update_owner on public.characters for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and coalesce(private.campaign_is_active(campaign_id), false)
  );

drop policy if exists characters_delete_owner on public.characters;
create policy characters_delete_owner on public.characters for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and coalesce(private.campaign_is_active(campaign_id), false)
  );

-- ---------------------------------------------------------------------------
-- schedule_rsvps — per-user, now gated on the campaign being writable
-- ---------------------------------------------------------------------------
drop policy if exists schedule_rsvps_insert_own on public.schedule_rsvps;
create policy schedule_rsvps_insert_own on public.schedule_rsvps for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_write_rsvp(session_id));

drop policy if exists schedule_rsvps_update_own on public.schedule_rsvps;
create policy schedule_rsvps_update_own on public.schedule_rsvps for update to authenticated
  using (user_id = (select auth.uid()) and private.can_access_session(session_id))
  with check (user_id = (select auth.uid()) and private.can_write_rsvp(session_id));

drop policy if exists schedule_rsvps_delete_own on public.schedule_rsvps;
create policy schedule_rsvps_delete_own on public.schedule_rsvps for delete to authenticated
  using (user_id = (select auth.uid()) and private.can_write_rsvp(session_id));

-- ---------------------------------------------------------------------------
-- invite_codes — creating an invite is locked; REVOKING one never is
-- ---------------------------------------------------------------------------
drop policy if exists invite_codes_insert_dm on public.invite_codes;
create policy invite_codes_insert_dm on public.invite_codes for insert to authenticated
  with check (private.dm_can_write(campaign_id) and created_by = (select auth.uid()));

-- invite_codes_delete_dm is deliberately UNCHANGED: revoking a code is a safety
-- action and must work whether or not the campaign is paid up.

-- ---------------------------------------------------------------------------
-- Fixing 0048 forward: its two token DELETE policies missed the lock.
--
-- Caught by the assertion below on this migration's first run — which is exactly
-- what it is for, and it caught the author of 0048 rather than some future
-- contributor. INSERT and UPDATE were locked; DELETE was not, so a player in a
-- lapsed campaign could still remove their token, and the DM could still clear
-- the board. Not dangerous, but "nobody can write" has to mean all three verbs.
-- ---------------------------------------------------------------------------
drop policy if exists playspace_tokens_delete_dm on public.playspace_tokens;
create policy playspace_tokens_delete_dm
  on public.playspace_tokens for delete to authenticated
  using (private.dm_can_write(private.playspace_map_campaign(map_id)));

drop policy if exists playspace_tokens_delete_own on public.playspace_tokens;
create policy playspace_tokens_delete_own
  on public.playspace_tokens for delete to authenticated
  using (
    owner_user_id = (select auth.uid())
    and private.member_can_write(private.playspace_map_campaign(map_id))
  );

-- ---------------------------------------------------------------------------
-- Assertion: every write policy on a content table now consults the lock.
--
-- Runs inside the migration so a table added later without the check fails the
-- deploy at the moment it is introduced, rather than at the launch flip.
-- The exclusions are the four documented above plus profiles.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into v_missing
  from pg_policies
  where schemaname = 'public'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and coalesce(qual, '') not like '%campaign_is_active%'
    and coalesce(with_check, '') not like '%campaign_is_active%'
    and coalesce(qual, '') not like '%_can_write%'
    and coalesce(with_check, '') not like '%_can_write%'
    and (tablename, policyname) not in (
      ('campaigns', 'campaigns_insert_own'),
      ('campaigns', 'campaigns_update_dm'),
      ('campaign_members', 'campaign_members_delete_self_or_dm'),
      ('invite_codes', 'invite_codes_delete_dm'),
      ('profiles', 'profiles_update_own')
    );
  if v_missing is not null then
    raise exception E'Write policies that do NOT enforce the read-only lock:\n  %', v_missing;
  end if;
  raise notice 'read-only lock: every content write policy now consults campaign_is_active';
end $$;

