-- ============================================================================
-- 0048_playspace_maps_tokens.sql — Phase 9.1.1: the shared battlemap.
--
-- Two tables: a map per campaign (background image + grid), and the tokens on
-- it. Vision, walls and lighting are 9.2–9.4; `vision_enabled` lands here so the
-- toggle exists before the machinery behind it does.
--
-- ============================================================================
-- FOUR DESIGN DECISIONS, recorded because each is cheap to change now and
-- expensive once a canvas is built on top.
--
-- 1. TOKEN POSITION IS IN PIXELS, in map-image space — not grid cells.
--    Grid cells would make snapping trivial and survive a grid-size change with
--    tokens still aligned. Pixels win anyway for two reasons: a battlemap image
--    usually has its own grid drawn on it, so grid_size exists to ALIGN the
--    overlay to the picture rather than to define the coordinate system; and
--    off-grid placement (a token between squares, a swarm, a prone body) is
--    common and would otherwise need a schema change.
--    **Consequence, stated plainly: changing grid_size does NOT re-snap existing
--    tokens.** They keep their pixel position and may sit off the new grid. If
--    that turns out to matter, the fix is a one-off re-snap, not a migration.
--
-- 2. `owner_user_id` IS THE AUTHORITY; character_id / npc_id are just links.
--    The RLS predicate is `owner_user_id = auth.uid()` and nothing else. Deriving
--    ownership through character_id would mean a policy that joins to characters
--    — slower, and it couples token permissions to a table whose own policies
--    (owner-or-DM) already differ from what is wanted here. NULL owner means
--    DM-controlled: monsters, props, anything the players must not drag.
--
-- 3. MAP DIMENSIONS ARE EXPLICIT, not read from the image. The server never
--    decodes the file, and an explicit size lets a DM present a crop or extend
--    the canvas past the artwork. The client fills them in from the uploaded
--    image; nothing here has to know what a PNG is.
--
-- 4. ONE ACTIVE MAP PER CAMPAIGN, enforced by a partial unique index rather than
--    by convention. "Exactly one live map" is the behaviour everyone at a table
--    expects, and a database invariant cannot drift from it the way application
--    code can. Inactive maps stay for prep.
--
-- ============================================================================
-- THE READ-ONLY LOCK — and a gap this migration does NOT close.
--
-- Write policies here call `private.campaign_is_active(campaign_id)`, so a
-- lapsed campaign's battlemap is frozen: readable, not editable.
--
-- **These are the FIRST content-table policies in the project to do that.** The
-- 1.5 QA note (QA/1.5_tests/read-only-lock.md) instructed every phase that adds
-- a content table to include this check. Phases 2, 3 and 4 did not, and nobody
-- noticed: 0 of the 69 existing write policies enforce the lock. It is currently
-- invisible because `enforce_active` is false, so campaign_is_active() returns
-- true for everything.
--
-- After the launch flip that gap means a lapsed campaign stays fully writable —
-- the paywall would gate joining and uploads but not editing, and the Refunds
-- page's "nobody can write" would be false. Tracked in PRE_LAUNCH as a blocker on
-- the flip. Doing it right here rather than matching the existing pattern, so the
-- sweep has one fewer table to fix.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Maps
-- ----------------------------------------------------------------------------
create table public.playspace_maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,

  name text not null default 'Battlemap' check (char_length(name) between 1 and 120),

  -- Background image, through the existing 1.6 pipeline. SET NULL rather than
  -- CASCADE: a media takedown must not destroy the map, its grid and every token
  -- placed on it — the DM can re-upload a background.
  background_asset_id uuid references public.media_assets (id) on delete set null,

  -- Overlay spacing in pixels. 70 is the common VTT default (a 5-ft square).
  grid_size int not null default 70 check (grid_size between 10 and 500),

  -- Explicit canvas size — see decision 3.
  width_px int not null default 1400 check (width_px between 100 and 20000),
  height_px int not null default 900 check (height_px between 100 and 20000),

  -- The one map players currently see. See decision 4.
  is_active boolean not null default false,

  -- 9.2+. Present now so the column exists before the vision system does;
  -- false means no fog and the whole map is visible to everyone.
  vision_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.playspace_maps is
  'A battlemap for a campaign (Phase 9.1). At most one is_active per campaign, '
  'enforced by playspace_maps_one_active_idx. Only meaningful in playspace/rpg '
  'campaigns; game_mode is gated at read time in the UI, not here — see 0028.';

