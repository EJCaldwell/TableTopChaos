# 6.4 — Stripe re-wiring

Re-points billing at the Railway gateway: a new webhook endpoint, a new signing
secret, and the same test-mode keys and prices the hosted project already uses.

Source under test: the three Stripe Edge Functions
([create-checkout-session](../../supabase/functions/create-checkout-session/index.ts),
[create-billing-portal-session](../../supabase/functions/create-billing-portal-session/index.ts),
[stripe-webhook](../../supabase/functions/stripe-webhook/index.ts)) running on
Railway, unmodified.

## Run log

### 2026-08-19 — PASS

**Endpoint registered** at
`https://gateway-production-85a0.up.railway.app/functions/v1/stripe-webhook`
(`we_1U6D9x…`), subscribed to exactly the four events the handler switches on:
`checkout.session.completed`, `customer.subscription.created`, `.updated`,
`.deleted`. Signing secret written straight into
`railway/.env.stack.production` without passing through the terminal.

| Gate | Result |
|---|---|
| Webhook rejects a forged signature | **400 Invalid signature** |
| Webhook rejects a missing signature | **400 Missing signature** |
| Webhook accepts a correctly-signed payload | verification passes, reaches the handler |
| Checkout session created **by Railway** | **PASS** — see attribution below |
| Real event → row written in `campaign_subscriptions` | **PASS** — `sub_1U6DOw…`, `sub_1U6DTX…`, `sub_1U6DVg…` |
| Trial reaches `trialing` | **PASS** — `d0e1fc8f`, 30-day trial |
| Annual purchase reaches `active` with a 1-year period | **PASS** — `b0f7fadb`, ends 2027-08-19 |
| Reused-card trial cancels **without charging** | **PASS** — cancelled 4s after trial start, no charge |
| `trial_redemptions` records the new fingerprint | **PASS** — `L1FZet04DR96XZan` |

### The finding that nearly produced a false pass

**Both webhook endpoints are registered in Stripe** — the hosted one and the new
Railway one — and Stripe delivers every event to every enabled endpoint. Because
the campaign IDs are identical in both databases (the data was migrated), *both
stacks wrote the same subscription rows*, with matching ids and timestamps.

So a browser test cannot be attributed to a stack: an identical row appears in
both regardless of which one served the checkout. The tell was the **trial
length** — 30 days when Railway was configured for 14, and 30 is the code default
in `_shared/config.ts`, which is what hosted would use.

Resolved by creating a checkout session **directly against Railway's function**
with a throwaway user and a campaign that exists *only* on Railway. The returned
session's `client_reference_id` was that Railway-only campaign, which hosted
could not have produced. That isolates Railway's own checkout path. (The
session's `trial_period_days` reads as `None` on retrieve — Stripe does not
return `subscription_data`; it is a create-only parameter, so absence there
proves nothing either way.)

Probe artifacts removed afterwards: Stripe session expired, campaign deleted,
user deleted; 8 campaigns remain, as before.

### Trial length corrected

`TRIAL_PERIOD_DAYS` was set to **14** on Railway — a value invented while writing
the deploy sheet, not matching production. Hosted has it unset and therefore uses
the code default of **30**. Set to **30** everywhere (2026-08-19, at the user's
direction) so the two stacks agree.

### Latent bug noted, not fixed

[stripe-webhook/index.ts:140](../../supabase/functions/stripe-webhook/index.ts#L140)
does `sub.items.data[0] as any` with no guard, while line 136 uses optional
chaining for the same array. A subscription event with an empty `items` array
throws and returns 500. Real Stripe events always carry an item, so this is not
reachable in normal operation — it surfaced only because a synthetic test event
was fabricated with `items.data: []`. Worth a guard eventually; deliberately not
changed mid-migration.

### Also observed

`_shared/clients.ts` constructs the Stripe client **at module load**, so a
missing `STRIPE_SECRET_KEY` takes down **every** function importing that module —
including `upload-media`, which has nothing to do with billing. It surfaced as
four functions returning 500 before the keys were set. Invisible on hosted, where
the key has always been present.

**Variable-name trap:** the code reads `STRIPE_WEBHOOK_SIGNING_SECRET`, not
`STRIPE_WEBHOOK_SECRET` (which is what the original runbook and the first draft
of the deploy sheet said). With the wrong name the handler logs
`signature verification failed` — naming the wrong cause entirely; the real error
is `Missing required environment variable`. Corrected in all env files and docs.

## Still outstanding for 6.4 / carried into 6.5

- **The dual-endpoint hazard.** Both endpoints stay registered until cutover.
  That is *useful* right now — both databases stay in billing sync — but at
  cutover the **live-mode** endpoint must be repointed at the gateway and given
  its new signing secret. Miss it and real subscription events stop being
  recorded, silently, while checkout continues to appear to work.
- Everything tested here is **test mode**. The live-mode key, prices and webhook
  are untouched and still point at hosted.
