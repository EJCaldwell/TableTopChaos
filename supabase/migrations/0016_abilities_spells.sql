-- ============================================================================
-- 0016_abilities_spells.sql — Phase 2.4 (redesign): abilities/feats + spells as
-- two separate per-character tables, each with its own tab.
--
--   * public.abilities — class/racial features and feats. name + description +
--     optional `uses` (e.g. "1/rest"). Manually ordered (`position`).
--   * public.spells — spells, each with a `level` (0 = cantrip … 9), a `prepared`
--     flag, and a description. Displayed grouped by level.
--
-- Both use the SAME access model as the rest of the character sheet, reusing the
-- 0010 predicates: owner read/write, campaign DM read-only, other players none.
-- (This supersedes the earlier combined "spells & abilities" table, which was
-- removed.)
-- ============================================================================

-- ============================================================================
-- Table: abilities  (features & feats)
-- ============================================================================
create table public.abilities (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null check (char_length(name) <= 200),
  description text not null default '',
  -- Optional uses (per rest/day). Null = untracked/at-will; if set, >= 0.
  uses integer check (uses is null or uses >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.abilities is
  'Character features & feats (name/description/optional uses). RLS reuses 0010 predicates: owner read/write, DM read-only, others none.';

create index abilities_character_id_idx on public.abilities (character_id, position);

create trigger abilities_set_updated_at
  before update on public.abilities
  for each row execute function public.set_updated_at();

alter table public.abilities enable row level security;

create policy "abilities_select_readable"
  on public.abilities for select to authenticated
  using (private.can_read_character(character_id));

create policy "abilities_insert_owner"
  on public.abilities for insert to authenticated
  with check (private.can_write_character(character_id));

create policy "abilities_update_owner"
  on public.abilities for update to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

create policy "abilities_delete_owner"
  on public.abilities for delete to authenticated
  using (private.can_write_character(character_id));

-- ============================================================================
-- Table: spells
-- `level` 0..9 (0 = cantrip). `prepared` marks a spell as currently prepared.
-- Ordered for display primarily by level, then by the manual `position`.
-- ============================================================================
create table public.spells (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null check (char_length(name) <= 200),
  level integer not null default 0 check (level between 0 and 9),
  prepared boolean not null default false,
  description text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.spells is
  'Character spells (level 0-9, prepared flag, description). RLS reuses 0010 predicates: owner read/write, DM read-only, others none.';

create index spells_character_id_idx on public.spells (character_id, level, position);

create trigger spells_set_updated_at
  before update on public.spells
  for each row execute function public.set_updated_at();

alter table public.spells enable row level security;

create policy "spells_select_readable"
  on public.spells for select to authenticated
  using (private.can_read_character(character_id));

create policy "spells_insert_owner"
  on public.spells for insert to authenticated
  with check (private.can_write_character(character_id));

create policy "spells_update_owner"
  on public.spells for update to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

create policy "spells_delete_owner"
  on public.spells for delete to authenticated
  using (private.can_write_character(character_id));
