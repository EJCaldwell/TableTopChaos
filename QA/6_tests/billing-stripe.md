# QA — Billing & Stripe after the migration

**Phase:** 6.4. **Browser + Stripe dashboard — yours to run**, with server-side row
checks from me.

**Why this is the highest-risk area after access control:** the webhook URL changes,
which means a new endpoint and a **new signing secret**. The old secret will not
verify. A silently-failing webhook looks like a working checkout — the customer is
charged and no entitlement row is written.

**Prerequisites**
- 6.3 deployed with a public gateway domain.
- Stripe **test mode**. New webhook endpoint registered at
  `https://<gateway>/functions/v1/stripe-webhook` with its new secret set as a
  service variable.
- All three price IDs plus `TRIAL_PERIOD_DAYS` set on the `functions` service.
- `APP_URL` pointing at the real frontend origin (drives checkout return URLs).

---

## Steps

- [ ] **Signature verification works.** Send a test event from the Stripe dashboard
      → the endpoint returns 2xx. A 400 with a signature error means either the wrong
      secret or a modified request body. The Caddyfile deliberately adds no
      body-rewriting directives to the functions block for exactly this reason — if
      that block was edited, `constructEventAsync()` rejects every event.
- [ ] **Checkout → trial start.** Run the trial path from the DM-only Plan & billing
      tab. Redirect works, and you land back on `APP_URL`.
- [ ] **Webhook actually landed.** Server-side: a `campaign_subscriptions` row exists
      with the expected status. Confirm in the Stripe dashboard that the event shows
      delivered, not retrying.
- [ ] **Reused-card trial cancels without charging** — the anti-abuse behaviour from
      Phase 1.5. Use a card already tied to a redeemed trial: the subscription must
      cancel and **no charge** appears in Stripe. Verify `trial_redemptions` recorded
      it. This depends on the service-role client, so it also proves
      `SERVICE_ROLE_KEY` is correctly derived from the shared `JWT_SECRET`.
- [ ] **Pay-now path** completes and sets an active status.
- [ ] **Billing portal session** opens (`create-billing-portal-session`) and returns
      to the app.
- [ ] **Only the campaign owner** can start checkout — a player or non-member calling
      `create-checkout-session` for that campaign is rejected. The function resolves
      the caller from their JWT via the per-request user client rather than trusting a
      client-supplied id, so this also confirms GoTrue tokens verify inside the
      functions.
- [ ] **Entitlement gating still reads correctly.** `enforce_active` remains **OFF**
      per Phase 1.5, so confirm the flag's current value carried over rather than
      assuming — a flag that restored as `true` would lock every campaign.

## Pass criteria

Test events verify, the trial and pay-now paths both write the correct
`campaign_subscriptions` row, the reused-card path cancels with **zero charge**, the
portal opens, non-owners are rejected, and `enforce_active` is still OFF.

**A webhook that returns 2xx but writes no row is a FAIL**, even though the UI looks
correct — check the row, not the redirect.

## Run log

_No runs yet._
