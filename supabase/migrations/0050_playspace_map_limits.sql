-- ============================================================================
-- 0050_playspace_map_limits.sql — owner decisions on top of 9.1.1.
--
-- Three changes, all from the owner (2026-08-28):
--   1. A campaign may hold up to FIVE maps, not unlimited.
--   2. The DM may swap which map is live at any time, in one action.
--   3. An NPC/monster token is DM-controlled unless the DM hands it to a
--      specific player — and that player must actually be in the campaign.
--
-- Grid size needs no schema change: the DM uploads the picture first and then
-- adjusts the overlay to match it, which is exactly what a pixel-space
-- `grid_size` with a sensible default supports (see 0048, decision 1). The
-- upload-then-adjust workflow is UI work and lands in 9.1.2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Five maps per campaign.
--
-- A trigger rather than a CHECK, because a CHECK cannot count sibling rows.
-- BEFORE INSERT only: the limit should never retroactively make an existing map
-- unmodifiable, and an UPDATE cannot increase the count.
--
-- Five is a product decision, not a technical limit — enough for a DM to prep
-- the next few scenes, few enough that the map switcher stays a short list
-- rather than a file browser. Raising it is a one-line change here.
-- ----------------------------------------------------------------------------
create function public.enforce_playspace_map_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_limit constant int := 5;
begin
  select count(*) into v_count
  from public.playspace_maps
  where campaign_id = new.campaign_id;

  if v_count >= v_limit then
    -- Named limit in the message: "you have reached the limit" without saying
    -- what the limit is leaves the user guessing how much to delete.
    raise exception 'A campaign can have at most % maps. Delete one first.', v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger playspace_maps_limit
  before insert on public.playspace_maps
  for each row execute function public.enforce_playspace_map_limit();

-- ----------------------------------------------------------------------------
-- 2. Switching the live map in ONE action.
--
-- 0048 made "at most one active map" a partial unique index, which is still the
-- invariant — but it made switching a two-step dance: deactivate the old map,
-- then activate the new one, in that order, or the index rejects the write. A DM
-- clicking a map in a list should not have to know that.
--
-- This trigger deactivates the others whenever a map is activated, so the whole
-- switch is `update playspace_maps set is_active = true where id = ...`.
--
-- NO INFINITE RECURSION: the inner update only ever sets is_active FALSE, and
-- this branch runs only when NEW.is_active is true. The recursive invocation
-- takes the other path and stops.
-- ----------------------------------------------------------------------------
create function public.deactivate_sibling_maps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active then
    update public.playspace_maps
       set is_active = false
     where campaign_id = new.campaign_id
       and id <> new.id
       and is_active;
  end if;
  return new;
end $$;

-- BEFORE, so the siblings are already false by the time the unique index is
-- checked for this row.
create trigger playspace_maps_single_active
  before insert or update of is_active on public.playspace_maps
  for each row execute function public.deactivate_sibling_maps();

comment on function public.deactivate_sibling_maps() is
  'Keeps exactly one active map per campaign by clearing the others, so the DM '
  'can switch maps in a single UPDATE rather than having to deactivate first. '
  'The partial unique index remains the real invariant. See 0050.';

-- ----------------------------------------------------------------------------
-- 3. Relinquishing a token to a specific player.
--
-- The mechanism already existed in 0048 — `owner_user_id` NULL means
-- DM-controlled, and the DM's UPDATE policy lets them set it to anybody — but
-- nothing checked that "anybody" was in the campaign. Without this a DM could
-- hand a token to a stranger (or to a former member), producing a token nobody
-- present can move and that the roster cannot explain.
--
-- A trigger rather than a CHECK again: the campaign is two joins away, through
-- the map.
--
-- Handing control BACK is just setting owner_user_id to NULL, which skips this
-- check entirely — reclaiming a token must never be blocked by a membership
-- lookup for a player who has since left.
-- ----------------------------------------------------------------------------
create function public.enforce_token_owner_is_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  if new.owner_user_id is null then
    return new;
  end if;

  select m.campaign_id into v_campaign
  from public.playspace_maps m
  where m.id = new.map_id;

  if not exists (
    select 1 from public.campaign_members cm
    where cm.campaign_id = v_campaign
      and cm.user_id = new.owner_user_id
  ) then
    raise exception 'A token can only be given to a member of this campaign.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger playspace_tokens_owner_is_member
  before insert or update of owner_user_id on public.playspace_tokens
  for each row execute function public.enforce_token_owner_is_member();

comment on table public.playspace_tokens is
  'A token on a battlemap (Phase 9.1). owner_user_id is the ONLY thing that '
  'grants a player permission to move it; NULL means DM-controlled, which is the '
  'default for NPCs and monsters. The DM may relinquish a token to a specific '
  'player by setting owner_user_id — who must be a campaign member (0050) — and '
  'reclaim it by setting it back to NULL. Position is in map pixels, not grid '
  'cells (0048, decision 1).';

-- These triggers are SECURITY DEFINER and are not client-callable functions;
-- they run as part of a write the caller was already permitted to make.
revoke execute on function public.enforce_playspace_map_limit() from public, anon, authenticated;
revoke execute on function public.deactivate_sibling_maps() from public, anon, authenticated;
revoke execute on function public.enforce_token_owner_is_member() from public, anon, authenticated;
