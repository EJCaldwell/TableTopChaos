# Billing Edge Functions (Phase 1.5)

Three Deno Edge Functions implement Stripe billing.

| Function | Auth | Purpose | Status |
|----------|------|---------|--------|
| `create-checkout-session` | JWT (owner) | Starts Stripe Checkout (trial or immediate) for a campaign. | ✅ deployed (v1) |
| `create-billing-portal-session` | JWT (owner) | Opens the Stripe portal to manage/cancel. | ✅ deployed (v1) |
| `stripe-webhook` | **none** (Stripe signature) | Source of truth: syncs subscription status into `campaign_subscriptions`; enforces one-trial-per-card. | ✅ deployed (v1, `verify_jwt=false`) |

All three are deployed and ACTIVE on project `fnykpoattheldxtkrozd` (pushed via
the Supabase connection — no CLI required). `verify_jwt` is mirrored in
`../config.toml` (false only for the webhook) so a future
`supabase functions deploy` stays consistent.

**What remains needs your Stripe/Supabase credentials:** set the two secrets
(step 1) and register the webhook (step 3). Secrets can't be set through the
connection — use the dashboard or CLI.

> ⚠️ Never paste real secret keys into this file (or any committed file). Use the
> `sk_test_xxx` / `whsec_xxx` placeholders below; real values go only in the
> Supabase secret store.

## 1. Set function secrets

Dashboard: **Project Settings → Edge Functions → Secrets → Add new secret** (add
each key/value). Or via CLI:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SIGNING_SECRET=whsec_xxx
# Optional overrides (test-mode price IDs are baked in as defaults):
#   STRIPE_PRICE_MONTHLY=price_...  STRIPE_PRICE_SEMIANNUAL=price_...  STRIPE_PRICE_ANNUAL=price_...
#   APP_URL=https://your-app-origin   TRIAL_PERIOD_DAYS=30
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — do **not** set them. Updated secrets take effect on the running
functions without a redeploy.

> Set `APP_URL` for any non-local deploy, or Checkout will redirect back to
> `http://localhost:5173`.

## 2. Deploy — already done

All three functions are deployed and ACTIVE (v1). You only need the CLI here if
you change the function code:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-billing-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

## 3. Register the webhook in Stripe

Stripe Dashboard (**Test mode**) → Developers → Webhooks → **Add endpoint**:

- URL: `https://fnykpoattheldxtkrozd.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- Copy the endpoint's **signing secret** (`whsec_…`) into
  `STRIPE_WEBHOOK_SIGNING_SECRET` (step 1). No redeploy needed — the secret is
  picked up on the next request.

## 4. Turn on enforcement (only after the above works)

Everything is gated by a kill-switch that starts **off**, so the app is not
frozen before billing works. Once Checkout + webhook are verified end-to-end,
flip it:

```sql
update private.billing_config set enforce_active = true;
```

Until then, `campaign_is_active()` returns true for all campaigns and no player
cap is enforced.

## Local testing (optional)

```bash
supabase functions serve            # serves all functions locally
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```

Use Stripe **test cards** (e.g. `4242 4242 4242 4242`) and a **test clock** to
simulate trial→active and lapse→read-only transitions for the 1.5.3 QA.
