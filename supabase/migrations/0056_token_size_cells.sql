-- ============================================================================
-- 0056 — token size measured in SQUARES, not pixels (9.1.2e)
--
-- Owner request: a token may be half a square, or two, three or four squares
-- across. Plus a related fix: a token must stay the right size when the DM
-- changes the grid.
--
-- WHY A NEW COLUMN RATHER THAN REUSING size_px. `size_px` is an absolute
-- measurement, and the moment the DM adjusts the grid it is wrong — a 70px token
-- on a 64px grid is not "one square", it is a token that no longer fits its
-- board. Storing the MULTIPLE instead makes the relationship the stored fact:
-- one square stays one square through every grid change, with no writes and
-- nothing to keep in step.
--
-- This is the same lesson as 0048 decision 1 (positions in map pixels, not
-- cells) arriving at the opposite answer, and for a reason worth writing down:
-- position is anchored to the PICTURE, which is why pixels are right for it;
-- size is anchored to the GRID, which is why squares are right for this. The
-- question to ask of each is "what does this measurement belong to?".
--
-- `size_px` is left in place and still written, unread by display. Dropping a
-- column in the same migration that stops using it makes the change hard to
-- reverse if the sizing rule turns out to be wrong at a real table.
-- ============================================================================

alter table public.playspace_tokens
  add column if not exists size_cells numeric(3, 1) not null default 1
    -- An explicit list, not a range: these are the sizes the UI offers, and a
    -- free numeric would let a client store 2.7 squares, which nothing can draw
    -- sensibly and which no rule elsewhere expects.
    check (size_cells in (0.5, 1, 2, 3, 4));

comment on column public.playspace_tokens.size_cells is
  'Token diameter in GRID SQUARES (0.5, 1, 2, 3 or 4). Multiplied by the map''s current grid_size at render time, so a token keeps its size in squares when the DM re-grids the map. Supersedes size_px for display — see migration 0056.';

-- The permission story does not change: size is part of the token row, so it is
-- already covered by the existing update policies. A player may resize only
-- their own token, a DM may resize any token on their map, and neither may do it
-- in a lapsed campaign. Asserted below rather than assumed.
do $$
declare v_bad int;
begin
  -- Every existing token must have defaulted to exactly one square. A different
  -- value here would mean the default did not apply and some tokens silently
  -- changed size on deploy.
  select count(*) into v_bad from public.playspace_tokens where size_cells <> 1;
  if v_bad > 0 then
    raise exception '0056: % token(s) did not default to 1 square', v_bad;
  end if;
end $$;