create index playspace_maps_campaign_idx on public.playspace_maps (campaign_id);

-- Decision 4 as an invariant. Partial, so any number of INACTIVE maps can exist.
create unique index playspace_maps_one_active_idx
  on public.playspace_maps (campaign_id) where is_active;

create trigger playspace_maps_set_updated_at
  before update on public.playspace_maps
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Tokens
-- ----------------------------------------------------------------------------
create table public.playspace_tokens (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.playspace_maps (id) on delete cascade,

  -- WHO MAY MOVE THIS. NULL = DM-controlled (monsters, props). See decision 2.
  -- References auth.users directly, like characters.owner_id, so deleting an
  -- account removes their tokens with them.
  owner_user_id uuid references auth.users (id) on delete cascade,

  -- Optional links, for display and for later features. Neither grants
  -- permission; owner_user_id alone does.
  character_id uuid references public.characters (id) on delete set null,
  npc_id uuid references public.npcs (id) on delete set null,

  -- A token is a character OR an NPC OR neither (a plain marker) — never both.
  constraint playspace_tokens_one_subject
    check (character_id is null or npc_id is null),

  -- Shown on the token. Falls back to the linked character/NPC name in the UI.
  label text check (label is null or char_length(label) <= 60),

  -- Position in MAP PIXELS — see decision 1. Deliberately unbounded by the map's
  -- width/height: a CHECK against another table is not possible, and clamping
  -- server-side would silently move a token a DM dragged to the edge.
  x int not null default 0,
  y int not null default 0,

  -- Diameter in pixels. A "large" creature is simply a bigger number; the client
  -- may offer grid multiples as presets.
  size_px int not null default 70 check (size_px between 8 and 2000),

  -- Ring colour, for telling tokens apart at a glance. Hex, validated so the
  -- client can drop it straight into CSS without escaping.
  color text not null default '#c9a227' check (color ~ '^#[0-9A-Fa-f]{6}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.playspace_tokens is
  'A token on a battlemap (Phase 9.1). owner_user_id is the ONLY thing that '
  'grants a player permission to move it; NULL means DM-controlled. Position is '
  'in map pixels, not grid cells — see migration 0048 decision 1.';

create index playspace_tokens_map_idx on public.playspace_tokens (map_id);
create index playspace_tokens_owner_idx on public.playspace_tokens (owner_user_id);

create trigger playspace_tokens_set_updated_at
  before update on public.playspace_tokens
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- A map's campaign, for the token policies.
--
-- Tokens have no campaign_id — they hang off the map — so every token policy
-- would otherwise repeat a subquery. One STABLE SECURITY DEFINER helper keeps
-- the policies readable and gives the planner one thing to cache.
-- ----------------------------------------------------------------------------
create function private.playspace_map_campaign(p_map_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.campaign_id from public.playspace_maps m where m.id = p_map_id;
$$;

grant execute on function private.playspace_map_campaign(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — maps: members read, DM writes (and only while the campaign is active).
-- ----------------------------------------------------------------------------
alter table public.playspace_maps enable row level security;

create policy playspace_maps_select_members
  on public.playspace_maps for select to authenticated
  using (private.is_campaign_member(campaign_id));

create policy playspace_maps_insert_dm
  on public.playspace_maps for insert to authenticated
  with check (
    private.is_campaign_dm(campaign_id)
    and coalesce(private.campaign_is_active(campaign_id), false)
  );

create policy playspace_maps_update_dm
  on public.playspace_maps for update to authenticated
  using (
    private.is_campaign_dm(campaign_id)
    and coalesce(private.campaign_is_active(campaign_id), false)
  )
  with check (
    private.is_campaign_dm(campaign_id)
    and coalesce(private.campaign_is_active(campaign_id), false)
  );

create policy playspace_maps_delete_dm
  on public.playspace_maps for delete to authenticated
  using (
    private.is_campaign_dm(campaign_id)
    and coalesce(private.campaign_is_active(campaign_id), false)
  );

-- ----------------------------------------------------------------------------
-- RLS — tokens.
--
-- The rule that matters: **a player may write only their own token.** The DM may
-- write any token in their campaign.
--
-- UPDATE carries BOTH `using` and `with check`, and they are not redundant:
--   * `using`      — which existing rows you may touch. Without it a player could
--                    edit the DM's dragon.
--   * `with check` — what the row may look like afterwards. Without it a player
--                    could set owner_user_id to someone else and hand their token
--                    away, or (worse) to NULL and make it DM-controlled.
-- Omitting either leaves a hole that the other does not cover.
-- ----------------------------------------------------------------------------
alter table public.playspace_tokens enable row level security;

create policy playspace_tokens_select_members
  on public.playspace_tokens for select to authenticated
  using (private.is_campaign_member(private.playspace_map_campaign(map_id)));

create policy playspace_tokens_insert_dm
  on public.playspace_tokens for insert to authenticated
  with check (
    private.is_campaign_dm(private.playspace_map_campaign(map_id))
    and coalesce(private.campaign_is_active(private.playspace_map_campaign(map_id)), false)
  );

create policy playspace_tokens_update_dm
  on public.playspace_tokens for update to authenticated
  using (private.is_campaign_dm(private.playspace_map_campaign(map_id)))
  with check (
    private.is_campaign_dm(private.playspace_map_campaign(map_id))
    and coalesce(private.campaign_is_active(private.playspace_map_campaign(map_id)), false)
  );

create policy playspace_tokens_delete_dm
  on public.playspace_tokens for delete to authenticated
  using (private.is_campaign_dm(private.playspace_map_campaign(map_id)));

-- A player may create a token only for THEMSELVES, in a campaign they belong to.
create policy playspace_tokens_insert_own
  on public.playspace_tokens for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.is_campaign_member(private.playspace_map_campaign(map_id))
    and coalesce(private.campaign_is_active(private.playspace_map_campaign(map_id)), false)
  );

-- ...and may move only a token they already own, and must still own it after.
create policy playspace_tokens_update_own
  on public.playspace_tokens for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    and private.is_campaign_member(private.playspace_map_campaign(map_id))
  )
  with check (
    owner_user_id = (select auth.uid())
    and private.is_campaign_member(private.playspace_map_campaign(map_id))
    and coalesce(private.campaign_is_active(private.playspace_map_campaign(map_id)), false)
  );

create policy playspace_tokens_delete_own
  on public.playspace_tokens for delete to authenticated
  using (
    owner_user_id = (select auth.uid())
    and private.is_campaign_member(private.playspace_map_campaign(map_id))
  );

-- ----------------------------------------------------------------------------
-- Realtime. Token movement is the whole point of the feature being shared.
--
-- REPLICA IDENTITY FULL so DELETE events carry the old row — without it the
-- payload has no id and mergeById cannot tell which token to remove (see the
-- "ignores a DELETE with no id" case in mergeById.test.ts).
-- ----------------------------------------------------------------------------
alter table public.playspace_maps replica identity full;
alter table public.playspace_tokens replica identity full;

alter publication supabase_realtime add table public.playspace_maps;
alter publication supabase_realtime add table public.playspace_tokens;

-- ----------------------------------------------------------------------------
-- Grants. New tables start with NO privileges; hosted Supabase supplied these as
-- project defaults, which the self-hosted stack does not. Without them the app
-- 401s on the table regardless of how correct the policies are.
-- The migrate job's grant sweep re-applies these on every run; doing it here too
-- means the table works from the moment it exists.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.playspace_maps to authenticated;
grant select, insert, update, delete on public.playspace_tokens to authenticated;
