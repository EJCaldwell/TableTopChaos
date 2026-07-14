-- ============================================================================
-- 0015_journal.sql — Phase 2.4 backend: personal journal.
--
-- (An `abilities` table was originally added here too but removed — the abilities
-- feature is being redesigned and will land in a later migration.)
--
--   * public.journal_entries — the player's PRIVATE journal. Owner-only by
--     default; the DM canNOT see an entry unless the player marks it `shared`.
--     This is deliberately stricter than the rest of the character (where the DM
--     always has read), so it needs its own read policy + a new predicate that
--     answers "is the caller the DM of this character's campaign?".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Predicate: private.is_character_dm(character_id)
-- SECURITY DEFINER (bypasses RLS, mirrors 0010's helpers): true iff the current
-- user is a DM of the campaign the character belongs to. Used by the journal read
-- policy so a DM can see ONLY entries a player has shared — not the whole journal.
-- ----------------------------------------------------------------------------
create or replace function private.is_character_dm(p_character_id uuid)
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
      and private.is_campaign_dm(c.campaign_id)
  );
$$;

comment on function private.is_character_dm(uuid) is
  'True if the current user is a DM of the character''s campaign. SECURITY DEFINER; used by journal_entries share-scoped read.';

grant execute on function private.is_character_dm(uuid) to authenticated;

-- ============================================================================
-- Table: journal_entries
-- The player's personal in-character journal. `shared` (default false) is the
-- ONLY thing that ever exposes an entry to the DM — otherwise it is strictly
-- owner-only, including invisible to the DM.
-- ============================================================================
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  -- When true, the campaign DM may READ this single entry. Default private.
  shared boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.journal_entries is
  'Owner-only personal journal. DM can read an entry ONLY when shared = true. Other players never.';

create index journal_entries_character_id_idx on public.journal_entries (character_id, position);

create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

alter table public.journal_entries enable row level security;

-- Read: the owner always; the campaign DM only for entries flagged `shared`.
-- (can_write_character is owner-only, so it's the right "is owner" test here.)
create policy "journal_entries_select_owner_or_shared_dm"
  on public.journal_entries for select to authenticated
  using (
    private.can_write_character(character_id)
    or (shared and private.is_character_dm(character_id))
  );

comment on policy "journal_entries_select_owner_or_shared_dm" on public.journal_entries is
  'Owner reads all their entries; the DM reads only entries the player has shared; other players none.';

-- Write: owner only (including toggling `shared`). The DM can never write.
create policy "journal_entries_insert_owner"
  on public.journal_entries for insert to authenticated
  with check (private.can_write_character(character_id));

create policy "journal_entries_update_owner"
  on public.journal_entries for update to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

create policy "journal_entries_delete_owner"
  on public.journal_entries for delete to authenticated
  using (private.can_write_character(character_id));
