# QA — Read-only lock (lapsed campaign)

**Phase:** 1.5. **Requires `enforce_active = true`** + a Stripe **test clock**.
Verifies that when a trial (or subscription) fully lapses, the campaign becomes
read-only: content is preserved and viewable, writes are rejected, and a second
trial can't be started.

> **Scope note — what is testable today.** The read-only *mechanism*
> (`campaign_is_active()` flips to false; joins are refused; data is preserved) is
> live and testable now. Two parts of the full §1.5.3 criterion are **not yet
> executable** and are re-verified in the phases that build them:
> - **"players can't edit their own sheet/inventory/journal"** — those content
>   tables don't exist until Phase 2+. Each such table must add an RLS write
>   policy that checks `private.campaign_is_active(campaign_id)`, and **that
>   phase's QA must re-run this lock against its writes.**
> - **the read-only banner shown to DM + players** — that's the pending 1.5.2 UI
>   (needs a members-readable access RPC). Not present yet, so not checked here.

**Prerequisites:** shared prerequisites in [README.md](README.md), plus
`enforce_active = true` (restore to false after), and a campaign owned by
**Account A** whose subscription was created **on a Stripe test clock** so you can
advance past `trial_end`. (Test-clock setup is described in
[lifecycle-dunning-cancel.md](lifecycle-dunning-cancel.md).)

## Steps

- [x] Start from a `trialing` campaign on a test clock (card present, or card
      removed to force lapse). Confirm it is currently active:
      ```sql
      select private.campaign_is_active('<id>');   -- expect true while trialing
      ```
      ✔ (trialing campaigns returned is_active=true throughout the run)
- [~] **Advance the test clock past `trial_end`** with no successful payment.
      *Not needed to force a lapse here — we already had a naturally-lapsed
      campaign (**Test 5**, `canceled` from the reused-card cancel). The clock-based
      lapse path itself is exercised in [lifecycle-dunning-cancel.md](lifecycle-dunning-cancel.md).*
- [x] The subscription resolves to a lapsed status and the campaign is no longer
      active:
      ```sql
      select status from public.campaign_subscriptions where campaign_id = '<id>';
      -- canceled / unpaid / incomplete_expired
      select private.campaign_is_active('<id>');    -- expect FALSE
      ```
      ✔ (Test 5: status `canceled`, is_active = FALSE)
- [x] **Reads still work.** As both **Account A** and a player member, load the
      campaign → the roster, overview, and existing data still display. ✔ (Test 5
      loaded normally as owner)
- [x] **Joins are blocked.** Attempt to redeem a valid invite code for a new
      member → **rejected** because the campaign is read-only; no new
      `campaign_members` row is added. ✔ UI: joining Test 5 (code `VWE56TMM`) as a
      non-member returned "This campaign is read-only and is not accepting new
      players right now." The direct-RPC path is the *same* `redeem_invite_code`
      read-only gate already exercised via a direct RPC in
      [player-cap.md](player-cap.md).
- [x] **Data is preserved.** Confirm no rows were deleted by the lapse:
      ```sql
      select count(*) from public.campaign_members where campaign_id = '<id>';
      -- unchanged from before the lapse
      ```
      ✔ (Test 5 stayed at 1 member)
- [x] **No second trial.** As **Account A**, the billing panel on a lapsed campaign
      shows **subscribe-only** (no trial button) and Checkout bills immediately —
      it can't start a fresh 30-day trial. ✔ (verified via the explicit trial/pay
      feature; a lapsed campaign is trial-ineligible both in UI and server-side)
- [x] **Resubscribe unlocks.** Completing immediate-billing checkout →
      `campaign_is_active('<id>')` returns **true** again and joins succeed. ✔
      (proven by the cancel-flow resubscribe in
      [lifecycle-dunning-cancel.md](lifecycle-dunning-cancel.md))
- [x] **Restore:** `update private.billing_config set enforce_active = false;` ✔ (done)

## Pass criteria

A lapsed campaign reports `campaign_is_active() = false`, keeps all its data and
read access, refuses new joins (UI + direct RPC), cannot start a second trial, and
fully unlocks after the DM resubscribes. The per-content-table write-lock and the
DM/player banner are verified later, in the phases that introduce them (noted
above).

> `private.campaign_is_active(campaign_id)` (migration 0005) is the single source
> every write-lock reads: it returns true only for `active` / `trialing` /
> `past_due`, and returns true unconditionally while `enforce_active = false`.
> `public.redeem_invite_code` already consults it to block joins when read-only.
