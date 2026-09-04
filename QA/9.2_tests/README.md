# QA — Phase 9.2: Vision toggle & obstructions (walls)

| File | What it covers | Status |
|---|---|---|
| [walls-and-vision.md](walls-and-vision.md) | Wall tools, the player seeing no walls, two-DM sync, the vision toggle | Foundation subset **PASS** 2026-09-01 |

**Deliberately a subset.** The split at the time was: run now anything that would
invalidate 9.3's foundations, defer anything 9.3 would exercise anyway. Ticked:
A1–A3, A7, A8, B1, B2, D1, D2. **A4–A6, A9, A10 and all of section C remain
unticked** — see that file's own note, including the correction to a PLANNING
claim that they had passed in 9.3.

## The decision this phase rests on

Walls are **DM-only in both directions** (0061). A player's client never receives
wall geometry, which is why 9.3 computes visibility in an Edge Function and
returns only polygons. **B1 is the step that matters most here**: the RLS matrix
proves the row is unreadable, but only a browser shows the UI is not rendering a
wall from somewhere else.

Later amended by **0066** (walls a DM may mark visible to players) and **0067**
(walls that block sight but not movement).
