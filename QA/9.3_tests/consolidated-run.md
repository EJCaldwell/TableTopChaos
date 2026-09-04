# QA — Phase 9.2/9.3 consolidated run

**This replaces the nine stacked checklists in
[fog-refinements.md](fog-refinements.md) for the purpose of RUNNING them.** That
file stays as the history — every checklist, every bug, every reversal, dated.
This one is the version you can actually work through top to bottom.

**82 steps became 39.** Three reasons, and the third is the one worth knowing:

1. **23 test removed behaviour.** B1–B4, E1–E8, F1–F5 and the old J1–J5 all
   check walls clipped to line of sight or remembered walls. Both were built and
   then deliberately removed. They are WITHDRAWN, not deferred — running them
   would produce failures that are the correct result.
2. **~25 were duplicates.** "The player's fog follows their own move" appears as
   C1, H11 and I1. "A hidden wall stays invisible" is C3 and G2. Nine checklists
   written over two days against a moving target say the same thing repeatedly.
3. **Every remaining step is traceable.** Each carries its origin, so a failure
   can be read back against the change that caused it.

**Two windows: DM in one, player in a second browser/profile.** Sections 1–2 are
DM-only; from section 3 you need both. The order leaves the app in the right
state for what follows — section 2 ends with both a normal and a sight-only wall
drawn, which sections 4 and 5 need.

---

## 1. Selection and hit areas — DM window *(H1–H5, J1–J6)*

The most-broken area in this batch: four separate defects, three of them mine.

- [x] **1.1** Click a token near its **edge** → selects, does **not** move.
- [x] **1.2** Click the **empty corner** just outside a token's circle → nothing
      is selected. *(Square hit area on a round token.)*
- [x] **1.3** With a **4x4** token beside a **1x1**, click the small one → the
      SMALL one selects. *(Paint order.)*
- [x] **1.4** Click **empty map** → deselects, and the sight preview disappears.
      *(This never worked; it was never built.)*
- [x] **1.5** With token A selected, click token B **directly** → B selects, A
      does not. No clicking away first.
- [x] **1.6** Drag a token normally → still moves, no stickiness at the start.
- [x] **1.7** Tokens are selectable and draggable **everywhere** — over fog,
      against walls, at the map edge. *(Regression guard: an over-correction on
      the clipping wrapper is what broke selection the first time.)*

## 2. Sight preview and wall tools — DM window *(A1–A10, D4, D5)*

- [x] **2.1** Select a token → **"Show its line of sight"** appears, ticked, with
      a shaded dashed region.
- [x] **2.2** Put the token beside a wall → the far side is **not** shaded.
- [x] **2.3** Near the **end** of a partial wall → the shading reaches round it.
- [x] **2.4** **Drag** the token → the region follows *as you drag*.
- [x] **2.5** Set **Sight** to 6 → a circle about six squares across. Clear it →
      back to walls-only.
- [x] **2.6** Untick the checkbox → gone; tick → back.
- [x] **2.7** Works on an **NPC/monster** token, not just a player's.
- [x] **2.8** The token still **drags** while its region shows.
- [x] **2.9** Walls stay drawn **on top of** the shaded region.
- [x] **2.10** Arm a wall tool → drawing works, and does **not** clear the
      selection mid-stroke. Disarm → tokens selectable again.
- [x] **2.11** Draw a wall with **"Blocks movement" unticked** → it appears
      **dashed**. Leave it, and a normal wall, on the map.

## 3. Occupancy — DM window *(H6–H8)*

- [x] **3.1** Move one token **onto** another → refused; it stops against it
      rather than springing back.
- [x] **3.2** Move it to the square **beside** another → allowed. **Try from more
      than one direction** — the failure here is direction-dependent, so one
      lucky attempt proves nothing.
- [ ] **3.3** A **4x4** token cannot move so its BODY covers a small one, even
      with their centres squares apart.

## 4. Fog and walls — both windows *(G1–G5, C1–C3, D1–D3, D6–D8, H9, H10)*

- [x] **4.1** A **visible** wall is drawn **in full**, everywhere, regardless of
      where the player stands.
- [x] **4.2** A **hidden** wall is not drawn at all. *(4.1 alone would also pass
      if hidden walls had started leaking — this is the half that separates
      "always drawn" from "everything drawn".)*
- [x] **4.3** Fog covers floor **and** tokens; tokens appear, disappear and clip
      with line of sight.
