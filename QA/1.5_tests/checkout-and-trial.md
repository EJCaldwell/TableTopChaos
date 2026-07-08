# QA — Checkout & trial start

**Phase:** 1.5. Runs with `enforce_active = false` (no switch flip needed). Verifies
the happy path: a DM starts a 30-day trial, a card is required, no charge occurs,
and the webhook syncs a correct `campaign_subscriptions` row.

**Prerequisites:** the shared prerequisites in [README.md](README.md) — both
secrets set and the webhook registered in the same sandbox as the price IDs. A
throwaway campaign owned by **Account A**. Stripe test card `4242 4242 4242 4242`.

> **UI note:** since the explicit trial/pay change, the eligible-campaign screen
> shows **two** buttons — **"Start 30-day free trial"** and **"Subscribe now
> (billed today)"** — instead of a single "Start free trial". This run used the
> trial button. See [[billing-trial-choice-feature]] / BillingPanel.tsx.

## Steps

- [x] As **Account A (owner/DM)**, open the campaign → **Plan & billing** tab. The
      status card reads **"No active plan."**
- [x] The interval selector shows three options — **monthly $9.99**, **semi-annual
      $49.99**, **annual $79.99** — with the longer terms showing a savings note,
      and **annual** pre-selected. *(Picked monthly for this run.)*
- [x] Click **Start free trial** → the browser redirects to Stripe's hosted
      Checkout (a real Stripe URL, card fields present). Confirm the copy conveys a
      trial ($0 today).
- [x] Enter card `4242 4242 4242 4242`, any future expiry (e.g. `12/34`), any CVC,
      and complete Checkout → you are redirected back to
      `…/campaigns/<id>?billing=success`.
- [x] The panel shows a brief **"Payment received — activating…"** notice, then
      within a few seconds the status card flips to **"Free trial — 30 days left"**
      with the trial end date and the card `•••• 4242` shown.
- [x] *(Stripe side)* In the webhook endpoint's deliveries list, the
      `checkout.session.completed` event shows a green **200**. *(Mirror synced, so 200.)*
- [x] *(No charge)* In Stripe → Payments, there is **no** completed charge for this
      customer (a $0/trial invoice may exist, but no money captured). ✔ (0 charges;
      one $0 trial invoice, amount_paid 0)
- [x] *(DB check)* Confirm the mirror row is correct:
      ```sql
      select status, interval, plan, trial_end, current_period_end,
             card_brand, card_last4, stripe_subscription_id
      from public.campaign_subscriptions
      where campaign_id = '<id>';
      ```
      Expect `status = 'trialing'`, `interval` = the plan you picked, `plan = 'pro'`,
      `trial_end` ≈ 30 days out, `card_last4 = '4242'`, and a non-null
      `stripe_subscription_id`. ✔ (all matched; interval=monthly)
- [x] *(Cancelled path)* Start Checkout again on a second throwaway campaign and
      click Stripe's back/cancel → you land on `…?billing=cancelled`, see the
      **"Checkout was cancelled"** notice, and **no** row/subscription is created
      for that campaign. ✔ (Test 3: `status`/`stripe_subscription_id` both NULL — a
      customer-only placeholder row exists by design (customer id pre-persisted at
      checkout-session creation, index.ts:86-93); the UI reads NULL status as "No
      active plan" and Stripe has no subscription for that customer.)

## Pass criteria

Starting a trial requires a card, produces a `trialing` subscription with a
~30-day `trial_end`, charges nothing, and the "Plan & billing" tab reflects the
trial (days left + card on file) after the webhook lands. Cancelling Checkout
leaves no subscription.

> Flow: `startCheckout` →
> [`create-checkout-session`](../../supabase/functions/create-checkout-session/index.ts)
> (owner-only, `trial_period_days: 30`, `payment_method_collection: 'always'`) →
> Stripe → [`stripe-webhook`](../../supabase/functions/stripe-webhook/index.ts)
> `syncSubscription` upserts `public.campaign_subscriptions`. UI:
> [`BillingPanel.tsx`](../../src/features/billing/BillingPanel.tsx) /
> [`billing/api.ts`](../../src/features/billing/api.ts).
