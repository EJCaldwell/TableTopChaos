-- ---------------------------------------------------------------------------
-- 0023_initiative_hp_npc.sql — per-combatant HP tracking and the NPC link on
-- the DM initiative tracker (Phase 3.5).
--
-- Owns: three columns on public.initiative_entries —
--   hp / max_hp — the current and maximum hit points shown beside each
--     combatant in CombatPanel. Both nullable: a combatant may be tracked for
--     turn order alone, and "no HP entered" is a real state that must be
--     distinguishable from zero HP (which means unconscious/dead).
--   npc_id — optional link back to the NPC an entry was created from, which is
--     what lets the tracker expand an inline stat block for that combatant.
--     ON DELETE SET NULL, not CASCADE: deleting an NPC from the roster must not
--     silently remove a combatant from an initiative order that is mid-fight.
--     The entry survives, having simply lost its stat-block link.
--
-- RECONSTRUCTED 2026-08-18, and worth explaining. This migration was applied to
-- the hosted project on 2026-07-20 (ledger entry `0023_initiative_hp_npc`) but
-- the .sql file was never committed, so the repo skipped straight from 0022 to
-- 0024. Nothing surfaced the gap: the hosted database had the columns, so the
-- app worked, and no environment had ever been built from the migration files
-- alone. It was caught by the Phase 6.2 restore failing with
-- `column "hp" of relation "initiative_entries" does not exist`, and confirmed
-- by diffing all 231 hosted columns against the 228 the migrations produce.
--
-- The definitions below were recovered from the live schema (information_schema
-- plus pg_constraint / pg_indexes), so they match production exactly rather
-- than being a plausible reconstruction.
--
-- Written idempotently because the hosted project already has these objects:
-- this file must be a no-op there and must create them everywhere else.
--
-- No policy changes. RLS on initiative_entries is table-level and DM-only from
-- 0022; new columns inherit it, and the npcs FK target is DM-only too.
-- ---------------------------------------------------------------------------

alter table public.initiative_entries
  add column if not exists hp     integer,
  add column if not exists max_hp integer,
  add column if not exists npc_id uuid;

-- Added separately from the column so a re-run cannot duplicate the constraint;
-- `add constraint` has no `if not exists` form.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.initiative_entries'::regclass
      and conname  = 'initiative_entries_npc_id_fkey'
  ) then
    alter table public.initiative_entries
      add constraint initiative_entries_npc_id_fkey
      foreign key (npc_id) references public.npcs(id) on delete set null;
  end if;
end
$$;

-- Supports the stat-block expansion lookup, and keeps the ON DELETE SET NULL
-- above from degrading into a sequential scan when an NPC is removed.
create index if not exists initiative_entries_npc_id_idx
  on public.initiative_entries (npc_id);
