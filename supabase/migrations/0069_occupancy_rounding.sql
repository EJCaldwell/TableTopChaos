-- ============================================================================
-- 0069 — the occupancy tolerance could not absorb integer rounding (fixes 0068)
--
-- 0068 allowed footprints to overlap by 0.25px before calling it a collision, so
-- that tokens in ADJACENT squares — whose footprints share an edge exactly —
-- were not refused. That tolerance is too small, and the reason is in the
-- schema rather than in the geometry.
--
-- **Token coordinates are INTEGERS** (`x int` / `y int`, migration 0048), but a
-- snapped position often is not. A cell centre sits at `offset + grid/2 +
-- k*grid`, so an ODD grid size puts every 1x1 token on a half pixel, and it is
-- stored rounded. On the owner's map (grid 85) a centre of 802.5 is stored as
-- 803 — and that half pixel moves the token's edge half a pixel INTO its
-- neighbour. Both tokens round, so the gap can be wrong by a full pixel.
--
-- THE SYMPTOM WAS ASYMMETRIC, which is what made it look like a sizing bug: on
-- one side rounding pushes the neighbour AWAY and nothing happens; on the other
-- it pushes TOWARD and the square is refused. Reported as "the 2x2 is acting
-- like a 3x3 — the left and top have an extra row/column" (2026-09-02).
--
-- IT ONLY EVER APPEARED ON AN ODD GRID. Every test, every probe and the RLS
-- matrix fixture use 70, where grid/2 is exact and nothing rounds.
--
-- 1.5px leaves margin over the 1px worst case and stays far below anything real:
-- the smallest legitimate overlap is a half-size token's half cell, which is
-- 2.5px even at the schema's minimum grid of 10. Must match OCCUPANCY_EPSILON in
-- `grid.ts`; the two definitions have to agree and this note is the only link.
-- ============================================================================

create or replace function private.token_space_taken(
  p_map_id uuid,
  p_token_id uuid,
  p_x double precision,
  p_y double precision,
  p_size numeric
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  with me as (
    select
      p_x - (p_size * m.grid_size) / 2 as l,
      p_x + (p_size * m.grid_size) / 2 as r,
      p_y - (p_size * m.grid_size) / 2 as t,
      p_y + (p_size * m.grid_size) / 2 as b,
      m.grid_size
    from public.playspace_maps m
    where m.id = p_map_id
  )
  select exists (
    select 1
    from public.playspace_tokens o, me
    where o.map_id = p_map_id
      and o.id is distinct from p_token_id
      -- 1.5, not 0.25 — see the header. Integer coordinates plus an odd grid
      -- size mean each edge can be half a pixel out, and two tokens round
      -- independently.
      and me.l < o.x + (o.size_cells * me.grid_size) / 2 - 1.5
      and me.r > o.x - (o.size_cells * me.grid_size) / 2 + 1.5
      and me.t < o.y + (o.size_cells * me.grid_size) / 2 - 1.5
      and me.b > o.y - (o.size_cells * me.grid_size) / 2 + 1.5
  );
$$;

comment on function private.token_space_taken(uuid, uuid, double precision, double precision, numeric) is
  'Does any OTHER token on this map overlap the given footprint? Footprints are squares of size_cells x grid_size centred on the token. Tolerance 1.5px: adjacent tokens share an edge exactly, and integer coordinates on an odd grid put each edge up to half a pixel out (0069).';
