# QA — TableTopChaos

This folder holds the manual and automated test plans for the app, organized
**one subdirectory per phase** (`QA/<phase>_tests/`), mirroring the phase
numbering in [`PLANNING.md`](../PLANNING.md). Each QA area is its own file so a
phase's checklist stays readable and reviewable.

## Scheme

- `QA/<phase>_tests/README.md` — that phase's index + manual-area table.
- `QA/<phase>_tests/automated-coverage.md` — what tooling checks for the phase
  (with source-file references). **These are dated records**: several written
  before Phase 8.1 say the project has no test runner, which was true then. They
  carry a banner rather than being rewritten.
- `QA/<phase>_tests/<area>.md` — one manual checklist per area that needs the
  running app or human judgement.
- `QA/tools/` — small dependency-light scripts that assert *behavior* directly,
  for logic that would otherwise only be reachable by pasting snippets into a
  browser console. Run them all with `npm run qa:checks`. Predates Vitest; new
  pure logic goes in a `.test.ts` beside the module instead.

## What "automated coverage" means today

Four things, and the first is newer than most of this folder:

1. **`npx vitest run` — the unit tests.** Vitest arrived in **Phase 8.1**, and
   since 2026-09-01 every unit of work adds tests for the pure logic it
   introduces, in the same change. Tests live beside the module
   (`src/**/x.test.ts`), not here.
2. **`npm run build`** — `tsc -b` + `vite build`. `noUnusedLocals` is on, so dead
   code fails the build.
3. **`npm run qa:checks`** — the bespoke harness in `QA/tools/`.
4. **`railway/scripts/95_rls_matrix.sql`** — the four-role access-control matrix,
   run by the Railway migrate job on every schema change. **This is the real test
   of every RLS policy and every trigger**, and the one thing that cannot be
   replaced by a browser step.

> **A unit test is how you avoid a browser step.** Anything provable in Node must
> not appear on a manual checklist — the owner runs those by hand, and a test
> re-runs forever. Two real defects in `walls.ts`, an infinite loop and a 2.8s
> freeze, were caught before any UI existed and neither was reachable from a
> checklist.

## Checkboxes are ticked in the same edit as the run log

This drifted for six phases: from 3.5 onward, files carried dated **PASS** run
logs while every `- [ ]` stayed empty, so 123 steps the owner had personally run
read as never attempted. Back-filled 2026-09-02.

Tick only what the owner reported passing; a partial run leaves the rest empty;
deferred and withdrawn steps stay unticked with prose saying why. **"Unticked"
must always mean "not passed"**, and it only can if it always does.

## Manual checklists never contain console steps

A checklist step is for a human at the rendered UI: clicking, dragging, visual
judgement, two-session realtime, uploads. If a behavior seems to need a browser
console, **it does not belong in a checklist** — test the logic directly in
`QA/tools/`, design the case out of existence, or find a UI path that reaches it.
A step nobody runs is not coverage; it is a file that never closes.

Manual checklist files follow a fixed shape: **Prerequisites → Steps
(checkboxes with expected results) → Pass criteria**.

## Phase status

| Phase | Area | QA status |
|-------|------|-----------|
| 1.1 | Project scaffold & Supabase wiring | Verified in browser (no checklist authored) |
| 1.2 | Auth & profiles | Verified in browser (no checklist authored) |
| 1.3 | Campaigns, membership & invite codes | Verified in browser (no checklist authored) |
| 1.4 | Role-based app shell & navigation | Checklists authored — see [`1.4_tests/`](1.4_tests/) |
| 1.5 | Monetization (per-campaign subscriptions) | Checklists authored — see [`1.5_tests/`](1.5_tests/); switch-ON areas pending an `enforce_active` flip + Stripe test clock |
| 1.6 | Media upload pipeline & content safety | Checklists authored — see [`1.9_tests/`](1.9_tests/) |
| 2.1 | Character record & flexible sheet | Checklists authored — see [`2.1_tests/`](2.1_tests/) |
| 2.2 | Inventory | Checklists authored — see [`2.2_tests/`](2.2_tests/) |
| 2.3 | Lore, backstory & portrait | Checklists authored — see [`2.3_tests/`](2.3_tests/) |
| 2.4 | Abilities/feats, spells & journal | Checklists authored — see [`2.4_tests/`](2.4_tests/) |
| 3.1 | DM notes & session log/recaps | Checklists authored — see [`3.1_tests/`](3.1_tests/); pending execution |

| 13 | Self-hosted backend migration (Supabase → Railway) | Checklists authored — see [`6_tests/`](6_tests/); **not started** |

> The table above lags the folder listing — phases 3.2–5.1 have authored
> `<phase>_tests/` folders whose rows were never added. Trust the directories.

> Phases 1.1–1.3 were QA'd interactively before this folder existed, so they
> have no checklist files. New phases author their `<phase>_tests/` folder as
> part of their `X.Y.3 — QA` task group.

> **Phase 6 is the one exception to one-folder-per-subphase:** the migration is a
> single sequenced operation with a rollback point, covered by one `6_tests/`
> folder spanning 6.1–6.5. It is also where **`get_advisors` stops being
> available** — a `pg_policies` + `rowsecurity` audit replaces it from that phase
> onward. See [`6_tests/automated-coverage.md`](6_tests/automated-coverage.md).
