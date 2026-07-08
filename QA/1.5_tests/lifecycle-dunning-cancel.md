# QA — Lifecycle: convert / dunning / cancel

**Phase:** 1.5. **Requires `enforce_active = true`** + a Stripe **test clock**.
Verifies the subscription lifecycle end-to-end: trial→active conversion, the
failed-payment grace (dunning) window, and cancellation → read-only → resubscribe.

**Prerequisites:** shared prerequisites in [README.md](README.md), plus
`enforce_active = true` (restore to false after).

### Setting up a test clock

The in-app **Start free trial** button creates a normal (non-clock) subscription,
which you can't fast-forward. To exercise time-based transitions, drive Stripe on
a test clock. Two workable approaches:

1. **Stripe Dashboard:** Workbench / test tools → **Test clocks** → create a clock
   → create a **Customer on that clock** → attach a subscription to one of your
   test price IDs with a 30-day trial. Then **advance** the clock. The webhook
   fires against your sandbox endpoint just like production.
2. **Stripe CLI / API:** `stripe test_clocks create`, create a customer with
   `test_clock=<id>`, `stripe subscriptions create` with the price + trial, then
   `stripe test_clocks advance`.

In either case set the subscription's `metadata.campaign_id` to a real campaign
you own so the webhook maps it to `campaign_subscriptions` (the function reads
`metadata.campaign_id`, falling back to the stored `stripe_customer_id`).

## Run log — 2026-07-07 (PASS, driven via Stripe CLI test clocks)

Driven through the raw Stripe API on test clocks (three dedicated A-owned
campaigns: LC Convert / LC Dunning / LC Cancel), verifying `campaign_subscriptions`
+ `campaign_is_active` / `campaign_player_cap` after each transition. **Fresh card
fingerprints (amex, etc.)** were required because 4242/5555 are already in
`trial_redemptions` — an incidental re-confirmation that the reused-card cancel
fires even for clock subs. All three flows passed; details inline below.

## Steps — trial → active conversion

- [x] Create a trialing subscription on a test clock with a **working** card
      (`4242…`), mapped to your campaign. Confirm `status = 'trialing'`,
      `campaign_is_active() = true`.
- [x] Advance the clock **past `trial_end`**. Stripe converts the trial and charges
      the card; the webhook syncs the update.
- [x] Confirm conversion:
      ```sql
      select status, current_period_end from public.campaign_subscriptions where campaign_id = '<id>';
      -- status = 'active'; current_period_end ~ one interval out
      ```
      A real charge/invoice now exists in Stripe — and **no** charge existed before
      `trial_end`. ✔ ($9.99 charge appeared only at conversion; period end ~1 month out.)
- [x] Caps lift to paid values (cross-check with [player-cap.md](player-cap.md)):
      `select private.campaign_player_cap('<id>');` returns the paid cap. ✔ (→ NULL/unlimited)

## Steps — failed payment (dunning grace)

- [x] On a test-clock subscription, set the card to a **failing** one (used
      `pm_card_chargeCustomerFail`) and advance to a renewal (trial→convert charge).
- [x] The subscription enters **`past_due`**, and the campaign **stays usable**
      during the retry window:
      ```sql
      select status from public.campaign_subscriptions where campaign_id = '<id>'; -- past_due
      select private.campaign_is_active('<id>');                                    -- still TRUE
      ```
      The "Plan & billing" status card shows the **"Payment issue"** warning but
      does not read-only the campaign. ✔ (status past_due, is_active true)
- [x] **Recovery:** swap to a working card and let a retry succeed (or advance the
      clock) → status returns to `active`, `campaign_is_active()` stays true. ✔
      (attached a fresh Visa PM, paid the open invoice → back to active)
- [ ] **Exhaustion:** on a separate run, advance through all retries without fixing
      the card → status becomes `canceled`/`unpaid` and `campaign_is_active()` flips
      to **false** (hand off to [read-only-lock.md](read-only-lock.md)).
      *(Not run — same `is_active=false` read-only outcome is already proven by the
      cancel flow below and the Test 5 lapse in read-only-lock.md.)*

## Steps — cancel via portal

- [~] As **Account A (owner)**, open **Plan & billing** → **Manage billing** → the
      Stripe billing **portal** opens (return URL brings you back to the campaign).
      *(Portal owner-gating verified in access-control.md; cancellation here was
      driven via the API rather than clicking through the hosted portal.)*
- [x] Cancel the subscription (cancel at period end). Confirm the status card
      reflects **"Set to cancel at period end"** and:
      ```sql
      select cancel_at_period_end, current_period_end from public.campaign_subscriptions where campaign_id = '<id>';
      -- cancel_at_period_end = true
      ```
      ✔ (cancel_at_period_end = true, status still active)
- [x] The campaign **stays active until period end** (`campaign_is_active() = true`). ✔
- [x] Advance the clock **past `current_period_end`** → subscription ends, status
      lapses, `campaign_is_active()` → **false** (campaign is now read-only). ✔ (canceled)
- [x] **Resubscribe** (immediate billing) → `campaign_is_active()` → true again and
      the campaign unlocks. ✔ (new active sub → is_active true)
- [x] **Restore:** `update private.billing_config set enforce_active = false;`
      (Done at the end of the switch-ON areas, after read-only-lock's join test.)

## Pass criteria

Trials convert to `active` at `trial_end` (charging only then); a failed payment
holds the campaign usable through the dunning window and recovers on a good card,
or lapses to read-only if retries are exhausted; a portal cancellation keeps the
campaign live until period end and then goes read-only gracefully, with
resubscribe restoring full access. Every transition is driven by the Stripe
webhook, not the client.

> All transitions flow through
> [`stripe-webhook`](../../supabase/functions/stripe-webhook/index.ts)
> (`customer.subscription.updated` / `.deleted` → `syncSubscription`). The portal
> is opened by
> [`create-billing-portal-session`](../../supabase/functions/create-billing-portal-session/index.ts).
> `current_period_end` is read from the subscription **item** (2025 Stripe API).
