# Run log — RLS access-control matrix, 2026-08-28

**PASS — 63/63.** Harness written, verified, and wired into the `migrate` job so
it runs on every schema change. Deploy confirmed:

```
psql:/scripts/95_rls_matrix.sql:356: NOTICE:  RLS matrix OK — all assertions passed
migrate: RLS matrix OK — the full access-control matrix holds
migrate: done
```

Detail in [automated-coverage.md](automated-coverage.md).

## The one failure on the first run was the harness, not the app

`campaign_character_names` for a non-member came back `ERROR 42501` where the
assertion expected zero rows — recorded as a FAIL.

The app was right and the harness was wrong, and the fix is worth keeping in
mind rather than patching away: **a denied TABLE read returns zero rows; a denied
FUNCTION raises.** Checking both as "zero rows" would let a function that stopped
refusing and started returning nothing pass a test written to prove it refuses —
the assertion would be true and meaningless. Added `assert_error()` as a separate
helper.

## Negative controls — the suite is known to FAIL, not just to pass

A security suite that has never failed is not evidence of anything. Three
deliberate loosenings, each inside a rolled-back transaction:

| Sabotage | Detected? |
|---|---|
| `create policy … for select to anon using (true)` on `campaigns` | **yes** — named `campaigns.qa_bad_anon_policy` |
| the behavioural consequence of the above | **yes** — anon read 8 campaigns |
| `alter table journal_entries disable row level security` | **yes** — named `journal_entries` |

After rollback: zero anon policies, zero tables without RLS.

## Safety against production

There is no test database, so this runs against the live one. Every run is a
single transaction that never commits. Verified after the run:

```
leftover_fixture_users:      0
leftover_fixture_campaigns:  0
leftover_fixture_chars:      0
total_users:                 5   (unchanged)
total_campaigns:             8   (unchanged)
```

The failure path is also safe: the final block RAISEs, which aborts the
transaction, so a failing run discards its fixtures for the same reason a passing
one does.

## What this changes going forward

Structural checks already in `migrate` proved RLS was switched *on* and that five
functions were locked. Neither said anything about what the policies **allow**.

The matrix does, and it runs on every `railway up --service migrate`. So the
question "did that migration quietly widen anything?" is now answered by the
deploy rather than by remembering to check — which is precisely how all three
previous leaks got in.

## Known gaps, stated rather than hidden

- **Storage object policies are not in the matrix.** Avatar visibility was
  asserted ad-hoc in 7.3 (6/6) but is not part of the automated run. It should
  be — `storage.objects` is where the avatar and media policies live.
- **Edge Function authorization is not covered.** That is code, not policy, and
  needs a different harness.
- **Realtime event filtering is not covered.** RLS gates it, but that is asserted
  indirectly at best.
- The matrix seeds its own fixtures rather than testing the real data, so a
  policy that behaves differently at scale or against odd real-world rows would
  not be caught.
