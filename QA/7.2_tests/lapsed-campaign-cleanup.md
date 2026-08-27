# QA — Lapsed-campaign cleanup (Phase 7.2, blocker 1)

**Status: Areas A and B PASS (2026-08-26). C, D and E NOT RUN.** See
[run-2026-08-26-lapse-cleanup.md](run-2026-08-26-lapse-cleanup.md) — the first
run of Area A found a real bug (`campaign_is_active` returned NULL rather than
false for a campaign with no subscription), fixed in migration 0037.

**What this covers:** migration `0036_campaign_lapse.sql`, the
`cleanup-campaigns` Edge Function, the `cleanup` cron service, and the in-app
countdown (`LapseBanner`).

**Why it exists:** the Refunds page states that a campaign read-only for three
months is deleted, with warnings 30/7/1 days before. Nothing implemented that.
This is the work that makes the sentence true — and it is the only part of 7.2
that can destroy user data, so it gets the same fixture treatment 7.1 got.

---

## Before running anything

This feature deletes campaigns permanently. Two rules, both learned the hard way
in 7.1:

1. **Never test against a campaign you care about.** Create disposable ones.
2. **Take a backup first** and know it restores. The sweep runs an hour after the
   nightly dump precisely so a mistake has a recent recovery point.

The whole feature is inert until `enforce_active` is flipped, so on the current
production stack every test below requires deliberately arming it and disarming
it afterwards. Treat the restore step of each area as mandatory, not cleanup.

---

## Area A — the clock (server-side, automated)

Runs through the `migrate` job and direct SQL. No browser.

- [x] **A1. Migration applies.** `railway up --service migrate` reports `1 new`
      and every guard passes — grant sweep, RLS assertion, and the
      function-privilege assertion now covering `lapse_sweep_targets`,
      `record_lapse_warning` and `refresh_lapse_state`.
- [x] **A2. The service-role functions are NOT executable by `authenticated`.**
      This is the headline check, not a formality: `lapse_sweep_targets()`
      returns **the email address of every lapsed campaign's owner**. A newly
      created function is PUBLIC-executable and this project's default
      privileges additionally grant EXECUTE to `authenticated` *by name*, so
      `revoke from public` alone would leave it wide open — the exact shape of
      both leaks found in 7.1. The migrate assertion must report none.
- [x] **A3. Dormant while `enforce_active` is false.** Run
      `select * from public.refresh_lapse_state();` → `started 0, cleared 0`, and
      every `campaigns.read_only_since` stays null. This is the default state of
      production; if it fails, stop.
- [x] **A4. The clock starts, once.** With `enforce_active = true` and a
      subscription-less fixture campaign: first refresh reports `started 1` and
      sets `read_only_since` to now. **Run it again** — `started 0`, and
      `read_only_since` is unchanged. The clock must never rewind.
- [x] **A5. Not retroactive.** `read_only_since` equals the time of the first
      refresh, **not** the campaign's creation date or any subscription
      timestamp. If this is wrong, the launch flip deletes the entire database
      on day one.
- [x] **A6. The clock clears, and forgets the warnings.** Set the fixture's
      subscription to `active`, refresh → `cleared 1`, and **both**
      `read_only_since` and `lapse_warned_days` are null. A campaign that
      resubscribes after its 7-day warning must warn again from the top on its
      next lapse, not resume at 7.
- [x] **A7. `updated_at` is not restamped.** Note the fixture's `updated_at`,
      run a refresh that starts its clock, and confirm `updated_at` did not
      move. Otherwise every abandoned campaign looks freshly edited every
      morning.
- [x] **A8. Warning selection picks the most urgent REACHED threshold.** Backdate
      a fixture so `days_remaining` is 3 with no warnings sent.
      `lapse_sweep_targets()` must return `warn_days = 7` — one row, one
      threshold, never the whole schedule at once. **Not `1`:** at 3 days left
      the 1-day threshold has not arrived; it is sent when it does, so the final
      notice still happens. This checklist originally asserted `1` and was
      wrong — see the run log.
- [x] **A9. `record_lapse_warning` is monotonic.** After recording 7, recording
      30 is a no-op. An out-of-order or retried call must not reset progress and
      re-close an interlock that had already opened.

## Area B — the interlocks (server-side, automated)

Each of these asserts that something is **refused**. A pass here is nothing
happening.

- [x] **B1. Deletion is off by default.** With a fixture backdated well past the
      grace window and all warnings recorded, `due_for_delete` is **false**
      while `lapse_delete_enabled` is false — even with `enforce_active` true.
- [ ] **B2. The env switch is independent.** With both DB switches on but
      `CLEANUP_DELETE_ENABLED` unset, the sweep reports the campaign under
      `skipped` with reason `CLEANUP_DELETE_ENABLED is not true`, and the
      campaign still exists.
- [x] **B3. No final warning ⇒ no deletion.** Fixture past the grace window with
      `lapse_warned_days = 7` (not 1) and everything armed: `due_for_delete` is
      false. **This is the single most important assertion in this file.** It is
      what guarantees nobody's campaign is deleted after a warning they never
      received.
- [ ] **B4. A failed email does not record a warning.** Point `RESEND_API_KEY`
      at a bad key and run a sweep with a warning due. Expect: HTTP 200 with a
      non-empty `errors` array, `lapse_warned_days` still null, the cron deploy
      marked **FAILED**. Repeat as often as you like — it must never progress.
