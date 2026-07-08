-- ============================================================================
-- 0006_billing_trial_choice.sql — explicit trial-vs-pay + reused-card handling.
--
-- Context: Phase 1.5 billing originally inferred "trial vs. immediate billing"
-- from whether a campaign had ever had a subscription, and the anti-abuse rule
-- (one free trial per card) BILLED a reused-card trial immediately. Both were
-- surprising to DMs. The UI now lets a DM explicitly choose "start free trial"
-- vs "subscribe now", and a trial attempted on a card that already trialed
-- elsewhere is CANCELLED (no charge) instead of billed.
--
-- This migration adds the one piece of state the UI needs to explain that
-- cancellation, since a reused-card cancel otherwise looks identical to any
-- other canceled subscription.
-- ============================================================================

-- trial_blocked_reused_card — set TRUE by the stripe-webhook when it cancels a
-- just-started trial because the card's fingerprint already redeemed a trial on
-- another campaign. The billing UI reads this to show "this card already used
-- its free trial — subscribe without one" (and to hide the trial option),
-- instead of the generic "subscription lapsed" copy.
--
-- It is STICKY: the webhook only ever sets it TRUE (never resets it), so a later
-- subscription.deleted/updated event re-syncing the row does not clobber it. It
-- becomes irrelevant once the DM subscribes (status active), and is harmless if
-- left true. Defaults FALSE so every existing row is unaffected.
alter table public.campaign_subscriptions
  add column trial_blocked_reused_card boolean not null default false;

comment on column public.campaign_subscriptions.trial_blocked_reused_card is
  'TRUE when a trial was auto-cancelled (no charge) because the card already '
  'redeemed a trial elsewhere (anti-abuse). Set only by the stripe-webhook; '
  'drives the billing UI''s "card already trialed" message. Sticky.';
