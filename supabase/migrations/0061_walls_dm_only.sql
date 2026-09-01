-- ============================================================================
-- 0061 — walls become DM-only (Phase 9.2.1, revised)
--
-- 0060 made walls member-readable, on the reasoning that client-side vision
-- needs the walls client-side. The owner chose the stronger model instead, so
-- this withdraws that read before any UI is built on it.
--
-- WHAT THIS COSTS, stated plainly: vision can no longer be computed in the
-- player's browser, because the player's browser will not have the walls. 9.3
-- must therefore compute each token's visibility SERVER-SIDE and return only the
-- resulting polygon — the geometry the player is allowed to know. That is a
-- materially bigger piece of work than reading walls locally, and it is the
-- whole point: what the client never receives, it cannot leak.
--
-- WHY NOW RATHER THAN LATER. Widening a read is easy; narrowing one after a
-- feature depends on it is not. 9.2's drawing tools are DM-only either way, so
-- flipping this before 9.3 exists costs nothing. Flipping it afterwards would
-- mean rewriting the vision system.
--
-- The DM keeps full read/write: they are the one drawing the walls.
-- ============================================================================

drop policy if exists playspace_walls_select_members on public.playspace_walls;

create policy playspace_walls_select_dm
  on public.playspace_walls for select to authenticated
  using (private.is_campaign_dm(private.playspace_map_campaign(map_id)));

comment on policy playspace_walls_select_dm on public.playspace_walls is
  'Only the campaign DM may read walls. Players receive computed visibility polygons instead (9.3), never the geometry that produced them — see migration 0061.';

comment on table public.playspace_walls is
  'Sight-blocking obstructions on a battlemap (Phase 9.2). Geometry is an ordered point list in MAP PIXELS. DM-ONLY in both directions: a player never receives wall geometry, only the visibility polygon computed from it server-side (0061).';

-- ---------------------------------------------------------------------------
-- Self-assertion: exactly one SELECT policy, and it must not mention
-- is_campaign_member. A second policy would be OR-ed with this one and would
-- silently restore the read this migration exists to remove.
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_bad int;
begin
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'playspace_walls' and cmd = 'SELECT';
  if v_n <> 1 then
    raise exception '0061: playspace_walls has % SELECT policies, expected 1', v_n;
  end if;

  select count(*) into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = 'playspace_walls'
    and cmd = 'SELECT' and coalesce(qual, '') like '%is_campaign_member%';
  if v_bad > 0 then
    raise exception '0061: a walls SELECT policy still admits any campaign member';
  end if;
end $$;
