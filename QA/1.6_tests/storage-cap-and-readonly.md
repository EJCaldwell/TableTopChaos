# QA — Storage cap & read-only lock (uploads)

**Phase:** 1.6. Verifies uploads respect the per-campaign storage cap (from 1.5)
and are rejected when the campaign is read-only. Ties `campaign_storage_cap` /
`campaign_storage_used` / `campaign_is_active` into the upload path.

**Prerequisites:** shared prerequisites in [README.md](README.md). For the cap
test you'll temporarily shrink the cap (like the player-cap QA did) so it's
reachable without uploading gigabytes.

## Steps — storage cap

- [x] With the campaign writable, note current usage:
      ```sql
      select private.campaign_storage_used('<id>') as used,
             private.campaign_storage_cap('<id>')  as cap;   -- cap null = unlimited
      ```
- [x] **Shrink the cap** just above current usage so the next upload would exceed
      it (enforcement reads `private.billing_config`; the cap fields are
      `trial_storage_bytes` / `paid_storage_bytes`). E.g. to force a trialing
      campaign over cap:
      ```sql
      update private.billing_config set trial_storage_bytes = private.campaign_storage_used('<id>') + 1000;
      ```
      *(Requires `enforce_active = true` so the trial cap actually applies; flip
      it on for this test and restore after — see the 1.5 kill-switch warning.
      Alternatively, since `enforce_active=false` resolves the cap to
      `paid_storage_bytes`, shrinking that field forces over-cap without touching
      the kill-switch — that's what this run did.)*
- [x] **Over-cap upload rejected.** Upload another image → **413** "reached its
      image-storage limit." No new `media_assets` row; usage unchanged.
- [x] **Restore** the cap and switch:
      ```sql
      update private.billing_config set trial_storage_bytes = 524288000;
      update private.billing_config set enforce_active = false;
      ```

## Steps — read-only lock

- [x] Point the upload at a **read-only** campaign (a lapsed/canceled subscription
      with `enforce_active = true`, per [read-only-lock.md](../1.5_tests/read-only-lock.md)):
      ```sql
      select private.campaign_is_active('<id>');   -- expect FALSE
      ```
- [x] Upload to it → **403** "This campaign is read-only; uploads are paused."
      No row/object created.

## Pass criteria

An upload that would push a campaign over its storage cap is rejected server-side
with nothing stored; uploads to a read-only campaign are rejected. Both reuse the
1.5 entitlement functions, so caps/lock stay consistent app-wide.

> Enforced in [`upload-media`](../../supabase/functions/upload-media/index.ts) via
> the `campaign_entitlements` RPC (is_active + cap + used) before storing.

## Run log

**2026-07-08 — PASS.** Test campaign had one approved asset (used = 32406 bytes).

**Storage cap:** set `paid_storage_bytes = used + 100` (32506) with
`enforce_active=false` (which resolves the cap to the paid value), giving 100
bytes of headroom. Uploading `valid.png` → **413** "This campaign has reached its
image-storage limit." Row count stayed at **1** and `campaign_storage_used`
stayed **32406** — the cap check runs *after* processing but *before* any Storage
write, so nothing was stored. Restored `paid_storage_bytes = 5368709120`.

**Read-only lock:** the test campaign has no `campaign_subscriptions` row, so with
`enforce_active=true` it is not active. Uploading → **403** "This campaign is
read-only; uploads are paused." Restored `enforce_active=false` immediately after
(kill-switch verified back OFF — leaving it ON would freeze every subscription-less
campaign).

> **Observation (non-blocking):** with the kill-switch ON and no subscription row,
> `private.campaign_is_active` returns SQL `NULL` (not `false`) — `NULL IN
> ('trialing','active','past_due')` is `NULL`. The Edge Function's `!ent.is_active`
> treats that as read-only (fail-closed, the safe direction), so behavior is
> correct; noted only because the return is `null` rather than a strict `false`.
