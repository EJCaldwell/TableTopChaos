# QA — TableTopChaos

This folder holds the manual and automated test plans for the app, organized
**one subdirectory per phase** (`QA/<phase>_tests/`), mirroring the phase
numbering in [`PLANNING.md`](../PLANNING.md). Each QA area is its own file so a
phase's checklist stays readable and reviewable.

## Scheme

- `QA/<phase>_tests/README.md` — that phase's index + manual-area table.
- `QA/<phase>_tests/automated-coverage.md` — what CI/tooling checks for the
  phase (with source-file references). This project has **no general test
  runner** (Phase 8); automated coverage is the TypeScript compiler + production
  build, plus any purpose-built harness in `QA/tools/`.
- `QA/<phase>_tests/<area>.md` — one manual checklist per area that needs the
  running app or human judgement.
- `QA/tools/` — small dependency-light scripts that assert *behavior* directly,
  for logic that would otherwise only be reachable by pasting snippets into a
  browser console. Run them all with `npm run qa:checks`.

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
