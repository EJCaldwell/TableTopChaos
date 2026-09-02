-- ============================================================================
-- 0066 — walls the players can see (Phase 9.2/9.3, owner request 2026-09-02)
--
-- 0061 made walls DM-only, and everything since has been built on that: vision
-- is computed server-side precisely so a player's client never receives wall
-- geometry. This migration puts a door in that rule, and the shape of the door
-- matters more than the feature.
--
-- OPT-IN PER WALL, DEFAULT FALSE. A wall is invisible to players unless the DM
-- deliberately marks it visible. That keeps the DEFAULT the safe one: a DM who
-- never touches this setting has exactly the privacy 0061 gave them, and the
-- walls that leak are only the ones they chose to show.
--
-- WHY IT IS WORTH HAVING. Not every wall is a secret. A visible wall is scenery
-- the party can see and reason about — the edge of a chasm, a portcullis, the
-- side of a building. Hiding those makes the map harder to read for no benefit,
-- because the players can already see the picture the wall is drawn on.
--
-- WHAT THE PLAYER GETS. The geometry of walls marked visible, and nothing else.
-- A hidden wall is still absent from every response they can obtain — the point
-- of 0061 survives, narrowed to the walls that are actually secret.
--
-- NOTE ON 0061'S ASSERTION. That migration asserted playspace_walls had exactly
-- ONE select policy and that it did not mention is_campaign_member, precisely so
-- a later change could not silently restore the member read. This migration is
-- that later change — made deliberately, with the assertion updated rather than
-- deleted: it now requires exactly TWO, and that any member-facing one is gated
-- on visible_to_players. A future third policy still fails the deploy.
-- ============================================================================

alter table public.playspace_walls
  add column if not exists visible_to_players boolean not null default false;

comment on column public.playspace_walls.visible_to_players is
  'When true, campaign members may READ this wall''s geometry and the client draws it. Default false: a wall is secret unless the DM says otherwise. See migration 0066 — this is a deliberate, per-wall exception to 0061.';

create policy playspace_walls_select_visible
  on public.playspace_walls for select to authenticated
  using (
    visible_to_players
    and private.is_campaign_member(private.playspace_map_campaign(map_id))
  );

comment on policy playspace_walls_select_visible on public.playspace_walls is
  'Members may read walls the DM has marked visible. Hidden walls remain DM-only (0061) — a player never receives their geometry.';

-- ---------------------------------------------------------------------------
-- The updated structural assertion. Exactly two SELECT policies, and any that
-- admits an ordinary member must be gated on visible_to_players — so a third
-- policy, or a member-facing one without the gate, fails the deploy.
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'playspace_walls' and cmd = 'SELECT';
  if v_n <> 2 then
    raise exception '0066: playspace_walls has % SELECT policies, expected 2', v_n;
  end if;

  select string_agg(policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = 'playspace_walls' and cmd = 'SELECT'
    and coalesce(qual, '') like '%is_campaign_member%'
    and coalesce(qual, '') not like '%visible_to_players%';
  if v_bad is not null then
    raise exception '0066: member-facing walls policy without the visibility gate: %', v_bad;
  end if;
end $$;

-- Every existing wall must stay hidden, or this migration would reveal the
-- layout of every map already drawn.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.playspace_walls where visible_to_players;
  if v_bad > 0 then
    raise exception '0066: % existing wall(s) defaulted to visible', v_bad;
  end if;
end $$;
