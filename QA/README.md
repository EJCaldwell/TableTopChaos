# QA — D&D Campaign Manager

This folder holds the manual and automated test plans for the app, organized
**one subdirectory per phase** (`QA/<phase>_tests/`), mirroring the phase
numbering in [`PLANNING.md`](../PLANNING.md). Each QA area is its own file so a
phase's checklist stays readable and reviewable.

## Scheme

- `QA/<phase>_tests/README.md` — that phase's index + manual-area table.
- `QA/<phase>_tests/automated-coverage.md` — what CI/tooling checks for the
  phase (with source-file references). This project currently has **no test
  runner**; automated coverage is the TypeScript compiler + production build.
- `QA/<phase>_tests/<area>.md` — one manual checklist per area that needs the
  running app or human judgement.

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
| 1.6 | Media upload pipeline & content safety | Checklists authored — see [`1.6_tests/`](1.6_tests/) |
| 2.1 | Character record & flexible sheet | Checklists authored — see [`2.1_tests/`](2.1_tests/) |
| 2.2 | Inventory | Checklists authored — see [`2.2_tests/`](2.2_tests/) |
| 2.3 | Lore, backstory & portrait | Checklists authored — see [`2.3_tests/`](2.3_tests/) |
| 2.4 | Abilities/feats, spells & journal | Checklists authored — see [`2.4_tests/`](2.4_tests/) |
| 3.1 | DM notes & session log/recaps | Checklists authored — see [`3.1_tests/`](3.1_tests/); pending execution |

> Phases 1.1–1.3 were QA'd interactively before this folder existed, so they
> have no checklist files. New phases author their `<phase>_tests/` folder as
> part of their `X.Y.3 — QA` task group.
