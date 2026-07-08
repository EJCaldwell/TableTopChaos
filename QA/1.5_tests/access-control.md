# QA — Access control (billing)

**Phase:** 1.5. Runs with `enforce_active = false`. Verifies that only a
campaign's owner can start Checkout / open the portal, and that only its DM can
read the subscription row — enforced server-side (Edge Function + RLS), not just
by hiding UI.

**Prerequisites:** the shared prerequisites in [README.md](README.md). A campaign
owned by **Account A** with **Account B** joined as a **player**. A trial already
started on it (so a `campaign_subscriptions` row exists to attempt to read). A way
to call the Edge Functions directly (browser devtools console on the running app,
`curl`, or Postman) using each account's access token.

## Steps

- [X] **UI gating.** Signed in as **Account B (player)**, open the campaign → there
      is **no** "Plan & billing" tab in the tab bar (it's DM-audience only).
- [X] **Checkout function, non-owner.** As **Account B**, call
      `create-checkout-session` directly with the campaign id and a valid interval,
      using B's bearer token. Expect **HTTP 403** with an "only the campaign owner
      can manage billing" error — no Stripe session is created.
- [X] **Portal function, non-owner.** As **Account B**, call
      `create-billing-portal-session` for the campaign → **HTTP 403**, no portal
      session.
- [X] **Unauthenticated.** Call either function with **no** Authorization header →
      **HTTP 401** ("Not signed in").
- [X] **Subscription row RLS.** As **Account B**, attempt to read the row via the
      normal client:
      ```js
      // In the app console while signed in as B:
      await supabase.from('campaign_subscriptions')
        .select('*').eq('campaign_id', '<id>')
      ```
      Expect **zero rows** (RLS filters it out) — B cannot see A's billing data.
      ✔ Returned `data: []`.
- [X] **DM can read.** As **Account A (owner/DM)**, the same select returns the
      one row. The "Plan & billing" tab loads its status normally.
- [ ] *(Optional, other-DM)* If you can make a second DM in the campaign who is not
      the owner, confirm they also get **403** from `create-checkout-session`
      (owner-only, stricter than DM-only) but *can* read the subscription row (the
      RLS read policy is DM-wide).

## Pass criteria

Players (and unauthenticated callers) cannot open Checkout or the portal and
cannot read the subscription row; the owner can do all three; a non-owner DM can
read but not buy. All of this holds against direct API calls, not only the hidden
UI.

> Owner checks live in
> [`create-checkout-session`](../../supabase/functions/create-checkout-session/index.ts)
> and
> [`create-billing-portal-session`](../../supabase/functions/create-billing-portal-session/index.ts)
> (compare `campaigns.owner_id` to the JWT user). Row visibility is the
> `campaign_subscriptions_select_dm` RLS policy
> (`private.is_campaign_dm(campaign_id)`) from migration 0005; there are no
> client-facing insert/update/delete policies (the webhook writes via service
> role).
