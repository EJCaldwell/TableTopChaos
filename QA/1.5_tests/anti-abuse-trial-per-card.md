# QA — Anti-abuse: one trial per card

**Phase:** 1.5. Runs with `enforce_active = false` (the fingerprint check lives in
the webhook and is independent of the kill-switch). Verifies that the same card
can't farm a second free trial, while a genuinely different card still can.

**Prerequisites:** the shared prerequisites in [README.md](README.md). **Two
distinct** Stripe test cards — e.g. `4242 4242 4242 4242` (card 1) and
`5555 5555 5555 4444` (card 2). Two throwaway campaigns; they may both be owned by
**Account A**, or one each by **A** and **B** (the rule is per-*card*, across
accounts, not per-account).

## Steps

- [x] **First trial (records the fingerprint).** On **Campaign 1**, start a trial
      with **card 1** and complete Checkout (as in
      [checkout-and-trial.md](checkout-and-trial.md)). Confirm `status = 'trialing'`.
- [x] Confirm the fingerprint was recorded:
      ```sql
      select card_fingerprint, campaign_id, first_used_at from public.trial_redemptions;
      ```
      Exactly one row, tied to Campaign 1, with a non-null `card_fingerprint`.
- [x] **Reused card → trial revoked.** On **Campaign 2**, start a trial with the
      **same card 1** and complete Checkout. Watch the webhook: because the
      fingerprint already exists for a *different* campaign, the trial is ended
      immediately (`trial_end: 'now'`), which bills the card now.
- [x] Confirm Campaign 2 did **not** get a free trial:
      ```sql
      select campaign_id, status, trial_end from public.campaign_subscriptions
      where campaign_id = '<campaign-2-id>';
      ```
      Status resolves to `active` / `past_due` (not a fresh 30-day `trialing`), and
      there is a real charge/invoice for card 1 in Stripe.
- [x] `trial_redemptions` still has **one** row (no new redemption recorded for the
      reused card).
- [x] **New card → trial allowed.** On a **Campaign 3**, start a trial with **card
      2** → it becomes `trialing` with a full ~30-day `trial_end`, and a **second**
      row appears in `trial_redemptions` for card 2's fingerprint.

## Run log — 2026-07-07 (PASS, after two fixes)

This run initially **failed**: the fingerprint was never captured, so no redemption
was ever recorded and the rule was silently a no-op. Two root causes, both fixed:

1. **Checkout offered Stripe Link.** With no `payment_method_types` set, Checkout
   used automatic methods incl. Link, whose saved PM is type `link` with **no
   `card` hash** → no fingerprint. Fixed by pinning
   [`create-checkout-session`](../../supabase/functions/create-checkout-session/index.ts)
   to `payment_method_types: ['card']` (card-only, matching the "one trial per
   *card*" premise).
2. **`readCard` read the card off the expanded subscription object.** A subscription
   retrieved with `expand: ['default_payment_method']` returns the PaymentMethod
   **without** its `card` sub-hash, so `pm.card` was null. Fixed in
   [`stripe-webhook`](../../supabase/functions/stripe-webhook/index.ts) `readCard`:
   resolve a PM *id* (sub default → customer default → first attached card), then
   `paymentMethods.retrieve(id)` fresh to guarantee the `card` hash.

After the fixes, all steps verified against the live DB: card 1 → trial + redemption
(Campaign 1); card 1 reused → revoked to `active` + immediate charge, no 2nd redemption
(Campaign 2); card 2 → normal 30-day trial + 2nd redemption row (Campaign 3).

> **Eventual-consistency note (resolved):** in the first messy attempt (two
> overlapping checkouts), the reused-card campaign sat `trialing` for ~5 min until
> a re-delivered event triggered `trial_end: 'now'`. A subsequent **clean,
> correctly-ordered re-run** (Test → Test_2 reused → Test 4 new) revoked the
> reused-card trial on the **first** `customer.subscription.created` delivery
> (`active` within seconds, no resend), so this was a one-off artifact of the
> overlapping manual checkouts, not a systematic bug.

> ⚠️ **Behavior changed after this run (2026-07-07).** The reused-card path now
> **CANCELS the trial with no charge** (instead of billing immediately) and sets
> `campaign_subscriptions.trial_blocked_reused_card = true` so the UI can show
> "this card already used its free trial — subscribe without one." The steps
> above were verified under the *old* bill-immediately behavior; re-verify the
> reused-card step against the new cancel flow: expect Campaign 2 to end at
> `status = 'canceled'` with **no invoice/charge**, `trial_blocked_reused_card =
> true`, and still exactly one `trial_redemptions` row.

## Pass criteria

A card that already redeemed a trial does **not** get a second free trial on any
other campaign, enforced server-side in the webhook — not by the client. As of
2026-07-07 that reused-card trial is **cancelled with no charge** (the DM is
prompted to subscribe without a trial) rather than billed immediately. A
different card is granted a normal trial. `trial_redemptions` holds exactly one
row per distinct fingerprint.

> Enforced in
> [`stripe-webhook`](../../supabase/functions/stripe-webhook/index.ts)
> `syncSubscription`: when `status === 'trialing'` and the card fingerprint is
> already in `trial_redemptions` for another campaign, it calls
> `stripe.subscriptions.update(sub.id, { trial_end: 'now' })`; otherwise it
> inserts the fingerprint. `public.trial_redemptions` is RLS-locked (no client
> policy) — only the service-role webhook reads/writes it.
