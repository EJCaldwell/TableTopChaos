-- ============================================================================
-- 0065 — DM-adjustable fog density (Phase 9.3, owner request 2026-09-01)
--
-- The fog was made fully opaque earlier today because at 92% every token behind
-- a wall showed through as a faint disc. That fix was right about the symptom
-- and heavy-handed about the cause: the leak was TOKENS showing through, not the
-- floor. With tokens now clipped to the visible area (client-side), the two are
-- separable — so the DM can choose how much of the unseen terrain to suggest,
-- and pieces stay hidden either way.
--
-- WHAT LOWERING IT ACTUALLY REVEALS, so the choice is informed: the map image
-- and the grid, nothing else. Tokens outside the visible area are not drawn at
-- all, and walls were never sent to a player (0061). A DM setting this to 0.5 is
-- choosing to let the party see the SHAPE of the room they are in, which many
-- tables want, and is not choosing to reveal what is in it.
--
-- FLOOR OF 0.3, not 0. Zero would be "vision enabled but no fog", which is what
-- the vision toggle itself is for — two controls meaning the same thing is how
-- a table ends up arguing about which one is on. Below about 0.3 the fog stops
-- reading as fog and starts reading as a rendering fault.
-- ============================================================================

alter table public.playspace_maps
  add column if not exists fog_opacity numeric(3, 2) not null default 1.0
    check (fog_opacity between 0.3 and 1.0);

comment on column public.playspace_maps.fog_opacity is
  'How dense the fog is drawn, 0.3..1.0 (default 1.0 = opaque). Affects only the terrain: tokens outside the visible area are not rendered at all, and walls are never sent to a player. See migration 0065.';

-- Map settings are DM-only already (playspace_maps_update_dm, 0048/0049), so
-- this column inherits that. Asserted rather than assumed, because a new column
-- on an existing table is exactly where an assumption goes unexamined.
do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'playspace_maps' and cmd = 'UPDATE';
  if v_n <> 1 then
    raise exception '0065: playspace_maps has % UPDATE policies, expected 1 (DM-only)', v_n;
  end if;
end $$;

-- Every existing map must keep the fully-opaque fog it has now.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.playspace_maps where fog_opacity <> 1.0;
  if v_bad > 0 then
    raise exception '0065: % map(s) did not default to opaque fog', v_bad;
  end if;
end $$;
