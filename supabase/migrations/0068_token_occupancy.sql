-- ============================================================================
-- 0068 — two tokens may not occupy the same space (owner request 2026-09-02)
--
-- A token is drawn centred on its coordinate and is `size_cells` squares
-- across, so it occupies a square of side `size_cells * grid_size` centred on
-- that point. Two tokens collide when those squares overlap.
--
-- WHY THE SERVER AND NOT JUST THE CLIENT. The client already refuses the move,
-- which is what makes the rule FEEL right — the token stops rather than
-- springing back. But the client check is a convenience: it binds this app and
-- nothing else, and a direct PostgREST call would walk straight through another
-- creature. Same split as walls (0063/0064) and for the same reason.
--
-- WHY A TRIGGER AND NOT A CONSTRAINT. The rule is about a row's relationship to
-- OTHER ROWS, which a check constraint cannot see. An exclusion constraint
-- could, but only over a fixed geometry — and a token's footprint depends on the
-- MAP's current grid_size, which lives in another table and changes. Making the
-- footprint a stored column would then have to be recomputed for every token
-- whenever the DM nudges the grid.
--
-- THE DM IS NOT EXEMPT, unlike the wall rules. A DM may cross a wall because a
-- wall is a fiction they authored. Two creatures in one square is not a fiction;
-- it is a mistake, and one that goes unnoticed until initiative order stops
-- making sense.
--
-- TOLERANCE. Tokens in ADJACENT squares share an edge exactly, and rounding puts
-- that shared coordinate a fraction either side of the line depending on which
-- direction the token arrived from. A strict overlap test would refuse legal
-- side-by-side placement intermittently — the shape of a bug nobody can
-- reproduce. The epsilon matches OCCUPANCY_EPSILON in `grid.ts`; the two
-- definitions must agree, and this comment is the only thing linking them.
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
      -- Excluding the row being moved. Without this every token collides with
      -- where it already is and nothing can move at all.
      and o.id is distinct from p_token_id
      and me.l < o.x + (o.size_cells * me.grid_size) / 2 - 0.25
      and me.r > o.x - (o.size_cells * me.grid_size) / 2 + 0.25
      and me.t < o.y + (o.size_cells * me.grid_size) / 2 - 0.25
      and me.b > o.y - (o.size_cells * me.grid_size) / 2 + 0.25
  );
$$;

comment on function private.token_space_taken(uuid, uuid, double precision, double precision, numeric) is
  'Does any OTHER token on this map overlap the given footprint? Footprints are squares of size_cells x grid_size centred on the token. Tolerance 0.25px so tokens in adjacent squares, which share an edge exactly, do not count as overlapping.';

create or replace function private.forbid_token_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when the footprint actually changes. An update that touches a label or
  -- a colour must not be refused because the token is standing where it already
  -- stands, and re-running the check would cost a scan on every edit.
  if tg_op = 'UPDATE'
     and new.x = old.x and new.y = old.y and new.size_cells = old.size_cells
     and new.map_id = old.map_id then
    return new;
  end if;

  if private.token_space_taken(new.map_id, new.id, new.x, new.y, new.size_cells) then
    raise exception 'Another token is already in that space'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists forbid_token_overlap on public.playspace_tokens;
create trigger forbid_token_overlap
  before insert or update on public.playspace_tokens
  for each row execute function private.forbid_token_overlap();

-- Any token already overlapping another would be frozen: every future update to
-- it re-runs the check and fails. Report rather than "fix", because moving
-- someone's piece without telling them is worse than saying so.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.playspace_tokens t
  where private.token_space_taken(t.map_id, t.id, t.x, t.y, t.size_cells);
  if v_bad > 0 then
    raise warning '0068: % token(s) currently overlap another and must be moved apart before they can be edited', v_bad;
  end if;
end $$;
