-- ============================================================================
-- 0022_initiative.sql — Phase 3.5 backend: the DM's private initiative tracker.
--
--   * public.initiative_entries — a DM-only scratch list of combatants for the
--     current fight: a name, an initiative value (nullable until rolled), free
--     notes, and a manual `position` (tiebreaker / drag order). Seeded however
--     the DM likes (party characters, roster NPCs, ad-hoc), then stepped through.
--
-- The dice roller (also 3.5) is entirely client-side — standard notation parsed
-- and rolled in the browser — so it has NO table here; the plan's optional
-- `dm_dice_log` is intentionally omitted for the MVP.
--
-- Access is STRICTLY DM-ONLY for every operation, gated on
-- private.is_campaign_dm(campaign_id). Players and non-members see nothing —
-- this is the DM's private combat scratchpad.
-- ============================================================================

create table public.initiative_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null default '',
  -- The rolled initiative value. Null until set; higher acts first. The UI sorts
  -- by this (desc, nulls last) then by `position` for ties / unset entries.
  initiative integer,
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.initiative_entries is
  'DM-private initiative tracker (name/initiative/notes). RLS: campaign DM only, every operation — invisible to players.';

create index initiative_entries_campaign_id_idx on public.initiative_entries (campaign_id, position);

create trigger initiative_entries_set_updated_at
  before update on public.initiative_entries
  for each row execute function public.set_updated_at();

alter table public.initiative_entries enable row level security;

create policy "initiative_entries_select_dm" on public.initiative_entries for select to authenticated
  using (private.is_campaign_dm(campaign_id));
create policy "initiative_entries_insert_dm" on public.initiative_entries for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));
create policy "initiative_entries_update_dm" on public.initiative_entries for update to authenticated
  using (private.is_campaign_dm(campaign_id)) with check (private.is_campaign_dm(campaign_id));
create policy "initiative_entries_delete_dm" on public.initiative_entries for delete to authenticated
  using (private.is_campaign_dm(campaign_id));
