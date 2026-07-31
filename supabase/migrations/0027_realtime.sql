-- ============================================================================
-- 0027_realtime.sql — Phase 4.4.1: enable Supabase Realtime for the most
-- multiplayer-facing tables so DM and player screens update live (no refresh).
--
-- Realtime broadcasts Postgres change events over a websocket; the client
-- subscribes with supabase.channel(...).on('postgres_changes', …). Crucially,
-- Realtime STILL ENFORCES RLS — a subscriber only receives change events for
-- rows it is allowed to SELECT — so this adds no new exposure surface beyond the
-- read policies already in place.
--
-- REPLICA IDENTITY FULL: by default an UPDATE/DELETE change record carries only
-- the primary key of the OLD row, which isn't enough for Realtime to evaluate
-- RLS on delete/update against non-PK columns (the event would be dropped).
-- FULL makes the whole old row available so those events authorize + deliver.
-- ============================================================================

alter table public.character_status replica identity full;
alter table public.shared_items replica identity full;
alter table public.schedule_sessions replica identity full;
alter table public.schedule_rsvps replica identity full;
alter table public.initiative_entries replica identity full;

-- Add them to the Realtime publication (created by Supabase as supabase_realtime).
alter publication supabase_realtime add table public.character_status;
alter publication supabase_realtime add table public.shared_items;
alter publication supabase_realtime add table public.schedule_sessions;
alter publication supabase_realtime add table public.schedule_rsvps;
alter publication supabase_realtime add table public.initiative_entries;
