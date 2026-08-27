-- ============================================================================
-- 0033_orphaned_subscriptions.sql — durable record of Stripe subscriptions that
-- have no campaign to attach to.
--
-- THE PROBLEM. stripe-webhook resolves a subscription's campaign from Stripe
-- metadata, then upserts campaign_subscriptions. When that campaign no longer
-- exists the upsert fails the foreign key (23503) — and until now the failure
-- was only `console.error`'d while the handler still returned 200, so Stripe
-- marked the event delivered and never retried. The result was a subscription
-- that keeps billing with no database record of it anywhere and no alert.
--
-- This is NOT only a restore problem. `deleteCampaign` (src/features/campaigns/
-- api.ts) is a plain DELETE with no Stripe cancellation, so **every campaign
-- deleted while subscribed already leaves a live Stripe subscription behind.**
-- Restoring a backup to before a campaign existed produces the same state.
-- Retrying cannot fix either case, which is why the webhook records here and
-- returns 200 rather than making Stripe retry for days.
--
-- Retrying IS right for transient failures, and those now throw so the handler
-- returns 500. The distinction is the point: permanent problems get recorded,
-- transient ones get retried.
--
-- NO FOREIGN KEY on campaign_id, deliberately — the entire reason a row lands
-- here is that the campaign does not exist. An FK would reject exactly the rows
-- worth keeping.
-- ============================================================================
create table if not exists public.orphaned_subscriptions (
  -- Stripe's subscription id is the natural key: one row per subscription,
  -- updated as further events arrive, rather than one row per event.
  stripe_subscription_id text primary key,
  stripe_customer_id     text,

  -- The campaign Stripe believes this belongs to. Usually a campaign that has
  -- been deleted; null when no campaign could be resolved at all.
  campaign_id            uuid,

  -- Stripe's own status, so a reconcile can tell "still billing" from
  -- "already cancelled and merely noisy".
  status                 text,

  -- Which branch recorded it: 'campaign_missing' (FK rejected the upsert) or
  -- 'unresolvable' (no campaign_id in metadata or by customer lookup).
  reason                 text not null,

  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  -- Rising count is the signal that Stripe is still sending events for it, i.e.
  -- the subscription is live rather than a one-off historical blip.
  seen_count             integer not null default 1
);

comment on table public.orphaned_subscriptions is
  'Stripe subscriptions with no campaign to attach to — usually a campaign '
  'deleted while subscribed (deleteCampaign does not cancel Stripe), or a '
  'restore to before the campaign existed. Each row is money still being taken '
  'with nothing in the app to show for it: reconcile against Stripe and cancel '
  'or refund. NO FK on campaign_id — the row exists BECAUSE the campaign does '
  'not.';

-- RLS on with no policies: denied to every client role, readable and writable
-- only by the service role (which bypasses RLS). Same pattern as
-- trial_redemptions and deleted_accounts. It contains billing identifiers, so
-- it must never be client-readable.
alter table public.orphaned_subscriptions enable row level security;

create index if not exists orphaned_subscriptions_last_seen_idx
  on public.orphaned_subscriptions (last_seen_at desc);
