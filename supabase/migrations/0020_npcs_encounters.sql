-- ============================================================================
-- 0020_npcs_encounters.sql — Phase 3.2 (+ the shared NPC roster from 3.3).
--
-- The DM's encounter workspace, re-specified:
--   * public.npcs — a CAMPAIGN-WIDE roster of NPCs (name, optional portrait,
--     description). Each NPC carries a CONFIGURABLE stat block modelled exactly
--     like the player character sheet: add-your-own SECTIONS, each with ordered
--     label/value FIELDS (npc_stat_sections / npc_stat_fields).
--   * public.encounters — a prepared encounter: name, a general description, and
--     a SEPARATE DM-only "hidden nearby" notes field. Has multiple images
--     (encounter_images, shown in a full-screen presentation view) and links to
--     roster NPCs (encounter_npcs).
--   * public.encounter_images — ordered image attachments (asset -> media_assets).
--   * public.encounter_npcs — link table: which roster NPCs appear in an encounter.
--
-- Access is STRICTLY DM-ONLY for every operation on every table here — this is
-- the DM's private prep. Tables with a campaign_id gate on
-- private.is_campaign_dm(campaign_id); child tables resolve the campaign through
-- their parent via SECURITY DEFINER helpers (is_encounter_dm / is_npc_dm /
-- is_npc_section_dm), mirroring 0015's is_character_dm.
-- ============================================================================

-- ============================================================================
-- NPC ROSTER
-- ============================================================================
create table public.npcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null default '',
  description text not null default '',
  -- Optional portrait via the 1.6 media pipeline; null = no image.
  portrait_asset_id uuid references public.media_assets (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.npcs is
  'DM-private campaign NPC roster (name/description/optional portrait). RLS: campaign DM only, every operation.';

create index npcs_campaign_id_idx on public.npcs (campaign_id, position);

create trigger npcs_set_updated_at
  before update on public.npcs
  for each row execute function public.set_updated_at();

alter table public.npcs enable row level security;

create policy "npcs_select_dm" on public.npcs for select to authenticated
  using (private.is_campaign_dm(campaign_id));
create policy "npcs_insert_dm" on public.npcs for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));
create policy "npcs_update_dm" on public.npcs for update to authenticated
  using (private.is_campaign_dm(campaign_id)) with check (private.is_campaign_dm(campaign_id));
create policy "npcs_delete_dm" on public.npcs for delete to authenticated
  using (private.is_campaign_dm(campaign_id));

-- Predicate: is the caller the DM of this NPC's campaign?
create or replace function private.is_npc_dm(p_npc_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.npcs n
    where n.id = p_npc_id and private.is_campaign_dm(n.campaign_id)
  );
$$;
comment on function private.is_npc_dm(uuid) is
  'True if the current user is a DM of the NPC''s campaign. SECURITY DEFINER; used by npc_stat_sections RLS.';
