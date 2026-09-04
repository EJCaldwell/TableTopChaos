# QA — battlemap canvas (Phase 9.1.2 / 9.1.3)

**Manual, in-browser. The user runs these.** The parts that can be proved
without a browser are already done and are NOT repeated here:

| Already covered | How |
|---|---|
| Access control (all four roles) | 8.2 RLS matrix, 111/111 — incl. a player cannot move the DM's monster, seize a token, or orphan one |
| Snapping, clamping, scaling maths | `src/features/playspace/grid.test.ts`, 16 unit tests |
| Realtime plumbing exists | `pg_publication_tables` + `relreplident = 'f'` verified on both tables |
| Types / build | `npm run build` clean |

So these steps cover only what genuinely needs eyes: does the thing render,
drag, persist, and appear on someone else's screen.

**Prerequisites:** a **playspace** or **rpg** campaign (not notetaker), you as
DM, and a second browser profile signed in as a player who is a member. A
battlemap image to hand.

## A. DM — map setup (the new **Maps** tab)

- [x] **A1.** Enter the campaign workspace. The map area says *"No battlemap
      yet. Open the Maps tab to upload a picture…"*, and a **Maps** entry is in
      the rail.
- [x] **A2.** Open **Maps** and upload a battlemap image. It appears in the map
      area **at its own aspect ratio** (not stretched) and goes live at once.
- [x] **A3.** In Maps, drag that map's **Grid** slider. The overlay spacing
      changes over the picture, live. Leave it aligned to the map's printed grid
      if it has one.
- [x] **A4.** Rename the map (click its name, type, click away). The name sticks.
- [x] **A5.** Reload. The map, its background, name and grid size all survive.

## B. DM — tokens

- [x] **B1.** Press **Add token**. A token appears at the map's centre.
- [x] **B2.** Drag it. It follows the pointer and **snaps to cell centres** on
      release — sitting inside a square, not straddling four.
      > **Only true for 1x1 now.** Token sizes arrived in 0056, and which lattice
      > a centre belongs on depends on the size: odd and half sizes snap to cell
      > CENTRES, even sizes (2x2, 4x4) to cell CORNERS, because a 2x2 centred in
      > a cell straddles four half-cells and lines up with nothing. The step is
      > still correct as written for a default token.
- [x] **B3.** Drag it again holding **Alt**. It lands exactly where dropped,
      off-grid.
- [x] **B4.** Drag one hard off the edge of the map. It stops at the boundary
      rather than disappearing.
- [x] **B5.** Reload. Every token is where you left it.
- [x] **B6.** Select a token, set **Controlled by** to the player, then back to
      **the DM**. Both directions work.

## C. Two sessions — the live half (the point of the feature)

Both windows on the same campaign, side by side if you can.

- [x] **C1.** DM drags a token. It moves in the **player's** window within a
      second or two, **without the player's view reloading** — nothing else
      flickers, and a panel they had open keeps its scroll position.
- [x] **C2.** The player drags **their own** token. The DM sees it move.
- [x] **C3.** The player tries to drag the **DM's** token. It does not move, and
      they get *"you may not move this token"* — **not** silence, and **not** a
      token that moves and then snaps back with no explanation.
- [x] **C4.** DM uploads a second map (or switches with the **Map** dropdown).
      The player's view **follows to the new map** on its own.
- [x] **C4b.** Switching maps is done from the **Maps** tab (**Make live**), and
      the live one is the row with the accent border and the **LIVE** label.
- [x] **C5.** Upload until the Maps tab reads **5/5**. The upload section is
      replaced by *"You have the maximum of 5 maps. Delete one below…"*

## D. Player — the read-only view

- [x] **D1.** The player has **no Maps tab at all** in the rail, and no Add
      token / Remove token controls.
- [x] **D2.** They can still **see** every token including the DM's monsters.
- [x] **D3.** Tab to a token and press an arrow key: their own token moves one
      square; the DM's does not.

## E. Notetaker campaigns get a map too

Do this in a **notetaker** campaign (a different one, or switch mode in
Settings).

- [x] **E1.** The rail has a **Battlemap** entry. Open it: the map opens in an
      ordinary window, and works the same way (drag, snap, live).
- [x] **E2.** Back in the **playspace** campaign, there is **no Battlemap tab** —
      the map is already the whole area, and two copies would be two places to
      drag the same token.

## Pass criteria

