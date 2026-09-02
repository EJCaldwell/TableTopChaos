-- ============================================================================
-- 0063 — walls block movement (Phase 9.3, owner request 2026-09-01)
--
-- WHY THIS IS IN THE DATABASE AND NOT THE CLIENT, which is not a preference:
-- migration 0061 made walls DM-only, so a player's browser has NOTHING to check
-- a move against. It cannot refuse a move it cannot see the reason for. The only
-- place that knows both the token's path and the walls is the server, so the
-- rule lives here — as a trigger, where it applies to every writer including a
-- crafted request.
--
-- This is the second time 0061's choice has made a feature harder and better:
-- vision had to move to an Edge Function, and now movement validation cannot be
-- a client-side convenience that a modified client simply skips.
--
-- WHO IS BOUND. Players only. The DM is exempt on purpose — they are the person
-- drawing the walls and staging what is behind them, and a DM who cannot place a
-- monster inside a sealed room cannot prepare an encounter. A DM moving through
-- their own wall is not cheating; a player doing it is.
--
-- WHEN IT APPLIES. Only where the map has vision_enabled. A campaign using walls
-- purely as scenery, with no fog, keeps the movement it has always had — turning
-- every decorative line into a barrier would silently change existing maps.
--
-- WHAT COUNTS AS CROSSING. The straight segment from where the token was to
-- where it is going. That is the honest reading of a drag: you cannot slide
-- through a wall, but you can move anywhere your path does not cross one. It
-- deliberately does NOT model the token's width — a two-square ogre may clip a
-- corner. Modelling width means offsetting every wall by a radius, which is a
-- much larger piece of geometry for a case nobody at a table argues about.
-- ============================================================================

-- Do segments p1->p2 and p3->p4 intersect? Standard orientation test.
--
-- IMMUTABLE and pure arithmetic, so it can be called freely from a trigger.
-- Collinear overlap is deliberately NOT treated as an intersection: a move
-- sliding exactly ALONG a wall is legal, and the alternative traps a token that
-- is already touching one.
create or replace function private.segments_cross(
  p1x double precision, p1y double precision,
  p2x double precision, p2y double precision,
  p3x double precision, p3y double precision,
  p4x double precision, p4y double precision
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d1 double precision;
  d2 double precision;
  d3 double precision;
  d4 double precision;
begin
  -- Cross products: which side of segment 3-4 does each of 1 and 2 fall on, and
  -- vice versa. Opposite signs on both counts means a proper crossing.
  d1 := (p4x - p3x) * (p1y - p3y) - (p4y - p3y) * (p1x - p3x);
  d2 := (p4x - p3x) * (p2y - p3y) - (p4y - p3y) * (p2x - p3x);
  d3 := (p2x - p1x) * (p3y - p1y) - (p2y - p1y) * (p3x - p1x);
  d4 := (p2x - p1x) * (p4y - p1y) - (p2y - p1y) * (p4x - p1x);

  return ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0))
     and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0));
end;
$$;

comment on function private.segments_cross(double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) is
  'True if two segments properly cross. Collinear touching is NOT a crossing — moving along a wall is legal. Backs the movement guard in migration 0063.';

-- Does the path from (x1,y1) to (x2,y2) cross any wall on this map?
--
-- SECURITY DEFINER because it reads playspace_walls, which the player whose
-- move is being checked cannot read (0061) — the whole point. It returns only a
-- boolean, so it cannot be used to probe where the walls actually are beyond
-- what the player learns by bumping into one, which they would learn anyway.
create or replace function private.path_crosses_wall(
  p_map_id uuid,
  x1 double precision, y1 double precision,
  x2 double precision, y2 double precision
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.playspace_walls w,
    lateral (
      -- Expand the point list into consecutive pairs. `closed` walls also get
      -- the edge from the last point back to the first — without it, a sealed
      -- room has an invisible doorway exactly where the loop closes, which is
      -- the same bug segmentsOf guards against on the client.
      select
        (pt.value -> 0)::double precision as ax,
        (pt.value -> 1)::double precision as ay,
        (nxt.value -> 0)::double precision as bx,
        (nxt.value -> 1)::double precision as by
      from jsonb_array_elements(w.points) with ordinality as pt(value, idx)
      join jsonb_array_elements(w.points) with ordinality as nxt(value, idx)
        on nxt.idx = pt.idx + 1
      union all
      select
        (last_pt.value -> 0)::double precision,
        (last_pt.value -> 1)::double precision,
        (first_pt.value -> 0)::double precision,
        (first_pt.value -> 1)::double precision
      from jsonb_array_elements(w.points) with ordinality as last_pt(value, idx)
      cross join lateral (select w.points -> 0 as value) as first_pt
      where w.closed
        and last_pt.idx = jsonb_array_length(w.points)
        and jsonb_array_length(w.points) > 2
    ) as seg
    where w.map_id = p_map_id
      and private.segments_cross(x1, y1, x2, y2, seg.ax, seg.ay, seg.bx, seg.by)
  );
$$;

comment on function private.path_crosses_wall(uuid, double precision, double precision, double precision, double precision) is
  'True if the straight path between two points crosses a wall on the map. SECURITY DEFINER: reads walls the caller cannot (0061), and returns only a boolean.';

-- The guard itself.
create or replace function private.forbid_move_through_wall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vision boolean;
begin
  -- Only a MOVE. Editing a label or a colour is not a path.
  if new.x is not distinct from old.x and new.y is not distinct from old.y then
    return new;
  end if;

  -- The DM is exempt: they draw the walls and stage what is behind them.
  if private.is_campaign_dm(private.playspace_map_campaign(new.map_id)) then
    return new;
  end if;

  -- Only on maps that actually use vision, so a campaign using walls as scenery
  -- keeps the movement it has always had.
  select m.vision_enabled into v_vision
  from public.playspace_maps m where m.id = new.map_id;
  if not coalesce(v_vision, false) then
    return new;
  end if;

  if private.path_crosses_wall(new.map_id, old.x, old.y, new.x, new.y) then
    raise exception 'that move crosses a wall'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists playspace_tokens_forbid_wall_move on public.playspace_tokens;
create trigger playspace_tokens_forbid_wall_move
  before update on public.playspace_tokens
  for each row
  execute function private.forbid_move_through_wall();

-- ---------------------------------------------------------------------------
-- Self-assertions on the geometry, because a sign error here silently lets
-- every wall be walked through and nothing else would notice.
-- ---------------------------------------------------------------------------
do $$
begin
  -- A clean crossing.
  if not private.segments_cross(0, 0, 10, 10, 10, 0, 0, 10) then
    raise exception '0063: segments_cross missed a plain crossing';
  end if;
  -- Parallel, and separated.
  if private.segments_cross(0, 0, 10, 0, 0, 5, 10, 5) then
    raise exception '0063: segments_cross reported parallel lines as crossing';
  end if;
  -- Would cross if extended, but the segments do not reach.
  if private.segments_cross(0, 0, 1, 1, 10, 0, 0, 10) then
    raise exception '0063: segments_cross extended a segment beyond its end';
  end if;
  -- Collinear along the same line: legal, not a crossing.
  if private.segments_cross(0, 0, 10, 0, 5, 0, 15, 0) then
    raise exception '0063: segments_cross treated sliding along a wall as crossing';
  end if;
end $$;
