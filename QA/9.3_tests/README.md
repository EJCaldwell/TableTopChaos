# QA — Phase 9.3: Line of sight, fog, and everything since

**Start here: [consolidated-run.md](consolidated-run.md).** That is the file to
run. The other two are history.

| File | Role |
|---|---|
| [consolidated-run.md](consolidated-run.md) | **The runnable checklist.** 39 steps. 38 PASS 2026-09-02; L1–L7 re-check outstanding |
| [fog-refinements.md](fog-refinements.md) | The dated history — nine stacked checklists, every bug, every reversal. **Not for running** |
| [vision-and-fog.md](vision-and-fog.md) | The original 9.3 checklist, superseded by both of the above |

## Why there are three files

`fog-refinements.md` accumulated nine checklists over two days against a moving
target: 82 steps, of which **23 test features that were built and then
deliberately removed** (walls clipped to line of sight; remembered walls) and
about 25 were duplicates — "the player's fog follows their own move" appears as
C1, H11 *and* I1. Running it as written would produce failures that are the
correct result.

`consolidated-run.md` collapses it to 39, each carrying its origin so a failure
reads back to the change that caused it.

**The history file keeps its unticked boxes.** Unticked has to keep meaning "not
passed", so a withdrawn step is marked withdrawn in prose rather than ticked to
tidy the folder.

## Current automated coverage

- **`npx vitest run` — 320 tests.** The ones that matter here: `vision.test.ts`
  (angular-sweep visibility), `walls.test.ts` (geometry + the simplifier's two
  performance defects), `grid.test.ts` (snapping, movement, occupancy),
  `visionCache.test.ts` (the neighbourhood prefetch), `geometryBundle.test.ts`
  (**fails if the deployed Edge Function's copy of the geometry drifts from the
  tested one** — proven by tampering).
- **`railway/scripts/95_rls_matrix.sql` — 154 assertions**, run by the migrate
  job. This is the real test of wall-crossing (0063/0064), sight-only walls
  (0067) and occupancy (0068/0069).
- `npm run build`, `npm run qa:checks` (62).

## The bugs worth remembering from this phase

- **A badly written assertion was a working exploit** — the two-step wall
  crossing (0064).
- **A careless splice deleted assertions while the matrix still reported "all
  passed"** — assertions that do not exist cannot fail. That is why the count is
  quoted on every change.
- **Occupancy looked like a sizing bug and was a rounding one** (0069): integer
  coordinates on an ODD grid put each edge half a pixel out, and every test and
  fixture used an even grid.