All of C, plus B2/B4 and E2. **C3 is the one that matters most** — it is the only step
here that shows the client handling a refusal honestly. The refusal itself is
already proven server-side; what is unproven is whether the UI tells the player
the truth about it.

## Known gaps, stated rather than hidden

- **Grid size does not re-snap existing tokens** — deliberate (0048 decision 1:
  positions are map pixels, not cells). Moving the slider under placed tokens
  leaves them where they are. That is correct, not a bug to report.
- **A token may sit outside the map** if the DM later shrinks it. The server
  deliberately does not clamp; the client clamps only on a fresh drag.
- **No zoom or pan yet.** The map is fitted to the area. A very large map is
  small on screen; that is a 9.2 concern.
- **Vision/fog is not wired** — `vision_enabled` exists on the row and does
  nothing until 9.2.

## Run log

**2026-08-28 — server-side + automated PASS; browser steps NOT RUN.**
- `npm run build` clean; **151** tests pass (16 in `grid.test.ts`, 6 in
  `tabs.test.ts`); `qa:checks` 62/62.
- 8.2 RLS matrix **111/111**, including all 16 playspace assertions.
- Realtime: both `playspace_maps` and `playspace_tokens` are in
  `supabase_realtime` with `relreplident = 'f'` (full), so DELETE events carry
  the id `mergeById` keys on.
- Sections A–E above are the user's and are **NOT RUN**. No claim is made here
  about drag, snapping or live sync behaving in a browser.

---

**2026-08-28 — user-run browser QA. PASS except one FAIL; five changes requested.**

Reported by the owner after running sections A–E:

- **A, B, C, D (except D18), E — PASS.** Map setup, upload, grid slider, rename,
  persistence, token drag, snapping, Alt off-grid placement, edge clamping,
  two-session live sync in both directions, the refusal message when a player
  drags the DM's token, map switching following through to the player, the 5/5
  cap, the player's missing Maps tab, and the notetaker/playspace split all
  behaved as written.
- **D18 — FAIL. Arrow keys did nothing.**

  > **Cause.** `handlePointerDown` called `e.preventDefault()` — correct, to stop
  > the browser starting a text selection or image drag mid-move — but that also
  > suppresses the focus a click normally gives a button. So a clicked token was
  > never focused and never received the keydown. Tabbing to it would have
  > worked, which is why the unit tests and the code review both missed it: the
  > handler was right, the focus was not.
  >
  > **Fix:** an explicit `e.currentTarget.focus()` alongside the preventDefault.

Five changes requested at the same time, all built (see the 2026-08-28c run log
below): movable grid offset, free-square token placement, zoom, player-placed
character tokens behind a DM switch, and the map filling the workspace area in
notetaker campaigns too.

**2026-08-28c — automated re-verification after those changes. Browser steps NOT RUN.**
- Migration **0055** applied. RLS matrix **114/114** — including the two new
  assertions that the DM's switch is a real gate (refused while off, allowed
  while on) and that a player still cannot put a PEER's character on a token.
- `npm run build` clean; **161** tests (28 in `grid.test.ts`, up from 16);
  `qa:checks` 62/62.
- A new checklist for the changed behaviour is in
  [battlemap-changes.md](battlemap-changes.md) and is **NOT RUN**.

> **A test that passed for the wrong reason.** The first draft of the
> peer-character assertion looked the id up with
> `(select id from characters where owner_id = p2)`. That subquery runs as the
> PLAYER, who cannot read a peer's character, so it returned NULL, the row
> inserted as a plain unlinked marker — which the policy rightly allows — and
> the assertion reported PASS. Any fixture lookup inside an assertion is subject
> to the very RLS being tested. Fixed by writing the id out literally.

**2026-09-02 — checkboxes back-filled from the run logs above.**

Sections A–E are now ticked, on the strength of the 2026-08-28 user run
("A, B, C, D (except D18), E — PASS"). They had been left unticked for four days
while the run log recorded a pass — the drift described in the `qa-testing` skill.

**One step needs its reasoning stated rather than assumed.** `D18` in that run log
is this file's OLD numbering for what is now **D3**, the arrow-key step, and it
was the one FAIL of that run. It is ticked here on the strength of a LATER run,
not that one: the F1–F9 keyboard series (diagonal movement, 2026-09-02) was run
and passed by the owner, and none of it is possible unless a clicked token takes
arrow keys — which is exactly what the `focus()` fix restored.

That is cross-file inference, so it is written down instead of left to look like
a direct result. If it is ever doubted, D3 is ten seconds to re-run.