grant execute on function private.is_npc_dm(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- NPC stat block: sections + fields (mirrors sheet_sections / sheet_fields).
-- ----------------------------------------------------------------------------
create table public.npc_stat_sections (
  id uuid primary key default gen_random_uuid(),
  npc_id uuid not null references public.npcs (id) on delete cascade,
  title text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.npc_stat_sections is
  'A configurable stat-block section on an NPC (e.g. "Abilities"). RLS: DM of the NPC''s campaign.';

create index npc_stat_sections_npc_id_idx on public.npc_stat_sections (npc_id, position);

create trigger npc_stat_sections_set_updated_at
  before update on public.npc_stat_sections
  for each row execute function public.set_updated_at();

alter table public.npc_stat_sections enable row level security;

create policy "npc_stat_sections_select_dm" on public.npc_stat_sections for select to authenticated
  using (private.is_npc_dm(npc_id));
create policy "npc_stat_sections_insert_dm" on public.npc_stat_sections for insert to authenticated
  with check (private.is_npc_dm(npc_id));
create policy "npc_stat_sections_update_dm" on public.npc_stat_sections for update to authenticated
  using (private.is_npc_dm(npc_id)) with check (private.is_npc_dm(npc_id));
create policy "npc_stat_sections_delete_dm" on public.npc_stat_sections for delete to authenticated
  using (private.is_npc_dm(npc_id));

-- Predicate: is the caller the DM of the campaign owning this stat section?
create or replace function private.is_npc_section_dm(p_section_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.npc_stat_sections s
    join public.npcs n on n.id = s.npc_id
    where s.id = p_section_id and private.is_campaign_dm(n.campaign_id)
  );
$$;
comment on function private.is_npc_section_dm(uuid) is
  'True if the current user is a DM of the campaign owning this NPC stat section. SECURITY DEFINER; used by npc_stat_fields RLS.';
grant execute on function private.is_npc_section_dm(uuid) to authenticated;

create table public.npc_stat_fields (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.npc_stat_sections (id) on delete cascade,
  label text not null default '',
  value text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.npc_stat_fields is
  'A label/value stat within an NPC stat section. RLS: DM of the section''s NPC''s campaign.';

create index npc_stat_fields_section_id_idx on public.npc_stat_fields (section_id, position);

create trigger npc_stat_fields_set_updated_at
  before update on public.npc_stat_fields
  for each row execute function public.set_updated_at();

alter table public.npc_stat_fields enable row level security;

create policy "npc_stat_fields_select_dm" on public.npc_stat_fields for select to authenticated
  using (private.is_npc_section_dm(section_id));
create policy "npc_stat_fields_insert_dm" on public.npc_stat_fields for insert to authenticated
  with check (private.is_npc_section_dm(section_id));
create policy "npc_stat_fields_update_dm" on public.npc_stat_fields for update to authenticated
  using (private.is_npc_section_dm(section_id)) with check (private.is_npc_section_dm(section_id));
create policy "npc_stat_fields_delete_dm" on public.npc_stat_fields for delete to authenticated
  using (private.is_npc_section_dm(section_id));

-- ============================================================================
-- ENCOUNTERS
-- ============================================================================
create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null default '',
  description text not null default '',
  -- DM-only "hidden things nearby" notes, kept separate from `description` so the
  -- UI can present them as a distinct secret section. (The whole table is
  -- DM-only, so this is a semantic split, not an extra access boundary.)
  hidden_notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.encounters is
  'DM-private prepared encounters (name/description/hidden_notes). RLS: campaign DM only, every operation.';

create index encounters_campaign_id_idx on public.encounters (campaign_id, position);

create trigger encounters_set_updated_at
  before update on public.encounters
  for each row execute function public.set_updated_at();

alter table public.encounters enable row level security;

create policy "encounters_select_dm" on public.encounters for select to authenticated
  using (private.is_campaign_dm(campaign_id));
create policy "encounters_insert_dm" on public.encounters for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));
create policy "encounters_update_dm" on public.encounters for update to authenticated
  using (private.is_campaign_dm(campaign_id)) with check (private.is_campaign_dm(campaign_id));
create policy "encounters_delete_dm" on public.encounters for delete to authenticated
  using (private.is_campaign_dm(campaign_id));

-- Predicate: is the caller the DM of this encounter's campaign?
create or replace function private.is_encounter_dm(p_encounter_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.encounters e
    where e.id = p_encounter_id and private.is_campaign_dm(e.campaign_id)
  );
$$;
comment on function private.is_encounter_dm(uuid) is
  'True if the current user is a DM of the encounter''s campaign. SECURITY DEFINER; used by encounter_images / encounter_npcs RLS.';
grant execute on function private.is_encounter_dm(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Encounter images (multiple; shown full-screen in the presentation view).
-- ----------------------------------------------------------------------------
create table public.encounter_images (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  caption text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.encounter_images is
  'Ordered image attachments for an encounter (asset_id -> media_assets). RLS: DM of the encounter''s campaign only.';

create index encounter_images_encounter_id_idx on public.encounter_images (encounter_id, position);

create trigger encounter_images_set_updated_at
  before update on public.encounter_images
  for each row execute function public.set_updated_at();

alter table public.encounter_images enable row level security;

create policy "encounter_images_select_dm" on public.encounter_images for select to authenticated
  using (private.is_encounter_dm(encounter_id));
create policy "encounter_images_insert_dm" on public.encounter_images for insert to authenticated
  with check (private.is_encounter_dm(encounter_id));
create policy "encounter_images_update_dm" on public.encounter_images for update to authenticated
  using (private.is_encounter_dm(encounter_id)) with check (private.is_encounter_dm(encounter_id));
create policy "encounter_images_delete_dm" on public.encounter_images for delete to authenticated
  using (private.is_encounter_dm(encounter_id));

-- ----------------------------------------------------------------------------
-- Encounter <-> NPC links (which roster NPCs appear in this encounter).
-- ----------------------------------------------------------------------------
create table public.encounter_npcs (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  npc_id uuid not null references public.npcs (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  -- A given NPC appears at most once per encounter.
  unique (encounter_id, npc_id)
);

comment on table public.encounter_npcs is
  'Link: roster NPCs attached to an encounter. RLS: DM of the encounter''s campaign only.';

create index encounter_npcs_encounter_id_idx on public.encounter_npcs (encounter_id, position);

alter table public.encounter_npcs enable row level security;

create policy "encounter_npcs_select_dm" on public.encounter_npcs for select to authenticated
  using (private.is_encounter_dm(encounter_id));
create policy "encounter_npcs_insert_dm" on public.encounter_npcs for insert to authenticated
  with check (private.is_encounter_dm(encounter_id));
create policy "encounter_npcs_update_dm" on public.encounter_npcs for update to authenticated
  using (private.is_encounter_dm(encounter_id)) with check (private.is_encounter_dm(encounter_id));
create policy "encounter_npcs_delete_dm" on public.encounter_npcs for delete to authenticated
  using (private.is_encounter_dm(encounter_id));