- [x] **B5. Wrong/missing cleanup key ⇒ 401.** `curl` the function with no
      `x-cleanup-key`, with a wrong one, and with the right one. Also confirm
      that with `CLEANUP_SECRET` unset the function denies **everything** rather
      than allowing it.
- [x] **B6. Dry run changes nothing.** `{"dryRun": true}` with everything armed
      and a campaign genuinely due: response lists it under `deleted` with
      `dryRun: true`, and the campaign, its media and its Stripe subscription are
      all still there afterwards.

## Area C — an actual deletion (server-side, on a fixture)

Only after every box in B passes.

- [ ] **C1. It deletes what it should.** A fixture campaign with at least one
      uploaded image and a live Stripe test subscription, fully armed and past
      its final warning. Expect the subscription cancelled at Stripe, **both**
      storage objects gone (original *and* thumbnail), the campaign row gone,
      and the cascade to have taken its characters/notes with it.
- [ ] **C2. Stripe is cancelled BEFORE the row is deleted.** Verify in the
      Stripe dashboard. A campaign deleted with a live subscription charges a
      card forever for something that no longer exists, with no in-app trace —
      the exact bug fixed for account deletion in 7.1 and for manual campaign
      deletion in 0034.
- [ ] **C3. One bad campaign does not stop the sweep.** Two due fixtures, one
      with a deliberately broken Stripe id. Expect the broken one in `errors`,
      the other actually deleted, and HTTP 200.
- [ ] **C4. No stranded storage.** Nothing left in the `media` bucket under the
      deleted campaign's prefix. Deleting rows without their objects leaves files
      unreachable forever — `storage.objects` is the index, not the bytes.
- [ ] **C5. The log names the campaign.** After deletion the log line is the only
      surviving record that it existed. Confirm it carries the campaign id, name,
      owner and `read_only_since`.

## Area D — the countdown (MANUAL — the user runs this in the browser)

**Do not mark these without the user's reported result.** Requires
`enforce_active = true` and a fixture campaign with a DM and at least one player.

- [ ] **D1. Nothing shows on a healthy campaign.** Open a subscribed campaign as
      both DM and player. No banner anywhere, in either view.
- [ ] **D2. The banner appears for the DM** on a lapsed campaign, above both the
      overview and the workspace, and does not scroll away.
- [ ] **D3. The banner appears for a PLAYER too, with the same countdown.** The
      freeze and the deletion destroy players' character sheets and journals;
      showing this only to the person who pays would mean the people with the
      most to lose never see it.
- [ ] **D4. With deletion disarmed it says so.** The banner must state that
      nothing will be removed. A countdown that looks live but is not would
      train people to ignore the real one.
- [ ] **D5. With deletion armed it counts down**, and turns red inside the final
      seven days. Check the day figure against the Refunds page wording.
- [ ] **D6. A non-member gets nothing.** Confirm the RPC refuses rather than
      returning an empty row, so it cannot be used to probe whether a campaign
      id exists.
- [ ] **D7. Export still works while lapsed.** The Refunds page promises this
      explicitly as the way out, and it is the promise most likely to be relied
      on by somebody who has just seen the banner.

## Area E — the emails (MANUAL — the user)

Blocked until a Resend sending domain is verified (PRE_LAUNCH §3). Until then
Resend delivers only to the Resend account owner's own address, so E2 cannot be
tested honestly at all.

- [ ] **E1. The 30/7/1 emails arrive** at the campaign owner's address, once
      each, in order, across a simulated cycle.
- [ ] **E2. They arrive for an address that is NOT the Resend account owner's.**
      This is the blocker itself. Until it passes, the interlock in B3 is the
      only thing standing between a lapsed campaign and a silent deletion.
- [ ] **E3. The content is accurate and specific** — names the campaign, gives
      the real deletion date, and offers both ways out. A vague "action required"
      mail is indistinguishable from spam, and this is the only notice anyone
      gets.
- [ ] **E4. The wording matches the Refunds page**: three months, 30/7/1 days,
      images included, unrecoverable. If they disagree, the page is wrong, since
      the page is the promise.

---

## Restore checklist (run after ANY area above)

- [ ] `update private.billing_config set enforce_active = false,
      lapse_delete_enabled = false;`
- [ ] `CLEANUP_DELETE_ENABLED` unset (or `false`) on the `functions` service.
- [ ] `CLEANUP_DRY_RUN=true` on the `cleanup` service.
- [ ] Cron schedule back to `0 9 * * *` if it was shortened for testing.
- [ ] Fixture campaigns and their Stripe test subscriptions removed.
- [ ] `select count(*) from public.campaigns where read_only_since is not null;`
      → **0**.

## Known gaps, stated rather than hidden

- **A restore resurrects a deleted campaign.** Unlike account deletion, there is
  no tombstone for campaigns and the `migrate` job does not re-apply these
  deletions. A restore from before a sweep brings the campaign back, minus its
  storage files — visibly broken rather than silently wrong. Whether campaign
  deletion deserves the tombstone treatment 7.1 gave accounts is an open
  question; deliberately not answered here.
- **Nothing notifies a player that a campaign they are in was deleted.** They
  find out by it being gone. Only the owner is emailed, which is what the Refunds
  page says, but it is worth revisiting.
- **`days_remaining` is computed from `now()` on the server** and the banner does
  not tick. A tab left open overnight shows yesterday's figure until reloaded.
