# QA — Phase 9.1: Battlemap & tokens

| File | What it covers | Status |
|---|---|---|
| [battlemap-canvas.md](battlemap-canvas.md) | The original canvas: maps, upload, grid, token drag, two-session sync, role gating | **PASS** 2026-08-28 (A–E) |
| [battlemap-changes.md](battlemap-changes.md) | Everything requested after that first run — 10 stacked checklists | A–F, G, H, K, M, N, Q **PASS**; J, L, P never reported |
| [run-2026-08-28-battlemap-backend.md](run-2026-08-28-battlemap-backend.md) | The server-side half | **PASS** |

## Two steps here no longer describe the app

Both are ticked, and both should stay ticked — they record real results against
the code as it stood. They carry inline notes:

- **K1–K3** (battlemap-changes): "movement stops at the last FULL square" was
  **reversed by the owner the same day**; edge tiles are allowed again and
  `clampToFullCell` is gone. Re-running these today fails, correctly.
- **B2** (battlemap-canvas): "snaps to cell centres" is now true only for odd and
  half sizes. Even sizes snap to cell CORNERS (0056).

A run log edited whenever the product changes stops being evidence of anything.
The fix for a superseded step is a note, not a rewrite.

## Current automated coverage

Not per-phase any more: `npx vitest run` (**320** tests, of which `grid.test.ts`
holds the coordinate and occupancy maths), `npm run build`, `npm run qa:checks`
(62), and the RLS matrix (**154**), which is what actually proves the movement
and occupancy triggers.