- [x] **4.4** The player **cannot see through** the sight-only wall.
- [x] **4.5** The player **CAN walk through** it. *(The regression: `movePolygons`
      ignored `blocks_movement`, so the client refused a move the database
      allowed — which is why the server-side matrix could not catch it.)*
- [x] **4.6** The normal wall beside it still stops the player.
- [x] **4.7** As DM, **click and drag a player's token**. Both work.
- [x] **4.8** As DM, drag any token **through** a wall. Allowed.

## 5. Latency and smoothness — both windows *(H11, H12, I1–I9, K1–K6)*

The subjective section. Say so plainly if something merely feels the same; a
shrugged pass here is worth less than an honest "no different".

- [x] **5.1** Player takes **one step**: the light changes **with** it.
- [x] **5.2** Step in all **eight** directions — no direction lags the others.
- [x] **5.3** **Hold** a direction across the map: the fog keeps pace without
      stuttering or catching up in bursts.
- [x] **5.4** Step **around a corner** into a room you could not see: it appears
      immediately AND correctly — the right shape, not the previous square's
      light. *(Showing stale light is the cheapest way to look fast.)*
- [x] **5.5** Walk, then **stand still for five seconds**. The light does NOT
      jump back to where the walk started. *(Distinct signature: a backwards jump
      about half a second after stopping.)*
- [x] **5.6** Walk **back and forth quickly** over the same squares — no flicker
      between old and new light. *(This is what puts responses most out of
      order.)*
- [x] **5.7** **Drag** a long way in one gesture: correct on release, settles
      once, stays settled.
- [x] **5.8** Stand at the **map edge** and step along it — no glitching where
      part of the precomputed ring is off-map.
- [x] **5.9** Player idle; DM **draws** a wall → appears within about a second.
      DM **erases** it → disappears the same way, and the old light does **not**
      come back on the player's next step. *(The stale-cache test.)*
- [x] **5.10** A player with **two tokens** still moves correctly — just without
      the speedup.

---

## Pass criteria

Nine of the 39 would actually change a ship decision:

| Step | Why it is the one that matters |
|---|---|
| **1.4 + 1.5** | The report, and what it was costing — switching tokens |
| **1.7** | Catches an over-correction; this exact wrapper broke selection once |
| **2.2** | Without it the sight preview is decoration |
| **3.2** | Direction-dependent failure — one attempt is not evidence |
| **4.2** | Separates "always drawn" from "everything drawn" |
| **4.5** | The defect the server-side matrix structurally could not see |
| **5.4** | Correctness under speed, where stale light is indistinguishable from fast light |
| **5.5 + 5.6** | The two jumpiness mechanisms, each with a distinct signature |

## Reporting

Per section — `1: all good`, or `1.3: the big token still won`. Anything you are
unsure about, say so rather than passing it; an uncertain pass is the one thing
this folder cannot recover from.

## Run log

**2026-09-02 — run by the owner. 38 of 39 PASS; 3.3 FAILED and is fixed.**

Everything in sections 1, 2, 4 and 5 passed, plus 3.1 and 3.2.

> **3.3 — "the 4x4 size acts as if it was a 5x5 hitbox."**

**The occupancy maths was exact; the token was in the wrong place.** Which
lattice a token's centre belongs on depends on its SIZE (`snapToken`): odd and
half sizes sit on cell centres, even sizes on cell corners, because a 2x2 or 4x4
centred on a cell centre lines up with nothing.

The Size control wrote `size_cells` **alone**. So a 1x1 promoted to 4x4 stayed on
the cell-centre lattice — half a cell out — and its four-square body then
straddled half a column at each end, touching parts of **five** columns and five
rows. Every square it blocked, it blocked correctly *for where it was standing*.
It simply was not standing where the grid says a 4x4 goes.

**Why this was invisible to everything else.** `snapToken` has had the odd/even
lattice rule and its tests since 9.1, and they all still pass — the rule was
never wrong. `resnapTokens` already re-snaps every token when the DM changes the
GRID, for exactly this reason. Resizing is the same event seen from the other
side (the lattice moves relative to the token rather than the token relative to
the lattice) and it was the one path that did not go through a re-snap.

Fixed: the Size control now writes `x`, `y` and `size_cells` together, snapping
to the lattice the NEW size requires. Three tests added, written as the failure —
including the shrink direction (4x4 → ½ must come off the corner, or a small
creature straddles four squares). **316 tests.**

