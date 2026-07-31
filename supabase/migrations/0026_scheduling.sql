-- ============================================================================
-- 0026_scheduling.sql — shared session scheduling for the whole table.
--
--   * public.schedule_sessions — a proposed/confirmed play session: a title, a
--     proposed date/time, and notes. DM-managed.
--   * public.schedule_rsvps — one member's availability for a session
--     ('yes' | 'maybe' | 'no'), unique per (session, user).
--
-- Access:
--   schedule_sessions — SELECT any campaign member; write DM only.
--   schedule_rsvps     — SELECT any campaign member (everyone sees the tally);
--                        a member writes ONLY their OWN rsvp (user_id = auth.uid)
--                        and only for a session in a campaign they belong to.
-- is_campaign_member / is_campaign_dm are SECURITY DEFINER (0003).
-- ============================================================================

create table public.schedule_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null default '',
  -- Proposed session time. Nullable so a "TBD" placeholder can exist.
  proposed_at timestamptz,
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.schedule_sessions is
  'Proposed/confirmed play sessions (title/time/notes). RLS: members read; DM writes.';

create index schedule_sessions_campaign_idx on public.schedule_sessions (campaign_id, proposed_at);

create trigger schedule_sessions_set_updated_at
  before update on public.schedule_sessions
  for each row execute function public.set_updated_at();

alter table public.schedule_sessions enable row level security;

create policy "schedule_sessions_select_member"
  on public.schedule_sessions for select to authenticated
  using (private.is_campaign_member(campaign_id));
create policy "schedule_sessions_insert_dm"
  on public.schedule_sessions for insert to authenticated
  with check (private.is_campaign_dm(campaign_id));
create policy "schedule_sessions_update_dm"
  on public.schedule_sessions for update to authenticated
  using (private.is_campaign_dm(campaign_id))
  with check (private.is_campaign_dm(campaign_id));
create policy "schedule_sessions_delete_dm"
  on public.schedule_sessions for delete to authenticated
  using (private.is_campaign_dm(campaign_id));

-- ---------------------------------------------------------------------------

create table public.schedule_rsvps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.schedule_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'maybe' check (status in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One rsvp per member per session (upsert target).
  unique (session_id, user_id)
);

comment on table public.schedule_rsvps is
  'A member''s availability for a session. RLS: members read all; a member writes only their own.';

create index schedule_rsvps_session_idx on public.schedule_rsvps (session_id);

create trigger schedule_rsvps_set_updated_at
  before update on public.schedule_rsvps
  for each row execute function public.set_updated_at();

alter table public.schedule_rsvps enable row level security;

-- Helper: does `p_session_id` belong to a campaign the caller is a member of?
-- SECURITY DEFINER so the rsvp policies can check membership via the session
-- without a recursive RLS read of schedule_sessions.
create or replace function private.can_access_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.schedule_sessions s
    where s.id = p_session_id and private.is_campaign_member(s.campaign_id)
  );
$$;

comment on function private.can_access_session(uuid) is
  'True if the caller is a member of the campaign owning this scheduled session. SECURITY DEFINER.';

-- Members see every rsvp for sessions in their campaigns (to show the tally).
create policy "schedule_rsvps_select_member"
  on public.schedule_rsvps for select to authenticated
  using (private.can_access_session(session_id));
-- A member may create/update/delete ONLY their own rsvp.
create policy "schedule_rsvps_insert_own"
  on public.schedule_rsvps for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_access_session(session_id));
create policy "schedule_rsvps_update_own"
  on public.schedule_rsvps for update to authenticated
  using (user_id = (select auth.uid()) and private.can_access_session(session_id))
  with check (user_id = (select auth.uid()) and private.can_access_session(session_id));
create policy "schedule_rsvps_delete_own"
  on public.schedule_rsvps for delete to authenticated
  using (user_id = (select auth.uid()));
