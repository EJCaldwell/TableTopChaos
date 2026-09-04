# QA — Phase 1.5: Monetization (per-campaign subscriptions)

Verifies the billing stack built in subphase 1.5: the three Stripe Edge
Functions, the `campaign_subscriptions` mirror, the entitlement functions
(`campaign_is_active` / `campaign_player_cap` / `campaign_storage_cap`), the
server-side caps + read-only lock, and the DM-only "Plan & billing" tab.
Acceptance criteria are from [`PLANNING.md`](../../PLANNING.md) §1.5.3.

## Read this first — the kill-switch

All *enforcement* (read-only lock, player cap, caps lifting on upgrade) is gated
by a single global flag, `private.billing_config.enforce_active`, which is
currently **`false`**. While it is false:

- `campaign_is_active()` returns **true** for every campaign, so nothing is ever
  read-only and no player cap is applied.
- The checkout / webhook / portal flow still works fully — you can start trials
  and watch `campaign_subscriptions` sync — it just isn't *gating* anything yet.

So the areas below split in two:

| Runs today (switch OFF) | Requires the switch ON |
|-------------------------|------------------------|
| checkout-and-trial, anti-abuse-trial-per-card, access-control | player-cap, read-only-lock, lifecycle-dunning-cancel |

> ⚠️ **`enforce_active` is global** (one row in `private.billing_config`). Turning
> it on freezes **every** campaign that lacks an active/trialing subscription, not
> just your test one. Only flip it on when your test campaigns are the only ones
> that matter, and **flip it back off** after the enforcement tests until you are
> truly launching:
> ```sql
> update private.billing_config set enforce_active = true;   -- start enforcement tests
> update private.billing_config set enforce_active = false;  -- restore pre-launch state
> ```

## Prerequisites (shared)

- Dev server running (`npm run dev`) against live project `fnykpoattheldxtkrozd`.
- Billing fully wired: both function secrets set (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SIGNING_SECRET`) and the Stripe **webhook registered in the same
  Stripe sandbox** as the price IDs (see
  [`../../supabase/functions/README.md`](../../supabase/functions/README.md)).
- **Two accounts** (call them **Account A** and **Account B**), each able to own
  campaigns and redeem invite codes.
- Stripe **test card** `4242 4242 4242 4242` (any future expiry / any CVC). For
  anti-abuse, a *second distinct* test card, e.g. `5555 5555 5555 4444`.
- For the switch-ON areas: a Stripe **test clock** to fast-forward trial end,
  dunning, and cancellation without waiting real days. (Stripe Dashboard →
  Workbench, or the Stripe API — see the individual files.)

## Manual areas

| Area | File | Needs | What it covers |
|------|------|-------|----------------|
| Checkout & trial start | [checkout-and-trial.md](checkout-and-trial.md) | switch OFF | Card required, session created, webhook syncs `trialing`, no charge, correct DB row |
| Anti-abuse (one trial per card) | [anti-abuse-trial-per-card.md](anti-abuse-trial-per-card.md) | switch OFF | Reused card → trial revoked/billed; new card → trial allowed; enforced in the webhook |
| Access control | [access-control.md](access-control.md) | switch OFF | Non-owner can't open Checkout/portal (403) or read the subscription row (RLS) |
| Player cap | [player-cap.md](player-cap.md) | switch ON | 6-player trial cap; 7th join rejected in UI **and** via direct insert; full cap when paid |
| Read-only lock | [read-only-lock.md](read-only-lock.md) | switch ON + clock | Lapsed trial → read-only for DM **and players**; reads OK; data preserved; no 2nd trial |
| Lifecycle: convert / dunning / cancel | [lifecycle-dunning-cancel.md](lifecycle-dunning-cancel.md) | switch ON + clock | Trial→active, failed-payment grace window, cancel→read-only→resubscribe |

## Deferred / blocked areas

Two §1.5.3 items can't be executed yet because they depend on unbuilt work; they
are documented (with the reason) in
[deferred-storage-and-cleanup.md](deferred-storage-and-cleanup.md):

- **Storage cap** — needs the upload pipeline from **Phase 1.6**.
- **3-month cleanup cron + warning emails** — the cron Edge Function is
  intentionally not built until campaign **export (4.2)** ships.

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — still the type-checker +
build only (no test runner in the project yet — **Vitest arrived in Phase 8.1**;
this records what covered 1.5 at the time), plus the notes on why the billing
logic is largely un-unit-testable without Stripe fixtures.

## Pass criteria for the phase

The three switch-OFF areas pass as-is; the three switch-ON areas pass with
`enforce_active = true` and a test clock; `npm run typecheck` + `npm run build`
succeed. The two deferred areas are re-run as part of their owning phases' QA
(1.6 for storage, 4.2/cleanup for the cron) — not required to close 1.5.
