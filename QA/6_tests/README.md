# QA — Phase 6: Self-hosted backend migration (hosted Supabase → Railway)

**Phase:** 13 (all subphases 6.1–6.5).

Unlike the feature phases, this folder covers the **whole phase in one directory**
rather than one per subphase. The migration is a single sequenced operation with a
rollback point — splitting its gates across five folders would obscure the ordering
that makes it safe.

**Spec:** [`../../railway/README.md`](../../railway/README.md) ·
**Runbook:** [`../../docs/RAILWAY_MIGRATION.md`](../../docs/RAILWAY_MIGRATION.md) ·
**Plan:** [`../../PLANNING.md`](../../PLANNING.md) (Phase 6)

---

## What makes this phase's QA different

Every other phase QA's *new behaviour*. This phase changes **what enforces access
control** while behaviour stays identical — so the risk profile is inverted:

- **Nothing looks broken when it breaks.** A table that restores with RLS disabled
  serves data happily. It fails **open**. The UI is not a detector here.
- **The frontend is unchanged** (0 code changes; 2 `.env` values), so a green build
  proves almost nothing about correctness. Don't let it substitute for the matrix.
- **`get_advisors` is gone.** It's a hosted-Supabase feature with no self-hosted
  equivalent. The `pg_policies` + `rowsecurity` audit in
  [`access-control-matrix.md`](access-control-matrix.md) replaces it, and that
  substitution must be recorded in the run log.

**Hard numbers to assert** (captured from live project `fnykpoattheldxtkrozd`
on 2026-08-04 — re-capture just before cutover in case the schema moves):

| Invariant | Expected |
| --- | --- |
| Policies across `public` + `storage` | **100** |
| Tables with `rowsecurity = true` | **30** |
| `auth.users` rows | **5** |
| `storage.objects` rows | **106** |
| Database size | ~14 MB |

## Manual areas

| Area | Covers | Who runs it |
| --- | --- | --- |
| [`stack-preflight.md`](stack-preflight.md) | 6.1 — local stack, migration replay, `auth.uid()`, gateway routing | Mostly automatable (server-side) |
| [`data-migration.md`](data-migration.md) | 6.2 — row counts, UUID preservation, media re-upload | Mostly automatable (server-side) |
| [`access-control-matrix.md`](access-control-matrix.md) | 6.5 — **the headline**: four-role matrix, policy/RLS audit | Server-side + browser halves |
| [`media-and-realtime.md`](media-and-realtime.md) | 6.3/6.5 — signed URLs, cross-campaign leak, two-session realtime | **Browser (user)** |
| [`billing-stripe.md`](billing-stripe.md) | 6.4 — webhook signature, checkout, trial, reused-card | **Browser (user)** |

## Automated coverage

See [`automated-coverage.md`](automated-coverage.md). Per project convention there
is no test runner; automated coverage is `tsc` + production build, plus the
server-side SQL assertions run through the Supabase MCP / `psql`.

## Order matters

Run top to bottom. `stack-preflight` gates everything: if `auth.uid()` returns NULL,
all 100 policies evaluate against a null identity and every later result is
meaningless.

**Do not decommission the hosted project or cancel anything until
[`access-control-matrix.md`](access-control-matrix.md) and
[`billing-stripe.md`](billing-stripe.md) both pass.** Rollback is two `.env` values,
but only while the hosted project still exists.

## Run log

_No runs yet — phase not started._
