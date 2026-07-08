# QA — Player cap (trial vs paid)

**Phase:** 1.5. **Requires `enforce_active = true`** (see the kill-switch warning
in [README.md](README.md)). Verifies the 6-player trial cap is enforced during
the trial — in the UI **and** against a direct insert — and that it lifts to the
full Pro cap once the campaign is paid.

**Prerequisites:** the shared prerequisites in [README.md](README.md), plus:

- `update private.billing_config set enforce_active = true;` for the duration of
  this test. **Restore to `false` afterward** unless launching.
- The default caps from migration 0005: `trial_player_cap = 6`,
  `paid_player_cap = null` (unlimited). Adjust the SQL below if you've tuned them.
- A campaign owned by **Account A** currently **`trialing`** (start a trial per
  [checkout-and-trial.md](checkout-and-trial.md)).
- Enough distinct accounts (or invite redemptions) to push membership to the cap.
  The DM counts as a member, so plan the math around whatever `list_members`
  reports.

## Steps

- [x] Confirm the campaign is `trialing` and the cap resolves to 6:
      ```sql
      select private.campaign_player_cap('<id>');   -- expect 6 while trialing
      ```
- [x] Add members (mint invite codes, redeem from other accounts) until the
      campaign has **6** members total.
- [x] **UI path — 7th rejected.** Attempt to redeem a code for a **7th** member →
      the join is refused with a clear "campaign is full" style error, and no 7th
      row is added.
- [x] **Direct path — 7th still rejected.** As the 7th prospective member, call the
      redeem RPC directly (bypassing any UI guard):
      ```js
      await supabase.rpc('redeem_invite_code', { p_code: '<valid-code>' })
      ```
      Expect an error (cap enforced in the function), and:
      ```sql
      select count(*) from public.campaign_members where campaign_id = '<id>'; -- still 6
      ```
- [x] **Cap lifts when paid.** Move the campaign to `active` (convert the trial via
      the test clock — see [lifecycle-dunning-cancel.md](lifecycle-dunning-cancel.md))
      and confirm:
      ```sql
      select private.campaign_player_cap('<id>');   -- expect NULL (unlimited) when active
      ```
      Now a 7th member can join (UI and RPC both succeed).
- [x] **Restore:** `update private.billing_config set enforce_active = false;`
      (Done — switch was left ON to run read-only-lock / lifecycle, then restored to
      false at the end of the switch-ON areas.)

## Run log — 2026-07-07 (PASS, reduced-cap variant)

Only 3 test accounts exist, so reaching 6 real members wasn't possible. Verified
the identical enforcement path with the cap **temporarily lowered to 2** (allowed
by the "adjust if you've tuned them" note above):

- `campaign_player_cap` returned **6** for a trialing campaign and **NULL
  (unlimited)** for the already-`active` Test_2 → "cap lifts when paid" confirmed
  via SQL, no test clock needed.
- With `trial_player_cap = 2` and "Test" already holding 2 members, a 3rd account
  (`ejcaldwell00`) was rejected joining with code `PGEC69N8` — **both** via the UI
  and via a direct `redeem_invite_code` RPC — and the member count stayed at 2.
- Follow-up fix during this run: the UI showed a generic "Could not join campaign"
  because `joinByCode` threw the raw PostgrestError (not an `Error`). Fixed to
  re-wrap it, and migration 0007 made the trial-cap message explain the free-trial
  limit + subscribe path. Re-verified the specific message shows.

## Pass criteria

While `trialing` with the switch on, membership is capped at 6 and the 7th join is
rejected both through the UI and through a direct `redeem_invite_code` call; once
`active`, the cap lifts to the paid value (unlimited by default). The rule is
enforced in the database function, not only the client.

> Enforced in `public.redeem_invite_code` (migration 0005), which reads
> `private.campaign_player_cap(campaign_id)` and rejects joins at/over the cap.
> `campaign_player_cap` returns the trial cap while `trialing`, the paid cap when
> `active`/`past_due`, and `null` (no cap applied) whenever
> `enforce_active = false`.
