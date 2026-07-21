-- ============================================================================
-- 0021_quests.sql — Phase 3.3 backend: the quest / plot tracker.
--
--   * public.quests — the DM's quest board: title, a status (active/completed),
--     a player-facing-ish description, and private plot_notes. Grouped by status
--     in the UI. DM-private, like the rest of the DM workspace.
--
-- (The Phase 3.3 NPC roster shipped with 3.2's migration 0020 — `npcs` +
-- stat blocks — so this migration only adds quests.)
--
-- Access is STRICTLY DM-ONLY for every operation, gated on
-- private.is_campaign_dm(campaign_id). Players and non-members see nothing.
-- ============================================================================

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null default '',
  -- Board column. Constrained so the UI grouping is total (every row lands in a
  -- known group). Defaults to 'active'.
  status text not null default 'active' check (status in ('active', 'completed')),
  description text not null default '',
  -- Private DM plot notes (twists, secrets) — DM-only like the whole table.
  plot_notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quests is
  'DM-private quest/plot tracker (title/status/description/plot_notes). RLS: campaign DM only, every operation.';

create index quests_campaign_id_idx on public.quests (campaign_id, status, position);

create trigger quests_set_updated_at
  before update on public.quests
  for each row execute function public.set_updated_at();

alter table public.quests enable row level security;

create policy "quests_select_dm" on public.quests for select to authenticated
  using (private.is_campaign_dm(campaign_id));
create policy "quests_insert_dm" on public.quests for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));
create policy "quests_update_dm" on public.quests for update to authenticated
  using (private.is_campaign_dm(campaign_id)) with check (private.is_campaign_dm(campaign_id));
create policy "quests_delete_dm" on public.quests for delete to authenticated
  using (private.is_campaign_dm(campaign_id));
