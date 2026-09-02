-- ============================================================================
-- 0067 — walls that block sight but not movement (owner request 2026-09-02)
--
-- A wall has been doing two jobs since 0060: stopping sight and stopping
-- movement. Most obstructions do both — a stone wall is a stone wall — but
-- plenty do neither together, and a DM had no way to say so:
--
--   * a curtain, a thick hedge, a bank of fog, a dark doorway: you cannot see
--     through it, you can walk through it;
--   * conversely a chasm or a railing stops movement while you see straight
--     over it — that is the other half of the same idea, and is left for later
--     rather than guessed at now.
--
-- This adds the first half: `blocks_movement`, default TRUE so every wall that
-- already exists keeps behaving exactly as it does today. Unticking it makes a
-- sight-only wall — what the request called a "fog wall".
--
-- WHY A COLUMN AND NOT A NEW `kind`. `kind` records which TOOL drew a wall
-- (segment/rect/freehand) and nothing reads it for behaviour. Overloading it
-- with a behavioural meaning would make one field answer two unrelated
-- questions, and the sight/movement pair wants to be two independent booleans
-- anyway — the chasm case above needs the other combination.
-- ============================================================================

alter table public.playspace_walls
  add column if not exists blocks_movement boolean not null default true;

comment on column public.playspace_walls.blocks_movement is
  'Whether this wall stops a player walking through it. Sight is always blocked — that is what a wall IS here. False makes a sight-only obstruction: a curtain, a hedge, a bank of fog. Default true, so walls drawn before 0067 are unchanged.';

-- The movement check now ignores sight-only walls. Sight is untouched: the
-- vision function reads every wall on the map and always will, because a
-- curtain you can walk through is still a curtain you cannot see through.
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
      -- 0067. The only line that changed: a sight-only wall is not a barrier.
      and w.blocks_movement
      and (
        private.segments_cross(x1, y1, x2, y2, seg.ax, seg.ay, seg.bx, seg.by)
        or private.point_on_segment(x2, y2, seg.ax, seg.ay, seg.bx, seg.by)
      )
  );
$$;

-- Every existing wall must still block movement, or this migration would open
-- every dungeon already drawn.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.playspace_walls where not blocks_movement;
  if v_bad > 0 then
    raise exception '0067: % existing wall(s) stopped blocking movement', v_bad;
  end if;
end $$;
