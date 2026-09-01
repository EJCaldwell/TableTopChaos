-- ============================================================================
-- 0060 — sight-blocking obstructions (Phase 9.2.1)
--
-- A wall is an ordered list of points in MAP PIXELS — the same coordinate space
-- as tokens (0048 decision 1), so a wall and the token standing against it stay
-- together at any zoom and through any re-grid. A straight segment is a
-- two-point list; a rectangle is a closed four-point list; a freehand shape is a
-- long one. ONE geometry type for all three, because "which tool drew this" is a
-- UI concern and the vision maths in 9.3 only ever wants line segments.
--
-- `kind` is kept anyway, but only so the editor can offer the right handles when
-- you come back to an existing wall. Nothing in the sight calculation reads it.
--
-- ---------------------------------------------------------------------------
-- THE VISIBILITY DECISION, recorded because it is not reversible for free.
--
-- Walls are MEMBER-READABLE, as planned. That means a player's browser holds the
-- geometry of every wall on the live map, including walls around rooms they have
-- not entered — so a determined player can read the map's layout out of the
-- network tab, whatever the fog on screen shows.
--
-- This is the standard trade: client-side vision needs the walls client-side.
-- The alternative is computing each token's visibility polygon on the server and
-- shipping only the result, which is what the larger VTTs do and is a
-- substantially bigger piece of work — a Postgres function or an Edge Function
-- doing ray casting per token per move, on every move.
--
-- Taking the cheaper option deliberately, for a tool whose own README calls it a
-- glorified notepad: fog here is an aid to play, not an anti-cheat system. It is
-- recorded in PLANNING under 9.2 so nobody later reads the fog as a security
-- boundary, which is the failure mode that actually matters.
-- ============================================================================

-- Validates a point list: an array of at least two [x, y] number pairs.
-- IMMUTABLE so it can be used in a CHECK constraint.
create or replace function private.is_point_list(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) between 2 and 2000
     and not exists (
       select 1
       from jsonb_array_elements(p) as pt
       where jsonb_typeof(pt.value) <> 'array'
          or jsonb_array_length(pt.value) <> 2
          or jsonb_typeof(pt.value -> 0) <> 'number'
          or jsonb_typeof(pt.value -> 1) <> 'number'
     );
$$;

comment on function private.is_point_list(jsonb) is
  'True if the value is an array of 2..2000 [x, y] number pairs. Backs the playspace_walls geometry CHECK; IMMUTABLE so a constraint may call it.';

create table public.playspace_walls (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.playspace_maps (id) on delete cascade,

  -- Which tool drew it. Display/editing only — the sight maths reads `points`.
  kind text not null default 'segment'
    check (kind in ('segment', 'rect', 'freehand')),

  -- Ordered [x, y] pairs in MAP PIXELS. The 2000-point ceiling is a guard
  -- against a freehand stroke recorded per mouse event: at that size the sight
  -- calculation is already the bottleneck, and nothing legible needs more.
  points jsonb not null check (private.is_point_list(points)),

  -- Rectangles and closed polygons join the last point back to the first. Stored
  -- rather than inferred from kind, so a freehand loop can be closed too.
  closed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.playspace_walls is
  'Sight-blocking obstructions on a battlemap (Phase 9.2). Geometry is an ordered point list in MAP PIXELS. Readable by every campaign member — see the visibility note in migration 0060: fog is a play aid here, not an anti-cheat boundary.';

create index playspace_walls_map_idx on public.playspace_walls (map_id);

create trigger playspace_walls_set_updated_at
  before update on public.playspace_walls
  for each row execute function public.set_updated_at();

alter table public.playspace_walls enable row level security;

-- Read: any member of the campaign the map belongs to. Reuses the same helper
-- the token policies use, so walls and tokens can never disagree about who is
-- in a campaign.
create policy playspace_walls_select_members
  on public.playspace_walls for select to authenticated
  using (private.is_campaign_member(private.playspace_map_campaign(map_id)));

-- Write: the DM only, and only while the campaign is writable. Walls are map
-- construction, which is the DM's job in every mode.
create policy playspace_walls_insert_dm
  on public.playspace_walls for insert to authenticated
  with check (private.dm_can_write(private.playspace_map_campaign(map_id)));

create policy playspace_walls_update_dm
  on public.playspace_walls for update to authenticated
  using (private.dm_can_write(private.playspace_map_campaign(map_id)))
  with check (private.dm_can_write(private.playspace_map_campaign(map_id)));

create policy playspace_walls_delete_dm
  on public.playspace_walls for delete to authenticated
  using (private.dm_can_write(private.playspace_map_campaign(map_id)));

-- Realtime, so a wall drawn mid-session appears for everyone. REPLICA IDENTITY
-- FULL for the same reason as tokens (0048): without it a DELETE payload has no
-- id and mergeById cannot tell which wall to remove.
alter table public.playspace_walls replica identity full;
alter publication supabase_realtime add table public.playspace_walls;

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  -- The geometry CHECK must actually reject rubbish, or every later assumption
  -- in the sight maths is unfounded.
  if private.is_point_list('[]'::jsonb)
     or private.is_point_list('[[0,0]]'::jsonb)
     or private.is_point_list('[[0,0],[1]]'::jsonb)
     or private.is_point_list('[[0,0],["a",1]]'::jsonb)
     or private.is_point_list('{"x":1}'::jsonb)
     or private.is_point_list('null'::jsonb) then
    raise exception '0060: is_point_list accepted an invalid geometry';
  end if;
  if not private.is_point_list('[[0,0],[10,10]]'::jsonb)
     or not private.is_point_list('[[0,0],[10,10],[20,0]]'::jsonb) then
    raise exception '0060: is_point_list rejected a valid geometry';
  end if;
end $$;
