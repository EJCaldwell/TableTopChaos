-- ============================================================================
-- 0014_character_lore.sql — Phase 2.3 backend: lore/backstory fields.
--
-- Adds the narrative "lore" fields to a character. Unlike the free-form sheet
-- (sections/fields, 2.1) these are a small fixed set of long-form prose areas a
-- player fills in for their character's story. Content is stored as plain text
-- (the UI renders a lightweight, HTML-escaped markdown subset — no raw HTML is
-- persisted, so a player's prose can't inject markup into the DM's view).
--
-- No new RLS: these are columns on `characters`, already governed by the
-- migration 0010 policies (owner read/write, campaign DM read-only, other
-- players none). Portraits also need no new backend here — a character already
-- carries `portrait_asset_id` (0010) and images flow through the 1.6 media
-- pipeline + its member-scoped Storage policy (0008).
-- ============================================================================

alter table public.characters
  -- The main origin/history narrative. '' when unset.
  add column backstory text not null default '',
  -- Physical description / how the character looks.
  add column appearance text not null default '',
  -- Personality traits, ideals, bonds, flaws — freeform prose.
  add column personality text not null default '';

comment on column public.characters.backstory is
  'Long-form character backstory (plain text; UI renders a safe markdown subset). Phase 2.3.';
comment on column public.characters.appearance is
  'Physical description of the character (plain text; safe markdown subset). Phase 2.3.';
comment on column public.characters.personality is
  'Personality traits/ideals/bonds/flaws (plain text; safe markdown subset). Phase 2.3.';
