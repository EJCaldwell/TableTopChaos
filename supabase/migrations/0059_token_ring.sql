-- ============================================================================
-- 0059 — per-token ring control, DM-set (9.1.2h)
--
-- 0058 made the ring automatic: shown on a token with no artwork, hidden on one
-- with a picture. That is the right DEFAULT and the wrong RULE — a DM may well
-- want a ring on an illustrated token to mark a side, an aura or a condition,
-- and may want no ring at all on a plain marker being used as a scenery blob.
--
-- WHY A THREE-VALUE TEXT AND NOT A BOOLEAN. A boolean would force every existing
-- token to a fixed answer and lose the automatic behaviour entirely; a nullable
-- boolean would express it but reads as "unknown" rather than "decide for me".
-- 'auto' says exactly what it means, keeps today's behaviour as the default for
-- every row that already exists, and leaves 'on'/'off' as deliberate overrides.
--
-- DM-ONLY, like size (0057) and for the same reason: how a piece LOOKS is the
-- DM's call, where it stands is the player's. Enforced by extending the existing
-- trigger rather than adding a second one, so there is one place that answers
-- "which columns may a player not touch?" — two triggers would eventually
-- disagree.
-- ============================================================================

alter table public.playspace_tokens
  add column if not exists ring text not null default 'auto'
    check (ring in ('auto', 'on', 'off'));

comment on column public.playspace_tokens.ring is
  'Whether to draw the colour ring: auto (ring only when the token has no artwork — the default and the 0058 behaviour), on (always), off (never). DM-set; see migration 0059.';

-- Replaces the 0057 function. Same trigger, now guarding both appearance
-- columns. Named for what it protects rather than for one column, since that is
-- what it has become.
create or replace function private.forbid_player_token_resize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Appearance is the DM's; position is the player's. Both columns are checked
  -- in one place so they cannot drift apart.
  if (new.size_cells is distinct from old.size_cells
      or new.ring is distinct from old.ring)
     and not private.is_campaign_dm(private.playspace_map_campaign(new.map_id)) then
    raise exception 'only the DM may change a token''s appearance'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function private.forbid_player_token_resize() is
  'Blocks a non-DM from changing a token''s APPEARANCE columns (size_cells since 0057, ring since 0059). A trigger rather than a policy because WITH CHECK cannot see a row''s previous value — see migration 0053.';

-- Every existing token must keep the behaviour it had, or this migration would
-- silently restyle every board in production.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.playspace_tokens where ring <> 'auto';
  if v_bad > 0 then
    raise exception '0059: % token(s) did not default to ring = auto', v_bad;
  end if;
end $$;
