-- ============================================================================
-- 0028_game_mode.sql — per-campaign game mode (Phase 5.1).
--
-- Adds public.game_mode, an enum of the three cumulative campaign tiers, and
-- campaigns.game_mode to select one. The tiers are cumulative:
--   notetaker → today's app exactly (notes/sheets/DM tools, tab bar chrome)
--   playspace → notetaker + a shared grid battlemap        (Phase 9)
--   rpg       → playspace + round-based combat             (Phase 10)
--
-- Access: switching mode is a plain UPDATE on campaigns, so it is already
-- governed by the existing campaigns_update_dm policy (0003/0004) — DM only; a
-- player's update matches zero rows and silently no-ops. No new policy needed.
--
-- INVARIANT — switch-down is NON-DESTRUCTIVE. A DM may move between modes
-- freely and at any time. Moving to a *simpler* mode must never delete
-- higher-mode data: playspace rows (maps/tokens/walls/lights — Phase 9) and
-- combat rows (Phase 10) are simply not read or rendered while the campaign sits
-- in a lower mode, and switching back up restores them intact. Deliberately no
-- trigger and no cascade is wired to this column; future phases must keep it
-- that way and gate on game_mode at read time only.
-- ============================================================================

create type public.game_mode as enum ('notetaker', 'playspace', 'rpg');

comment on type public.game_mode is
  'Campaign tier: notetaker (notes only) < playspace (+ battlemap) < rpg (+ round combat).';

-- Default 'notetaker' + not null means every pre-existing campaign keeps
-- behaving exactly as it does today with no backfill step.
alter table public.campaigns
  add column game_mode public.game_mode not null default 'notetaker';

comment on column public.campaigns.game_mode is
  'How this campaign plays. DM-switchable at any time (campaigns_update_dm). '
  'Switching DOWN never deletes higher-mode data — lower modes just stop '
  'reading playspace/combat rows, so switching back up restores them intact.';
