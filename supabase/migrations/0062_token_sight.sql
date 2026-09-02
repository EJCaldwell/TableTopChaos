-- ============================================================================
-- 0062 — per-token sight ranges (Phase 9.3.1)
--
-- Two ranges, because they answer different questions:
--   * sight_squares      — how far this creature can see at all;
--   * dark_sight_squares — how far it can see in DARKNESS (darkvision).
-- 9.3 uses the first and stores the second; 9.4 is where darkness makes the
-- second matter. Adding both now costs one migration instead of two, and the
-- column being present does nothing until something reads it.
--
-- MEASURED IN SQUARES, NOT PIXELS OR FEET, and the reasoning is 0056's:
--   * pixels would be wrong the moment the DM re-grids the map — a 420px sight
--     range on a 64px grid is not "60 feet", it is a number that no longer means
--     anything;
--   * feet would need a feet-per-square setting this app does not have, and
--     every table's answer to "how many feet is a square" is already baked into
--     how they drew the grid.
-- Squares are what the map is actually divided into, so a range in squares
-- survives every re-grid and needs no conversion table. A group playing 5ft
-- squares writes 12 for 60ft; a group playing 10ft squares writes 6.
--
-- NULL sight_squares means UNLIMITED — sight bounded only by walls. That is the
-- right default: a token nobody has configured should see as much as the fog
-- allows, not be blind. Zero is a legitimate separate value (a blinded creature)
-- and is why this is nullable rather than defaulting to a big number.
--
-- DM-SET, like size (0057) and ring (0059). How far a creature can see is a
-- fact about the creature, not a preference of the person moving it — and a
-- player who could edit their own sight range could simply turn the fog off for
-- themselves, which would make the whole of 9.2/9.3 decorative.
-- ============================================================================

alter table public.playspace_tokens
  add column if not exists sight_squares numeric(5, 1)
    check (sight_squares is null or sight_squares between 0 and 999),
  add column if not exists dark_sight_squares numeric(5, 1) not null default 0
    check (dark_sight_squares between 0 and 999);

comment on column public.playspace_tokens.sight_squares is
  'How far this token can see, in GRID SQUARES. NULL = unlimited (bounded only by walls); 0 = blind. Squares rather than pixels so the range survives a re-grid — see migration 0062.';

comment on column public.playspace_tokens.dark_sight_squares is
  'Darkvision range in GRID SQUARES. Stored from 9.3; consumed by 9.4, where darkness exists.';

-- Extend the appearance guard to cover sight. Same trigger, renamed for what it
-- now protects: one place answers "which columns may a player not touch?", and
-- a second trigger would eventually disagree with this one.
create or replace function private.forbid_player_token_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Appearance AND capability are the DM's; position is the player's.
  --
  -- Sight is in here for a sharper reason than the others: a player who could
  -- widen their own sight_squares could see the whole map, so this is the line
  -- that stops the fog being self-service.
  if (new.size_cells is distinct from old.size_cells
      or new.ring is distinct from old.ring
      or new.sight_squares is distinct from old.sight_squares
      or new.dark_sight_squares is distinct from old.dark_sight_squares)
     and not private.is_campaign_dm(private.playspace_map_campaign(new.map_id)) then
    raise exception 'only the DM may change a token''s size, ring or sight'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function private.forbid_player_token_config_change() is
  'Blocks a non-DM from changing a token''s appearance or sight columns (size_cells 0057, ring 0059, sight 0062). A trigger rather than a policy because WITH CHECK cannot see a row''s previous value — see migration 0053.';

drop trigger if exists playspace_tokens_forbid_player_resize on public.playspace_tokens;
drop trigger if exists playspace_tokens_forbid_player_config on public.playspace_tokens;
create trigger playspace_tokens_forbid_player_config
  before update on public.playspace_tokens
  for each row
  execute function private.forbid_player_token_config_change();

-- The old function is now unreferenced. Dropped rather than left behind: an
-- orphaned SECURITY DEFINER function that looks like it guards something is
-- worse than no function at all.
drop function if exists private.forbid_player_token_resize();

-- ---------------------------------------------------------------------------
-- Self-assertion: exactly one BEFORE UPDATE guard on the table. Two would mean
-- the old one survived, and a future edit to "the" guard would silently only
-- half apply.
-- ---------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'playspace_tokens'
    and not t.tgisinternal
    and t.tgname like 'playspace_tokens_forbid%';
  if v_n <> 1 then
    raise exception '0062: expected exactly 1 forbid-trigger on playspace_tokens, found %', v_n;
  end if;
end $$;
