-- ============================================================================
-- 0055 — movable grid, and a DM switch for player-placed tokens (9.1.2c)
--
-- Three owner requests, one migration:
--
-- 1. THE GRID CAN BE MOVED, not only resized. A scanned battlemap almost never
--    has its printed grid starting exactly at the top-left pixel, so a size-only
--    control can align the spacing and still be half a square out everywhere.
--    Two offsets, in map pixels, applied before the modulo.
--
-- 2. PLAYERS MAY PLACE THEIR OWN CHARACTER, at the DM's discretion.
--
--    NOTE WHAT THIS ACTUALLY CHANGES. 0048 already allowed it: the existing
--    `playspace_tokens_insert_own` lets any member insert a token they own. The
--    UI simply never offered it. So this request is not "grant players a new
--    power" — it is "put the power that already exists behind a switch". The
--    policy is therefore made STRICTER here, not looser, and a campaign that
--    leaves the box unticked ends up more locked down than it was yesterday.
--
--    Default FALSE. A permission that appears without the DM asking for it is
--    the wrong default for a table they are running.
--
-- 3. A player's token must be THEIR character. A member could previously insert
--    a token owned by themselves but linked to somebody else's character_id —
--    harmless today, since the link is display-only (0048 decision 2), but it
--    would put another player's name on a token they do not control. Closed
--    here while the policy is being rewritten anyway.
-- ============================================================================

-- --- 1. Grid offset --------------------------------------------------------
-- Bounded by ±the maximum grid size: an offset larger than one cell is just a
-- smaller offset plus whole cells, so allowing more would only create more ways to
-- express the same alignment and a slider with dead travel at both ends.
alter table public.playspace_maps
  add column if not exists grid_offset_x int not null default 0
    check (grid_offset_x between -500 and 500),
  add column if not exists grid_offset_y int not null default 0
    check (grid_offset_y between -500 and 500);

comment on column public.playspace_maps.grid_offset_x is
  'Horizontal shift of the grid overlay in MAP PIXELS, so the overlay can be lined up with a grid already printed on the image. Does not move tokens (0048 decision 1).';

-- --- 2. The DM's switch ----------------------------------------------------
alter table public.playspace_maps
  add column if not exists players_can_place boolean not null default false;

comment on column public.playspace_maps.players_can_place is
  'When true, a player may add a token for their OWN character to this map. Default false. Enforced by playspace_tokens_insert_own, not only by the UI.';

-- --- 3. The tightened insert policy ----------------------------------------
-- Does the map allow players to place their own tokens? SECURITY DEFINER so the
-- token policy can read the map row without re-entering playspace_maps' RLS.
create or replace function private.playspace_map_allows_player_place(p_map_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select m.players_can_place from public.playspace_maps m where m.id = p_map_id), false);
$$;

grant execute on function private.playspace_map_allows_player_place(uuid) to authenticated;

-- True if the character is the caller's own, or no character is linked at all.
-- Written as "not (linked and not mine)" so a NULL character_id — a plain marker
-- — passes, rather than the whole predicate collapsing to NULL.
create or replace function private.token_character_is_own(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select p_character_id is null
      or exists (
        select 1 from public.characters c
        where c.id = p_character_id and c.owner_id = (select auth.uid())
      );
$$;

grant execute on function private.token_character_is_own(uuid) to authenticated;

drop policy if exists playspace_tokens_insert_own on public.playspace_tokens;
create policy playspace_tokens_insert_own
  on public.playspace_tokens for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.member_can_write(private.playspace_map_campaign(map_id))
    -- The new gate. The DM's switch, per map — a campaign can allow it on the
    -- town square and not in the dungeon.
    and private.playspace_map_allows_player_place(map_id)
    -- ...and it must be their own character, not someone else's name.
    and private.token_character_is_own(character_id)
  );

comment on policy playspace_tokens_insert_own on public.playspace_tokens is
  'A player may add a token for their OWN character, and only where the DM has ticked players_can_place on that map (0055). The DM path is playspace_tokens_insert_dm and is unaffected.';

-- The DM keeps their own path, unchanged and ungated: the switch is about
-- players, and a DM placing an NPC on their own map never needed permission.
-- Restated here only so a reader of this file is not left wondering.

-- ---------------------------------------------------------------------------
-- Self-assertion: the switch must default to OFF for every existing map, or
-- shipping this would silently open every table in production.
-- ---------------------------------------------------------------------------
do $$
declare v_open int;
begin
  select count(*) into v_open from public.playspace_maps where players_can_place;
  if v_open > 0 then
    raise exception '0055: % existing map(s) default to players_can_place = true', v_open;
  end if;
end $$;
