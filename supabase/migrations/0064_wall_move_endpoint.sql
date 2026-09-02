-- ============================================================================
-- 0064 — close the two-step wall crossing (fixes 0063)
--
-- 0063 defined "crossing" as a PROPER intersection: the two segments must
-- straddle each other. That deliberately allowed a move that slides ALONG a
-- wall, which is correct — but it also allowed a move that ENDS exactly on one,
-- and that is an exploit, not a nicety:
--
--   move 1: from your side, to a point exactly on the wall  -> endpoint touch,
--           not a proper crossing, allowed;
--   move 2: from that point, to the far side                -> the start is ON
--           the line, so again not a proper crossing, allowed.
--
-- Two legal moves, one wall crossed. Found by the RLS matrix on its first run:
-- the assertion I wrote happened to land its destination exactly on the wall,
-- and reported ALLOWED. I had written the test case badly, and the bad test case
-- was a working exploit.
--
-- THE FIX: a move may not END on a wall. Landing on one is now refused, so the
-- first step of the pair never happens.
--
-- Deliberately asymmetric — the START is not checked. A token can legitimately
-- already be on a wall: the DM may draw one across a token that is standing
-- there. Blocking movement in that case would TRAP the token permanently, with
-- no way out and no explanation. Being able to step off a wall you were caught
-- under is the right behaviour; being able to step onto one is not.
-- ============================================================================

-- Is a point on a segment, within a small tolerance?
--
-- The tolerance is in MAP PIXELS and is deliberately generous: exact float
-- equality would be defeated by a coordinate a fraction of a pixel off the line,
-- which is precisely what a crafted request would send. Half a pixel is
-- invisible to a player and leaves no usable gap.
create or replace function private.point_on_segment(
  px double precision, py double precision,
  ax double precision, ay double precision,
  bx double precision, by double precision,
  tol double precision default 0.5
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  dx double precision := bx - ax;
  dy double precision := by - ay;
  len_sq double precision;
  t double precision;
  cx double precision;
  cy double precision;
begin
  len_sq := dx * dx + dy * dy;
  -- Degenerate segment: compare against the point itself rather than dividing
  -- by zero.
  if len_sq = 0 then
    return sqrt((px - ax) ^ 2 + (py - ay) ^ 2) <= tol;
  end if;
  -- Project onto the segment and clamp, so a point beyond an end is measured to
  -- that end rather than to the infinite line.
  t := ((px - ax) * dx + (py - ay) * dy) / len_sq;
  t := greatest(0, least(1, t));
  cx := ax + t * dx;
  cy := ay + t * dy;
  return sqrt((px - cx) ^ 2 + (py - cy) ^ 2) <= tol;
end;
$$;

comment on function private.point_on_segment(double precision, double precision, double precision, double precision, double precision, double precision, double precision) is
  'True if a point lies on a segment within a tolerance. Used to refuse a move that ENDS on a wall, which would otherwise let a wall be crossed in two legal steps — see migration 0064.';

-- Rewritten to consider both the crossing and the destination.
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
      select
        (pt.value -> 0)::double precision as ax,
        (pt.value -> 1)::double precision as ay,
        (nxt.value -> 0)::double precision as bx,
        (nxt.value -> 1)::double precision as by
      from jsonb_array_elements(w.points) with ordinality as pt(value, idx)
      join jsonb_array_elements(w.points) with ordinality as nxt(value, idx)
        on nxt.idx = pt.idx + 1
      union all
      -- The closing edge of a closed shape. Without it a sealed room has an
      -- invisible doorway exactly where the loop closes.
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
      and (
        private.segments_cross(x1, y1, x2, y2, seg.ax, seg.ay, seg.bx, seg.by)
        -- ...or the move ENDS on the wall. See the header: this is what stops
        -- the two-step crossing. The start is deliberately not checked.
        or private.point_on_segment(x2, y2, seg.ax, seg.ay, seg.bx, seg.by)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Self-assertions for the new rule.
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.point_on_segment(5, 5, 0, 0, 10, 10) then
    raise exception '0064: point_on_segment missed a point on the line';
  end if;
  if private.point_on_segment(5, 8, 0, 0, 10, 10) then
    raise exception '0064: point_on_segment accepted a point well off the line';
  end if;
  -- Beyond the end of the segment is NOT on it.
  if private.point_on_segment(20, 20, 0, 0, 10, 10) then
    raise exception '0064: point_on_segment extended the segment past its end';
  end if;
  -- Degenerate segment must not divide by zero.
  if not private.point_on_segment(1, 1, 1, 1, 1, 1) then
    raise exception '0064: point_on_segment mishandled a zero-length segment';
  end if;
end $$;
