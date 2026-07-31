-- ============================================================================
-- 0024_shared_items.sql — Phase 4.1 backend: the one intentional DM→player
-- channel. The DM deliberately pushes a note or an image into the campaign for
-- ALL players to see. Everything else in the DM workspace (dm_notes, sessions,
-- npcs, encounters, quests, initiative) stays DM-private; a row here is the only
-- way DM-authored content becomes visible to players.
--
--   * public.shared_items — one row per shared handout. `type` is 'note' (title
--     + markdown body) or 'image' (title/caption + a media_assets reference).
--     Images reuse the 1.6 media pipeline (media_assets); the asset must be an
--     approved image in the SAME campaign. The mere PRESENCE of a row = visible
--     to every campaign member.
--
-- RLS asymmetry (the whole point of the feature):
--   * SELECT  — any campaign MEMBER (is_campaign_member): DM + all players read
--               shared items, and only shared items.
--   * INSERT/UPDATE/DELETE — campaign DM ONLY (is_campaign_dm): only the DM
--               decides what gets shared and can un-share it.
-- Both predicate functions are SECURITY DEFINER (0003) so they test membership
-- without tripping RLS recursion.
-- ============================================================================

create table public.shared_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- What kind of handout this is. Constrained to the two supported shapes.
  type text not null check (type in ('note', 'image')),
  -- Title/caption shown to players (both types). Optional.
  title text not null default '',
  -- Note body (markdown, rendered XSS-safe on the client like lore). Unused for
  -- image items but kept as '' so the column is non-null for both types.
  body text not null default '',
  -- For image items: the shared image. References an approved media asset in the
  -- same campaign; ON DELETE CASCADE so removing the asset removes the share.
  -- Null for note items.
  asset_id uuid references public.media_assets (id) on delete cascade,
  -- Manual display order (newest-first default handled by shared_at in queries).
  position integer not null default 0,
  -- When the DM shared it (surfaced to players; distinct from created_at).
  shared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Shape invariant: an image share MUST carry an asset; a note share must not.
  constraint shared_items_type_shape check (
    (type = 'image' and asset_id is not null) or
    (type = 'note'  and asset_id is null)
  )
);

comment on table public.shared_items is
  'DM→player handouts (note|image). Presence of a row = visible to all campaign members. RLS: members read; DM writes.';

create index shared_items_campaign_idx on public.shared_items (campaign_id, shared_at desc);
create index shared_items_asset_idx on public.shared_items (asset_id);

create trigger shared_items_set_updated_at
  before update on public.shared_items
  for each row execute function public.set_updated_at();

alter table public.shared_items enable row level security;

-- SELECT: any member of the campaign (DM + players) can read shared items.
create policy "shared_items_select_member"
  on public.shared_items for select to authenticated
  using (private.is_campaign_member(campaign_id));

-- INSERT/UPDATE/DELETE: campaign DM only.
create policy "shared_items_insert_dm"
  on public.shared_items for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));

create policy "shared_items_update_dm"
  on public.shared_items for update to authenticated
  using (private.is_campaign_dm(campaign_id))
  with check (private.is_campaign_dm(campaign_id));

create policy "shared_items_delete_dm"
  on public.shared_items for delete to authenticated
  using (private.is_campaign_dm(campaign_id));
