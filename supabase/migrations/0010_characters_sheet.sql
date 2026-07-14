-- ============================================================================
-- 0010_characters_sheet.sql — Phase 2.1 player workspace: character record and
-- the flexible, player-defined character sheet.
--
-- Owns the persistence side of a player's character workspace. A character
-- belongs to exactly one campaign and one owning player. The "sheet" is a
-- free-form notepad structure — there is deliberately NO fixed set of fields:
--   * public.characters      — one row per character (owner, campaign, name,
--                              optional portrait pointing at a media_assets row).
--   * public.sheet_sections  — player-defined sections on a character (a title
--                              and a display order).
--   * public.sheet_fields    — label/value text pairs inside a section (a display
--                              order). Values are plain text; no schema is imposed.
--
-- ACCESS MODEL (per 2.1 plan): the owning player has full read/write over their
-- character and its sheet. The campaign DM has READ-ONLY access (campaign-scoped)
-- so they can view a player's sheet. Other players in the campaign have NO access.
--
-- KEY DESIGN NOTE — non-recursive, cheaply-reusable RLS predicates:
--   sheet_sections and sheet_fields need to answer "may the caller read/write the
--   character this row ultimately belongs to?" — a lookup into public.characters
--   (and, for fields, through sheet_sections first). Doing that as an EXISTS join
--   under RLS is possible but noisy and re-evaluates per row. Instead we add four
--   SECURITY DEFINER predicates in the `private` schema (never exposed by
--   PostgREST, mirroring 0003's is_campaign_member/is_campaign_dm) that bypass RLS
--   and answer only about the CURRENT user. can_write_* is owner-only;
--   can_read_* is owner-or-campaign-DM.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: characters
-- One row per character. owner_id is the player who owns/edits it; campaign_id
-- scopes it to a single campaign (and is what the DM read-check keys off).
-- portrait_asset_id is an OPTIONAL pointer into media_assets (0008); on delete of
-- the asset it is nulled so the character survives losing its portrait.
-- ----------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- Optional portrait. Nulled (not cascaded) if the media asset is removed so the
  -- character record and its sheet are never destroyed by a portrait takedown.
  portrait_asset_id uuid references public.media_assets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.characters is
  'A player''s character in a campaign. RLS: owner read/write; campaign DM read-only; other players no access.';

-- Owner-scoped listing ("my characters") and the ownership predicates filter by
-- owner_id; the DM read-check and campaign cleanup filter by campaign_id.
create index characters_owner_id_idx on public.characters (owner_id);
create index characters_campaign_id_idx on public.characters (campaign_id);

create trigger characters_set_updated_at
  before update on public.characters
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table: sheet_sections
-- A player-defined section on a character (e.g. "Abilities", "Combat"). `position`
-- is a client-managed display order (lowest first); ties broken by created_at.
-- Deleting the character cascades its sections away.
-- ----------------------------------------------------------------------------
create table public.sheet_sections (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  -- Display order within the character. `order` is a reserved word, so the column
  -- is named `position`. Client owns the values; not required to be contiguous.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sheet_sections is
  'A player-defined section on a character''s sheet. RLS inherited from the character (owner write, DM read).';

-- Sections are always fetched/ordered per character.
create index sheet_sections_character_id_idx on public.sheet_sections (character_id, position);

create trigger sheet_sections_set_updated_at
  before update on public.sheet_sections
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table: sheet_fields
-- A label/value text pair inside a section. Both are free text; value may be empty
-- (a label with no value yet) but not null. `position` orders fields within their
-- section. Deleting the section cascades its fields away.
-- ----------------------------------------------------------------------------
create table public.sheet_fields (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sheet_sections (id) on delete cascade,
  -- Field label (e.g. "Strength"). Kept bounded for sane UI; 1..120 chars.
  label text not null check (char_length(label) between 1 and 120),
  -- Field value. Plain text, no schema imposed; defaults to '' so a freshly-added
  -- field is valid before the player types anything.
  value text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sheet_fields is
  'A label/value text pair within a sheet_section. RLS inherited via the section''s character.';

-- Fields are always fetched/ordered per section.
create index sheet_fields_section_id_idx on public.sheet_fields (section_id, position);

create trigger sheet_fields_set_updated_at
  before update on public.sheet_fields
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- Access predicates (SECURITY DEFINER, private schema).
--
-- Mirror the pattern from 0003: bypass RLS (so they can read public.characters
-- without tripping its own policies) and answer only about the CURRENT user, so
-- they leak nothing. STABLE so the planner can cache within a statement;
-- search_path pinned to '' → everything fully qualified.
--   can_write_character : owner only (full read/write authority).
--   can_read_character  : owner OR campaign DM (read authority).
--   can_write_section / can_read_section : same, resolved one hop through the
--     owning character so sheet_fields policies stay one predicate call.
-- ============================================================================

-- True if the current user OWNS the character (write authority over it + its sheet).
create or replace function private.can_write_character(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.characters c
    where c.id = p_character_id
      and c.owner_id = (select auth.uid())
  );
$$;

comment on function private.can_write_character(uuid) is
  'True if the current user owns the character. SECURITY DEFINER to avoid RLS recursion; backs owner-only write policies.';

-- True if the current user owns the character OR is a DM of its campaign (read).
create or replace function private.can_read_character(p_character_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.characters c
    where c.id = p_character_id
      and (
        c.owner_id = (select auth.uid())
        or private.is_campaign_dm(c.campaign_id)
      )
  );
$$;

comment on function private.can_read_character(uuid) is
  'True if the current user owns the character or is a DM of its campaign (read-only). SECURITY DEFINER.';

-- Section-scoped wrappers: resolve the section's character, then delegate. Keep
-- sheet_fields policies to a single predicate call regardless of the two-hop path.
create or replace function private.can_write_section(p_section_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.sheet_sections s
    where s.id = p_section_id
      and private.can_write_character(s.character_id)
  );
$$;

comment on function private.can_write_section(uuid) is
  'True if the current user owns the character owning this section. SECURITY DEFINER; backs sheet_fields write policies.';

create or replace function private.can_read_section(p_section_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.sheet_sections s
    where s.id = p_section_id
      and private.can_read_character(s.character_id)
  );
$$;

comment on function private.can_read_section(uuid) is
  'True if the current user may read the character owning this section (owner or campaign DM). SECURITY DEFINER.';

-- Authenticated users must be able to CALL these during policy evaluation. As with
-- 0003, `private` is not a PostgREST-exposed schema, so these are not REST RPCs.
grant execute on function private.can_write_character(uuid) to authenticated;
grant execute on function private.can_read_character(uuid) to authenticated;
grant execute on function private.can_write_section(uuid) to authenticated;
grant execute on function private.can_read_section(uuid) to authenticated;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

-- ---- characters -----------------------------------------------------------
alter table public.characters enable row level security;

-- Read: the owner, or a DM of the character's campaign (read-only view). Other
-- players in the campaign are intentionally excluded.
create policy "characters_select_owner_or_dm"
  on public.characters
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or private.is_campaign_dm(campaign_id)
  );

comment on policy "characters_select_owner_or_dm" on public.characters is
  'A character is readable by its owner and by a DM of its campaign; other players cannot see it.';

-- Create: a player may create a character they own, but only within a campaign
-- they actually belong to (prevents planting characters in others' campaigns).
create policy "characters_insert_own"
  on public.characters
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.is_campaign_member(campaign_id)
  );

comment on policy "characters_insert_own" on public.characters is
  'A player may create a character they own, only within a campaign they are a member of.';

-- Update: owner only. WITH CHECK repeats the owner test so ownership/campaign
-- cannot be reassigned away from the caller.
create policy "characters_update_owner"
  on public.characters
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

comment on policy "characters_update_owner" on public.characters is
  'Only the owning player may edit their character; the DM''s access is read-only.';

-- Delete: owner only.
create policy "characters_delete_owner"
  on public.characters
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

comment on policy "characters_delete_owner" on public.characters is
  'Only the owning player may delete their character.';

-- ---- sheet_sections -------------------------------------------------------
alter table public.sheet_sections enable row level security;

-- Read: anyone who may read the parent character (owner or campaign DM).
create policy "sheet_sections_select_readable"
  on public.sheet_sections
  for select
  to authenticated
  using (private.can_read_character(character_id));

comment on policy "sheet_sections_select_readable" on public.sheet_sections is
  'A section is readable by anyone who can read its character (owner or campaign DM).';

-- Insert: only the character's owner, and the section must attach to a character
-- they own (the predicate checks exactly that).
create policy "sheet_sections_insert_owner"
  on public.sheet_sections
  for insert
  to authenticated
  with check (private.can_write_character(character_id));

comment on policy "sheet_sections_insert_owner" on public.sheet_sections is
  'Only the character''s owner may add sections to it.';

-- Update: owner only. WITH CHECK prevents re-parenting a section onto a character
-- the caller does not own.
create policy "sheet_sections_update_owner"
  on public.sheet_sections
  for update
  to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

comment on policy "sheet_sections_update_owner" on public.sheet_sections is
  'Only the character''s owner may edit/reorder its sections.';

-- Delete: owner only.
create policy "sheet_sections_delete_owner"
  on public.sheet_sections
  for delete
  to authenticated
  using (private.can_write_character(character_id));

comment on policy "sheet_sections_delete_owner" on public.sheet_sections is
  'Only the character''s owner may delete its sections.';

-- ---- sheet_fields ---------------------------------------------------------
alter table public.sheet_fields enable row level security;

-- Read: anyone who may read the section's character (owner or campaign DM).
create policy "sheet_fields_select_readable"
  on public.sheet_fields
  for select
  to authenticated
  using (private.can_read_section(section_id));

comment on policy "sheet_fields_select_readable" on public.sheet_fields is
  'A field is readable by anyone who can read the character owning its section.';

-- Insert: only the owner of the section's character.
create policy "sheet_fields_insert_owner"
  on public.sheet_fields
  for insert
  to authenticated
  with check (private.can_write_section(section_id));

comment on policy "sheet_fields_insert_owner" on public.sheet_fields is
  'Only the owner of the section''s character may add fields.';

-- Update: owner only. WITH CHECK prevents moving a field into a section the caller
-- does not ultimately own.
create policy "sheet_fields_update_owner"
  on public.sheet_fields
  for update
  to authenticated
  using (private.can_write_section(section_id))
  with check (private.can_write_section(section_id));

comment on policy "sheet_fields_update_owner" on public.sheet_fields is
  'Only the owner of the section''s character may edit/reorder fields.';

-- Delete: owner only.
create policy "sheet_fields_delete_owner"
  on public.sheet_fields
  for delete
  to authenticated
  using (private.can_write_section(section_id));

comment on policy "sheet_fields_delete_owner" on public.sheet_fields is
  'Only the owner of the section''s character may delete fields.';