> **Re-check before this is called closed:** promote a 1x1 to 4x4 and confirm it
> now blocks exactly four columns; shrink a 4x4 to ½ and confirm it centres in a
> single square; and confirm an existing 4x4 already on the map is unaffected
> until it is next resized — nothing back-fills stored positions, by design.

## 2026-09-02 (b) — 3.3 was NOT fixed by the re-snap. Real cause found.

> *"The 2x2 is now acting like a 3x3, and the 4x4 is still acting like a 5x5,
> both being the left and top have an extra row/column."*

**The re-snap was a real fix for a real problem and was not this problem.** The
live data settled it: the 4x4 was already sitting exactly on the corner lattice
(`x_mod` and `y_mod` both 0). Alignment was never wrong.

**The owner's map has grid size 85 — an odd number, and that is the whole bug.**

Token coordinates are INTEGERS (`x int`, migration 0048), but a snapped position
often is not. A cell centre is `offset + grid/2 + k*grid`, so an odd grid puts
every 1x1 on a half pixel and it is stored rounded. A centre of 802.5 becomes
803 — and that half pixel moves the token's edge half a pixel INTO its
neighbour. Both tokens round independently, so the gap can be a full pixel out,
against a tolerance of **0.25px**.

**Why the extra row and column were on the left and top specifically**, which is
the detail that made the report solvable: rounding always goes the same
direction, so on the right and bottom it pushes the neighbour AWAY and nothing
happens, while on the left and top it pushes TOWARD and the square is refused.
A symmetric cause with a one-sided symptom — which is exactly why it read as
"the token is too big" rather than "the tolerance is too small".

**Why nothing caught it.** Every unit test, every probe I ran, and the RLS matrix
fixture all use grid 70, where `grid/2` is exact and nothing rounds. The bug is
invisible on an even grid and unmissable on an odd one.

Tolerance raised to **1.5px** in `grid.ts` and in the database
(**migration 0069**) — margin over the 1px worst case, and still far below
anything real: the smallest legitimate overlap is a half-size token's half cell,
2.5px even at the schema's minimum grid of 10. Four tests added, all on grid 85,
including one asserting a genuine overlap is still refused. Matrix **154/154**,
**320 tests**.

## 2026-09-02 (c) — selection indicator: it existed, and I had just broken it

There was already a 2px outline on the selected token. It was invisible because
**the circular clip I added an hour earlier to fix the hit areas clipped it
away**: an outline is drawn OUTSIDE the border box, so `clip-path: circle(50%)`
removes it — and it removed the drop shadow under ringless tokens at the same
time. Two visual regressions from one line, neither of them announced.

The clip is gone. Circular hit-testing now happens in the pointer handler, which
costs no visuals: a press more than half the token's width from its centre is
treated as a click on the map underneath, and deselects. The outline is now 3px
with an offset so it does not merge into the coloured ring.

### L. Re-check

- [ ] **L1.** On the real map (grid 85), a 1x1 can stand immediately **left of**
      and **above** a 2x2 and a 4x4. *(The report.)*
- [ ] **L2.** Right and below still work, as they always did.
- [ ] **L3.** Moving a token genuinely **onto** another is still refused.
- [ ] **L4.** The **selected token is visibly ringed ON its own edge** — not
      floating outside it — and the ring disappears on deselect. A selected
      token must look exactly the same SIZE as an unselected one.
- [ ] **L5.** Ringless tokens still have their drop shadow. *(Second casualty of
      the clip.)*
- [ ] **L6.** Clicking a token's empty **corner** still selects nothing — the
      hit area is still circular. *(The behaviour the clip was there for.)*
- [ ] **L7.** Dragging and arrow-key movement are unaffected.

**2026-09-02 (d) — the selection ring moved onto the token's frame.**

`outlineOffset` went from `+2px` to `-3px`, pulling the ring inward by its own
width so its outer edge sits exactly on the token's edge.

Not only cosmetic: a ring drawn outside makes a token appear to GROW when
selected, and on a battlemap where size is a rule — a 2x2 covers four squares —
a token that visibly changes size on click is saying something untrue about the
creature. The ring now marks the token without resizing it.

Still `outline` rather than a border: it follows `border-radius` so it stays a
circle, and takes no layout space, so it cannot shift the token off its square
or disagree with what the occupancy maths thinks the token covers.
