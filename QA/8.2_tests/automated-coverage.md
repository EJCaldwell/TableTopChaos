# Automated coverage — Phase 8.2 (RLS / policy tests)

**63 assertions, all passing, run automatically on every schema change.**

Harness: [railway/scripts/95_rls_matrix.sql](../../railway/scripts/95_rls_matrix.sql).
Wired into [railway/migrate/migrate.sh](../../railway/migrate/migrate.sh), so
`railway up --service migrate` fails the deploy if any assertion fails. **A
migration that loosens a policy cannot ship.**

## Why this exists

RLS is the real access-control layer here; UI gating is defence in depth. That
model had been verified **by hand in every phase** — the same DM / player /
non-member / anon matrix, re-run from memory each time. Anything checked from
memory eventually stops being checked.

Three real leaks have already happened, all the same shape — a new function is
PUBLIC-executable by default, and this project's default privileges *also* grant
EXECUTE to `authenticated` by name, so `revoke … from public` restricts nothing:

| Function | |
|---|---|
| `campaign_entitlements` | leaked from migration 0009 until Phase 7.1 |
| `account_deletion_targets` | leaked another user's Storage paths |
| `lapse_sweep_targets` | would have leaked **every lapsed owner's email address** |

Each was caught by somebody remembering to look.

## How it runs safely against production

There is no test database — no Docker locally, no staging project. The entire
run happens inside **one transaction that never commits**: fixtures are seeded,
every persona is asserted, results are printed, then either an exception aborts
the transaction (failure) or an explicit `ROLLBACK` discards it (success).

Verified after every run: zero fixture users, zero fixture campaigns, and the
real totals unchanged at 5 users / 8 campaigns.

## What it covers

Five personas — **DM, player, a second player, non-member, anon** — plus
structural invariants.

| Area | Notable assertions |
|---|---|
| campaigns | DM sees own, not others'; direct `DELETE` matches nothing (0034) |
| roster | members see all 3; non-member sees none; player can't remove a peer |
| characters | DM reads both; **a player reads only their own**; peer can't edit |
| sheet / inventory | owner only — a peer reads zero |
| **journal** | owner only — **the DM cannot read or write it** |
| dm_notes / npcs / quests / sessions | DM only; player reads zero, writes denied |
| billing | subscription row is DM-only |
| shared_items | players read, cannot write — the asymmetry 4.2 built |
| schedule | a player cannot RSVP as somebody else |
| profiles | own + co-members; a stranger's profile is invisible |
| character names (0041) | members can read; **non-member RAISES** |
| locked tables | `trial_redemptions`, `deleted_accounts`, `orphaned_subscriptions` invisible to everyone |
| structural | every table has RLS; **no policy grants anything to `anon`**; the five service-role-only functions aren't executable by `authenticated`; locked tables still have zero policies |

**The second player is the most valuable persona.** A legitimate member who must
not see a peer's private material is what every in-campaign leak looks like.

Allowed paths are asserted too (DM writes a note, a player renames their own
character). Without those controls, "everything is denied" would pass.

## Two assertion kinds, deliberately not merged

- `assert_rows(..., 0)` — a denied **table** read returns zero rows.
- `assert_error(...)` — a denied **function** raises.

Checking both as "zero rows" would let a function that stopped refusing and
started returning nothing pass a test written to prove it refuses. That
distinction was found by the harness failing on
`campaign_character_names`, which raises `42501` for a non-member.

## Proven to catch regressions, not just to pass

A suite that has never failed is not known to work. Three deliberate
loosenings, each inside a rolled-back transaction:

| Sabotage | Result |
|---|---|
| `create policy … for select to anon using (true)` on `campaigns` | **caught** — structural check named `campaigns.qa_bad_anon_policy` |
| …and the behavioural half | **caught** — anon read 8 campaigns |
| `alter table journal_entries disable row level security` | **caught** — named `journal_entries` |

## Not covered

- Storage object policies (asserted ad-hoc in 7.3 for avatars, not yet here).
- Edge Function authorization, which is code rather than policy.
- Realtime event filtering.
- Anything about the UI — that is 8.1 (components) and 8.3 (journeys).
