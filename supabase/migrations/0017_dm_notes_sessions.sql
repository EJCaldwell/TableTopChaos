-- ============================================================================
-- 0017_dm_notes_sessions.sql — Phase 3.1 backend: the DM's private organizer.
--
--   * public.dm_notes — the DM's free-form, taggable notes for a campaign. Plain
--     text (title + body) plus a `tags` array for organizing/filtering. The plan
--     mentions optional links to NPC/quest/encounter rows; those tables don't
--     exist yet (Phases 3.2/3.3), so linking is deferred — `tags` covers the
--     organize/filter need for now without a premature foreign key.
--   * public.sessions — the session log: one row per play session with a date,
--     a recap, and a free-form attendees list.
--
-- Both are STRICTLY DM-ONLY: unlike the character tables (where the DM has read
-- access to a player's data), these are the DM's private workspace and must be
-- invisible to players entirely. So every policy is gated on
-- private.is_campaign_dm(campaign_id) — a DM of the campaign for both read and
-- write; players (and non-members) match no policy and see nothing.
-- ============================================================================

-- ============================================================================
-- Table: dm_notes
-- Free-form DM notes. `tags` is a text[] for lightweight organization/filtering
-- (no separate tags table for the MVP). Manually ordered via `position`.
-- ============================================================================
create table public.dm_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  -- Lightweight tags for organizing/filtering notes. Empty array = untagged.
  tags text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dm_notes is
  'DM-private campaign notes (title/body/tags). RLS: campaign DM only, for every operation — invisible to players.';

create index dm_notes_campaign_id_idx on public.dm_notes (campaign_id, position);

create trigger dm_notes_set_updated_at
  before update on public.dm_notes
  for each row execute function public.set_updated_at();

alter table public.dm_notes enable row level security;

-- DM-only for ALL operations. `is_campaign_dm` is SECURITY DEFINER (0003) so it
-- reads membership without tripping RLS recursion.
create policy "dm_notes_select_dm"
  on public.dm_notes for select to authenticated
  using (private.is_campaign_dm(campaign_id));

create policy "dm_notes_insert_dm"
  on public.dm_notes for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));

create policy "dm_notes_update_dm"
  on public.dm_notes for update to authenticated
  using (private.is_campaign_dm(campaign_id))
  with check (private.is_campaign_dm(campaign_id));

create policy "dm_notes_delete_dm"
  on public.dm_notes for delete to authenticated
  using (private.is_campaign_dm(campaign_id));

-- ============================================================================
-- Table: sessions  (the session log / recaps)
-- One row per play session: an optional date, a recap, and a free-form list of
-- who attended. `attendees` is a text[] of names (not member FKs) so the DM can
-- record guests / absent-but-mentioned players without a rigid join.
-- ============================================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null default '',
  -- The in-world/real date this session was played. Null until the DM sets it.
  session_date date,
  recap text not null default '',
  -- Free-form attendee names. Empty array = none recorded yet.
  attendees text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sessions is
  'DM-private session log (date/recap/attendees). RLS: campaign DM only, for every operation — invisible to players.';

create index sessions_campaign_id_idx on public.sessions (campaign_id, position);

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;

create policy "sessions_select_dm"
  on public.sessions for select to authenticated
  using (private.is_campaign_dm(campaign_id));

create policy "sessions_insert_dm"
  on public.sessions for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));

create policy "sessions_update_dm"
  on public.sessions for update to authenticated
  using (private.is_campaign_dm(campaign_id))
  with check (private.is_campaign_dm(campaign_id));

create policy "sessions_delete_dm"
  on public.sessions for delete to authenticated
  using (private.is_campaign_dm(campaign_id));
