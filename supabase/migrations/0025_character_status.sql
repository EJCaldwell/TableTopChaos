-- ============================================================================
-- 0025_character_status.sql — the player's live "HP & conditions" tracker.
--
--   * public.character_status — ONE row per character (character_id is the PK):
--     current/max/temp HP, death-save tallies, and a text[] of active
--     conditions. This is the in-the-moment combat state a player tweaks during
--     a fight, kept separate from the (more static) character sheet.
--
-- Access mirrors the other character-owned tables (inventory/abilities/…):
--   SELECT — private.can_read_character (owner OR campaign DM, read-only).
--   INSERT/UPDATE/DELETE — private.can_write_character (character OWNER only).
-- Both predicates are SECURITY DEFINER (0010) so they resolve ownership without
-- tripping RLS recursion. The DM sees a player's HP (via the Party view) but
-- cannot edit it.
-- ============================================================================

create table public.character_status (
  -- One-to-one with the character; deleting the character removes its status.
  character_id uuid primary key references public.characters (id) on delete cascade,
  current_hp integer,
  max_hp integer,
  -- Temporary hit points (a separate pool that absorbs damage first). Defaults 0.
  temp_hp integer not null default 0,
  -- Death-saving-throw tallies, each clamped 0..3 by the app (and here).
  death_save_successes integer not null default 0 check (death_save_successes between 0 and 3),
  death_save_failures integer not null default 0 check (death_save_failures between 0 and 3),
  -- Active conditions (e.g. 'Poisoned', 'Prone'); free-form text so custom
  -- conditions work alongside the standard set.
  conditions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.character_status is
  'Per-character live HP/temp-HP/death-saves/conditions. RLS: owner OR DM read; owner-only write.';

create trigger character_status_set_updated_at
  before update on public.character_status
  for each row execute function public.set_updated_at();

alter table public.character_status enable row level security;

create policy "character_status_select_readable"
  on public.character_status for select to authenticated
  using (private.can_read_character(character_id));

create policy "character_status_insert_owner"
  on public.character_status for insert to authenticated
  with check (private.can_write_character(character_id));

create policy "character_status_update_owner"
  on public.character_status for update to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

create policy "character_status_delete_owner"
  on public.character_status for delete to authenticated
  using (private.can_write_character(character_id));
