# QA — walls & vision toggle (Phase 9.2)

**Manual, in-browser. The user runs these.** Only what needs eyes; everything
provable without a browser is already done and is not repeated:

| Already verified | How |
|---|---|
| Walls are DM-only in BOTH directions | RLS matrix 133/133 — a player reads **0** wall rows |
| Geometry CHECK rejects rubbish | matrix: one-point wall and `["a","b"]` both raise 23514 |
| Simplify, rect corners, closing edge, malformed JSON | 23 unit tests in `walls.test.ts` |
| A 12000-point stroke does not freeze the page | timing assertion in the same file |
| Build / layout harness | clean; 238 tests; `qa:checks` 62/62 |

**Prerequisites:** DM window + a player window (second profile), a playspace or
rpg campaign with a map uploaded.

## A. Drawing (DM)

- [ ] **A1.** A **Walls** strip appears above the token strip: Line, Room,
      Freehand, Erase, Clear walls.
- [ ] **A2.** Press **Line**. It looks pressed, and a warning says token dragging
      is off. Drag on the map: a dashed preview follows, and on release a solid
      red line stays.
- [ ] **A3.** With a tool armed, try to **drag a token**. It does **not** move.
      *(This is the mode-collision check.)*
- [ ] **A4.** Press the tool again to disarm. Tokens drag normally.
- [ ] **A5.** **Room**: drag a rectangle. It closes into four walls.
- [ ] **A6.** **Freehand**: draw a long wiggly wall. It saves, and follows the
      shape you drew.
- [ ] **A7.** **Erase**: click a wall — it disappears. Clicking near it (not
      exactly on the 3px line) still works.
- [ ] **A8.** Reload. Every wall survives, in the right place.
- [ ] **A9.** Zoom in and out. Walls stay the same visual thickness and stay
      aligned to the picture.
- [ ] **A10.** **Clear walls** asks first, then removes all of them.

## B. The player never sees them (the point of 0061)

- [ ] **B1.** In the **player's** window, the map shows **no walls at all** and
      no Walls strip.
- [ ] **B2.** The player can still drag their own token normally — the wall layer
      is click-through for them.

## C. Vision toggle

- [ ] **C1.** Maps tab → each map has **"Limit what players can see (fog &
      walls)"**, unticked by default.
- [ ] **C2.** Tick it. A note appears explaining players never receive wall
      geometry. **Nothing else changes yet** — the fog itself is 9.3.
- [ ] **C3.** Untick it. The note goes.
- [ ] **C4.** Reload: the setting survived.

## D. Two windows

- [ ] **D1.** Open the same campaign as DM in **two** windows. Draw a wall in
      one — it appears in the other within a second or two.
- [ ] **D2.** Erase it in one — it goes in the other.

## Pass criteria

All of A and B. **A3 and B1 carry the most weight.** A3 is the mode collision —
drawing a wall must never move a piece, and the failure only shows after you let
go somewhere unexpected. B1 is the whole reason 0061 exists; the matrix proves
the row is unreadable, but only this shows the UI does not somehow render one
anyway.

## Known gaps, stated rather than hidden

- **Nothing is hidden from players yet.** The vision toggle stores a setting;
  the fog that uses it is 9.3. Ticking it changes nothing on screen today, and
  C2 says so.
- **Walls cannot be edited after drawing**, only erased and redrawn. `kind` is
  stored so an editor can offer the right handles later.
- **No snapping** of wall endpoints to the grid yet.

## Run log

**2026-09-01 — automated + server-side PASS; browser steps NOT RUN.**
Migrations 0060 + 0061 applied; matrix **133/133** including "player receives NO
wall geometry at all"; build clean; **238** tests (23 new in `walls.test.ts`);
`qa:checks` 62/62. Sections A–D are the user's and are unrun.

**2026-09-01 — user-run browser QA of the FOUNDATION subset. ALL PASS.**

Deliberately a subset, not the whole file. The split was: run now anything that
would invalidate 9.3's foundations, and defer anything 9.3 will exercise anyway.

Run and passed:
- **A1–A3** — the Walls strip, the armed-tool state, dashed preview, wall saved.
- **A3b (mode collision)** — with a tool armed, a token does **not** drag. This
  is the failure you would otherwise meet mid-session, after letting go
  somewhere unexpected.
- **A7, A8** — erase (including clicking *near* a wall, not exactly on the 3px
  line), and walls surviving a reload.
- **B1, B2** — the player's window shows **no walls and no Walls strip**, and
  their own token still drags. B1 is the one 9.3 rests on: the matrix proves the
  row is unreadable, but only this shows the UI is not rendering one from
  somewhere else.
- **D1, D2** — a wall drawn in one DM window appears in the other, and erasing
  it removes it there too.

**Deferred to 9.3, with reasons rather than silence:**
- **All of section C (vision toggle).** It stores a boolean and does nothing
  visible until fog exists. "I ticked a box and nothing happened" is not
  evidence today; it becomes a real test the moment 9.3 lands.
- **A5, A6, A9, A10** (rooms, freehand, zoom, clear) — these get exercised
  naturally while building maps to test fog against, so running them twice is
  wasted effort.

Recorded as deferred, NOT as passed.
