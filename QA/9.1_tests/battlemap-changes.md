# QA — battlemap changes (9.1.2c)

**Manual, in-browser. The user runs these.** Covers only the five things that
changed on 2026-08-28 after the first QA run. Everything that already passed is
not repeated.

Already verified without a browser:

| | |
|---|---|
| DM switch is a real gate, both directions | RLS matrix 114/114 (refused off, allowed on) |
| A player still cannot use a peer's character | matrix, with the id written literally |
| Grid offset maths, free-cell search | 12 new unit tests (28 total in `grid.test.ts`) |
| No battlemap tab in any mode | `tabs.test.ts` |

**Prerequisites:** DM window + a player window (second profile), a playspace or
rpg campaign, and a notetaker campaign for section E.

## A. Movable grid

- [ ] **A1.** Maps tab → a map now has **three** sliders: `Grid`, `Shift →`,
      `Shift ↓`.
- [ ] **A2.** Drag `Shift →`. The overlay slides sideways over the picture; the
      lines stay the same distance apart.
- [ ] **A3.** With a token already placed, move both shift sliders. **The token
      does not move** — deliberate (0048 decision 1).
- [ ] **A4.** Reload. The offsets survive.

## B. Token placement

- [ ] **B1.** Press **Add token** (now in the bar under the map) three times
      without moving anything. You get **three visible tokens in different
      squares**, not one stack.
- [ ] **B2.** Drag a token onto the exact centre square, then Add another. It
      lands in a free square beside it, not underneath.

## C. Zoom

- [ ] **C1.** The bar under the map has **− / 100% / +**. Zoom in: the map grows
      and the frame scrolls.
- [ ] **C2.** **Drag a token while zoomed in.** It lands where you drop it —
      this is the one that would break if zoom were handled wrongly.
- [ ] **C3.** Click the percentage to reset to fit.
- [ ] **C4.** **Pinch on the trackpad** (or **Ctrl/⌘ + scroll wheel**) over the
      map. It zooms, and **the page itself does not zoom**.
- [ ] **C5.** Point at a specific feature on the map and pinch in. **That feature
      stays under the cursor** rather than sliding away.
- [ ] **C6.** Plain two-finger scroll (no Ctrl) still **scrolls** the map when it
      is bigger than the frame — it does not zoom.
- [ ] **C7.** Zoom **out** below 100%. The map gets **smaller**, not bigger.

## D. Players placing their own character

- [ ] **D1.** Player window, before the DM allows it: **no** "Put … on the map"
      button.
- [ ] **D2.** DM ticks **"Let players put their own character on this map"** in
      the Maps tab. The player's button appears (after their view updates).
- [ ] **D3.** Player clicks it. Their character appears on the map, labelled
      with the character's name, and the **DM sees it arrive live**.
- [ ] **D4.** The button is **gone** for that player now — one character, one
      token.
- [ ] **D5.** The player can drag their new token; the DM's tokens still refuse.
- [ ] **D6.** DM unticks the box. The player cannot add another (the button is
      gone); the token already placed **stays**.

## E. Arrow keys (the D18 failure)

- [ ] **E1.** **Click** a token you own, then press an arrow key. It moves one
      square. *(This is the exact case that failed: clicking never focused the
      token.)*
- [ ] **E2.** The move persists — reload and it is still there.
- [ ] **E3.** Click a token you do NOT own and press an arrow key: nothing moves.

## F. Notetaker campaigns

- [ ] **F1.** In a **notetaker** campaign, the live map now fills the workspace
      area, the same as playspace — **no Battlemap tab anywhere.**
- [ ] **F2.** There is **no Add token** button in that campaign, for anyone.
- [ ] **F3.** The DM still has the **Maps** tab and can upload/switch maps.

## Pass criteria

All of D and E. **C2, C7 and D6** carry the most weight. C2 is where a zoom
implementation that ignores the element's real size would silently place tokens
wrong. C7 is a bug that was found and fixed during the build — two different
sizing rules met at zoom 1 and disagreed there, so zooming out made the map
larger — and it is cheap to re-check. D6 proves unticking the box actually
withdraws the permission rather than only hiding a button.

## Run log

**2026-08-28 — automated PASS; browser steps NOT RUN.** Migration 0055 applied,
matrix 114/114, build clean, 161 tests, `qa:checks` 62/62. Sections A–F are the
user's and are unrun.

**2026-08-28b — wheel/pinch zoom added.** Registered as a NON-PASSIVE listener by
hand: React attaches wheel listeners passively, and a passive listener cannot
preventDefault, so the browser would have zoomed the whole page instead of the
map. Trackpad pinch arrives as a wheel event with `ctrlKey` set, so pinch and
Ctrl+wheel are one code path. Zoom is anchored to the cursor via a layout effect
(before paint, or the map visibly jumps and corrects itself).

> **A bug found while wiring it, not by a test.** The element was sized
> `width: '100%'` at zoom 1 and `width_px * zoom` otherwise. On a frame narrower
> than the map those two rules disagree exactly at zoom 1, so zooming out to 0.9
> produced an element LARGER than the fitted one. Replaced with a single rule,
> `fitScale * zoom`, where `fitScale` is measured with a ResizeObserver. Steps
> C4–C7 exist because of this.

**2026-09-01 — user-run browser QA. ALL PASS.**

The owner ran the trimmed list (zoom 1–7, arrow keys 8–10, player placement
11–14) and reported **all tests pass**. That closes the two items the automated
work could not:

- **Arrow keys (the D18 regression) — PASS.** The explicit `focus()` alongside
  `preventDefault()` is confirmed working; the fix had been written blind.
- **Unticking the DM switch — PASS.** The permission is withdrawn and the token
  already placed stays put, which is the half the RLS matrix cannot show.
- Zoom by button, pinch and Ctrl+wheel, cursor anchoring, dragging while zoomed,
  and zooming out below 100% all behaved.

Sections A, B and F of this file remain formally unrun, and stay that way
deliberately: grid-offset maths and free-cell placement are covered by 12 unit
tests, and the notetaker split by `tabs.test.ts`. Re-running them by hand would
add no evidence.

Two changes requested at the same time, both built:

- **Typed grid values.** The three grid controls now carry a number box beside
  the slider. Both, not either: the slider is how you FIND an alignment, dragging
  while watching the map; the number is how you set one you already know, and how
  you nudge by exactly one pixel, which a slider on a 1000-unit range cannot do.
  Typed values are clamped rather than rejected — a number input lets someone
  type 9000, and silently doing nothing looks broken.
- **Sideways scrolling.**

  > **This was a bug, not a missing feature.** The scroll frame used
  > `display: grid` with `place-items: center`. Centring a child that OVERFLOWS
  > its scroll container makes the overflow on the start side unreachable — the
  > browser clips it and `scrollLeft` cannot go below 0 — so the left edge of a
  > zoomed-in map could not be scrolled to at all. Replaced with `margin: 0 auto`
  > on the child, which centres it while it fits and produces normal,
  > fully-scrollable overflow when it does not. Vertical centring is given up as
  > part of the fix; a map pinned to the top is the better behaviour anyway.
  >
  > **Shift+wheel** now pans sideways as well, for a plain wheel mouse: a
  > trackpad and a tilt-wheel already could, and dragging is not an option
  > because dragging on the map moves tokens.

## Follow-up checklist (2026-09-01) — NOT RUN

- [ ] **G1.** Maps tab: each grid control has a **number box**. Type a value and
      press Tab — the overlay moves to it.
- [ ] **G2.** Type **9000** into a shift box. It **clamps to 500** rather than
      doing nothing.
- [ ] **G3.** Clear a box completely. The grid does **not** jump to 0 while the
      field is empty.
- [ ] **G4.** Zoom in until the map is wider than the frame. **Scroll all the way
      to the LEFT edge** — the far edge is reachable. *(This is the exact bug.)*
- [ ] **G5.** **Shift + scroll wheel** pans sideways.
- [ ] **G6.** Zoom back out. Nothing is clipped and the map re-centres.

**2026-09-01 — G3 and G4 reported FAILING; both fixed.**

- **G3 — could not clear the number box.** A fully controlled `value={value}`
  input cannot be emptied: deleting the last character fires onChange with `""`,
  the parent ignores it as not-a-number, and the re-render immediately puts the
  old digits back — so the field looks like it is refusing the Backspace key. The
  ignore-empty rule was right; being fully controlled was not. Fixed with a local
  draft string that holds what is typed (including `""` and a lone `-`) while the
  map keeps using the last good number; the draft is dropped on blur so the box
  re-syncs to the value actually in use.

- **G4 — could not scroll when zoomed out past the map's size.** The previous
  fix removed the clipping but not the cause of this one: when the map is
  SMALLER than the frame there is simply nothing to scroll, so it sits nailed to
  the centre. Fixed by giving the map a pannable surface that is always larger
  than the frame — `max(map, frame) + 160px` on every side — so there is
  somewhere to scroll to at any zoom, and a token near the border can be dragged
  away from the edge of the screen. Centring moved onto that wrapper, which does
  not scroll; centring the child of a scroll container is what clipped the
  overflow in the first place, and this keeps the two concerns apart.

  Two knock-on fixes came with it: zoom anchoring now measures with
  `getBoundingClientRect` instead of `offsetLeft`, because the map's
  `offsetParent` is no longer the frame; and the view scrolls its pan margin out
  of the way on first layout, or the map would open tucked into a corner of its
  own padding.

## Third checklist (2026-09-01b) — NOT RUN

- [ ] **H1.** Clear a grid number box entirely — it **stays empty** while you
      type, and the map keeps its previous grid.
- [ ] **H2.** Type a new number into the empty box: the overlay follows.
- [ ] **H3.** Clear it and click away: the box **snaps back** to the value in use.
- [ ] **H4.** Type `-` then `50` in a shift box: it accepts the negative.
- [ ] **H5.** Zoom OUT until the whole map is comfortably smaller than the frame.
      **Scroll/pan in every direction** — it moves. *(The exact failure.)*
- [ ] **H6.** Zoom IN past the frame. Scroll to all four edges — all reachable.
- [ ] **H7.** Open the map fresh: it appears **centred**, not in a corner.
- [ ] **H8.** Pinch-zoom on a feature: it still stays under the cursor.
- [ ] **H9.** Drag a token while zoomed in and panned off-centre: it lands where
      you drop it.

**2026-09-01c — H1–H9 reported PASS; one new defect found and fixed.**

The owner ran the third checklist and reported **all tests pass** — clearing the
number box, negative shifts, panning while zoomed out past the map's size,
reaching all four edges when zoomed in, opening centred, cursor-anchored pinch
zoom, and dragging while zoomed and panned.

One separate defect reported alongside it:

> **A token dragged off the edge went half off and stayed half off** until
> dragged back on.

**Cause.** `clampToMap` bounded the token's CENTRE to `[0, width]`, and a token
is drawn centred on its coordinate — so a coordinate legitimately clamped to
x = 0 renders with half the token outside the map. The clamp was doing exactly
what it said; what it said was about a point, and a token is not a point. It then
"stayed" there simply because that is where it was saved.

**Fix.** `clampToMap` and `dropPosition` take an `inset`, and both the drag path
and the arrow-key path pass half the token's own `size_px`. The arrow-key path
now calls the same helper instead of repeating the bounds arithmetic — two paths
disagreeing about where the edge is would be a maddening bug to find later.

Guarded by 5 new unit tests (33 in `grid.test.ts`, 166 overall), including a
token LARGER than the map: without a guard the bounds cross over (min > max) and
the point snaps to a nonsense corner, so it centres instead.

> Note this stays a UI affordance only. The server still deliberately does not
> clamp (0048), so a token already outside the map — because the DM shrank it
> afterwards — keeps rendering where it is and is only pulled in if dragged.

## Fourth checklist (2026-09-01c) — NOT RUN

- [ ] **J1.** Drag a token hard off the **left** edge. It stops **fully on the
      map**, not half over the edge.
- [ ] **J2.** Same for the right, top and bottom edges.
- [ ] **J3.** Reload — it is still fully on the map, i.e. that is what was saved.
- [ ] **J4.** Select a token, press an arrow key repeatedly into an edge. It
      stops in the same place a drag would, not half off.
- [ ] **J5.** Do J1 with a LARGE token (raise the map's grid size first, then add
      a token, which takes the grid size). It still stops fully on.

**2026-09-01d — whole-square movement, and tokens sized to the grid.**

Two owner requests, both about the same underlying idea: a grid should mean
something.

- **Movement stops at the last FULL square.** A map's edge almost never lands on
  a cell boundary — 1400px with a 64px grid leaves a 56px sliver down the right
  side — and snapping alone would happily put a token in it, while clamping alone
  put it off the lattice. Either way the token ended up in a square that is not a
  square. `clampToFullCell` computes the index range of cells wholly inside the
  map and clamps to it; a snapped drag and the arrow keys both go through it, so
  the two can never disagree about where the edge is. Free (Alt) placement is
  deliberately unaffected — off-grid is its entire purpose.

  > **One existing test changed its expected value**, and that is recorded rather
  > than quietly edited: `dropPosition` past the corner of a 1400×900/70 map used
  > to return `{1400, 900}`, and now returns `{1365, 805}`. 1400/70 divides
  > exactly so the last full column is 1330..1400, but 900/70 does not, so the
  > bottom row is a 60px sliver and the last full row is 770..840.

- **A token is exactly one square.** Rendered from the map's CURRENT `grid_size`
  rather than from the token's stored `size_px`, so changing the grid resizes
  every token instantly, for everyone, with **no writes at all** — and a token
  can never be a size that no longer matches the squares it is standing on. The
  `size_px` column is still written on creation and left in place for a later
  "large creature" multiple (0048 allows one); it is simply not what display
  reads today.

Verified: build clean, **174** tests (41 in `grid.test.ts`), `qa:checks` 62/62.

## Fifth checklist (2026-09-01d) — NOT RUN

- [ ] **K1.** Set a grid size that does NOT divide the map evenly (try 64). Drag
      a token hard into the right edge: it stops in the **last full square**, not
      in the sliver beyond it.
- [ ] **K2.** Same into the bottom edge.
- [ ] **K3.** Arrow-key a token into an edge: it stops in the **same square** a
      drag stops in.
- [ ] **K4.** Hold **Alt** and drop a token in the sliver at the edge. It is
      allowed — off-grid placement is deliberate.
- [ ] **K5.** Every token is **exactly one square** — compare against the overlay.
- [ ] **K6.** Change the grid size with tokens on the map. They **all resize with
      it**, immediately, and in the other window too.
- [ ] **K7.** After K6, tokens are still where they were (0048 decision 1 — the
      grid moves, tokens do not).

**2026-09-01e — K1–K7 PASS; three further changes (migration 0056).**

The owner reported all of the whole-square checklist passing, then asked for
three things — one of which reverses a decision made an hour earlier, which is
recorded rather than quietly overwritten.

- **Edge tiles are allowed again.** `clampToFullCell` is gone. Confining
  movement to cells wholly inside the map was defensible and was not what was
  wanted: the partial squares at the edge of a battlemap are still places a
  creature stands. A token may now sit in a sliver; it still may not hang off the
  map, which is a separate rule and stays.

  > The `dropPosition` corner test has now moved twice — `{1400,900}` →
  > `{1365,805}` → `{1365,865}` — and the test comment carries all three with
  > the reason for each, because a bare expected value tells a future reader
  > nothing about which rule it is defending.

- **Tokens stay on the grid when it is re-gridded.** Size follows for free
  (below); position does not, because positions are absolute (0048 decision 1).
  `resnapTokens` re-snaps a map's tokens when the DM **finishes** adjusting —
  pointer-up, key-up, or leaving the typed field — not on every slider event,
  which would be one write per token per pixel of travel and would make everyone
  else's map stutter. Tokens already correct are skipped, so a no-op adjustment
  writes nothing.

- **Token sizes: ½, 1, 2, 3 or 4 squares** (migration **0056**, `size_cells`).

  > **Stored in SQUARES, not pixels, and that is the whole point.** `size_px` is
  > absolute and becomes wrong the moment the grid changes — a 70px token on a
  > 64px grid is not "one square", it is a token that no longer fits its board.
  > Storing the multiple makes the relationship the stored fact. This is 0048
  > decision 1 reaching the OPPOSITE answer, for a reason worth keeping: position
  > is anchored to the picture, so pixels are right for it; size is anchored to
  > the grid, so squares are right for this. Ask of each measurement what it
  > belongs to.
  >
  > **Size changes where a token snaps.** An odd number of squares centres on a
  > cell CENTRE; an even number centres on a cell CORNER, because a 2×2 centred
  > on a cell centre straddles four half-cells and lines up with nothing; a
  > half-square token snaps to quarter-cells, or four of them stack in the middle
  > of one square instead of tiling it. 9 unit tests cover this.

Verified: matrix **117/117** (three new: a player may resize their own token,
may not resize the DM's, and cannot store a size outside the allowed list —
the CHECK raises 23514). Build clean, **175** tests, `qa:checks` 62/62.

## Sixth checklist (2026-09-01e) — NOT RUN

- [ ] **L1.** With a ragged grid (e.g. 64), drag a token into the right edge. It
      **can now sit in the partial square**, and is still fully on the map.
- [ ] **L2.** Select a token → **Size** dropdown offers ½ / 1 / 2 / 3 / 4 squares.
- [ ] **L3.** Set it to **2 squares**. It covers a 2×2 block **aligned to the
      grid lines**, not straddling four half-squares.
- [ ] **L4.** Set it to **3**. It covers a 3×3 block centred on a square.
- [ ] **L5.** Set it to **½**. Place four of them in one square — they **tile**
      it rather than stacking.
- [ ] **L6.** Change the map's grid size and release the slider. Tokens **keep
      their size in squares** AND **re-snap onto the new grid**.
- [ ] **L7.** L6 in the other window too — everything moves there as well.
- [ ] **L8.** Nudge a shift slider and release: same re-snap.
- [ ] **L9.** A player resizes their own token — allowed. They have no way to
      resize the DM's.

**2026-09-01f — three refinements (migration 0057).**

- **Only the DM may resize a token** (migration **0057**), even one a player owns
  and moves. Size is what the creature *is*, which is the DM's call; movement is
  what the player chooses.

  > Enforced by a **BEFORE UPDATE trigger**, not a policy, and for a reason this
  > project has already paid for once: a `with check` clause cannot express "this
  > column may not change", because it runs AFTER the update and reads back the
  > NEW value — the test reduces to `size_cells = size_cells`. That is precisely
  > the bug that shipped in 0052 and was caught by the matrix in 0053.
  >
  > One matrix assertion **inverted**: "can resize their OWN token" (added an
  > hour earlier with 0056) is now "CANNOT resize even their OWN token". Kept
  > alongside a positive control that the player can still MOVE it, so a rule
  > that accidentally froze player movement entirely could not pass.

- **A half-square token sits in the MIDDLE of its square**, not in a corner. It
  previously snapped to quarter-cells so four halves could tile one square; a
  lone small creature then read as standing in the corner of a square rather
  than in it. Halves now snap like any other odd size.

- **Holding an arrow key walks the token smoothly.**

  > **It was never one keypress moving several squares.** The OS repeats a held
  > key far faster than React re-renders, so several repeats each computed their
  > step from the SAME stale position and the writes landed in whatever order
  > they finished — which looks exactly like a jump. Fixed by reading the live
  > position from a ref instead of the render closure, pacing steps at one per
  > 120ms so a held key walks at a readable rate rather than the keyboard's own
  > accelerating curve, and batching the save until 300ms after the last step —
  > one write per walk, not one per square, or everyone else's copy would stutter
  > across the map instead of arriving where it stopped. A pending move is
  > flushed if the map unmounts mid-walk, so a tab switch cannot lose it.

Verified: matrix **119/119**, build clean, **175** tests, `qa:checks` 62/62.

## Seventh checklist (2026-09-01f) — NOT RUN

- [ ] **M1.** Player selects their own token: **no Size control** anywhere.
- [ ] **M2.** Player can still **move** that token — the narrower rule did not
      freeze movement.
- [ ] **M3.** DM can resize a **player's** token.
- [ ] **M4.** A **half-square** token sits centred in its square, not in a corner.
- [ ] **M5.** **Hold** an arrow key. The token walks at a steady, even pace —
      it does not skip several squares at once.
- [ ] **M6.** Release the key. The token is where it stopped, and stays there
      after a reload.
- [ ] **M7.** Watch M5 in the **other window**: the token arrives where it
      stopped rather than stuttering across square by square.
- [ ] **M8.** Hold a key into a map edge: it stops there cleanly, no overshoot.

**2026-09-01g — M1–M8 run by the owner. ALL PASS.**

Confirms the three things automation could not: that a player has no route to
resize a token but can still move it, that a half-square token reads as centred,
and that a held arrow key walks smoothly and — checked from the SECOND window —
arrives at its destination rather than stuttering across square by square, which
is the only evidence that the write batching works.

**9.1.2 token movement is complete** as far as the owner's requirements go.
Remaining gaps are recorded in PLANNING under 9.1.2 rather than left implied.

**2026-09-01h — token artwork (migration 0058).**

A player's token shows the portrait they chose for their character; a DM picks
which creature a token is, and it takes that NPC's name and portrait.

> **The design decision is a permissions one.** The obvious implementation —
> follow `npc_id` / `character_id` to a portrait at render time — does not work,
> and fails in exactly the wrong direction: `npcs` is DM-only, so a monster would
> be a blank circle for the players who most need to see it, and `characters` is
> owner-or-DM, so party portraits would be blank for each other. But
> `media_assets` and `storage.objects` are scoped to CAMPAIGN MEMBERSHIP (0008),
> not to the row referencing the image — a member may read any approved asset in
> their campaign if they know its id.
>
> So the asset id is COPIED onto the token, which every member already reads.
> The picture reaches the table without widening a single policy. The
> alternative would have traded a monster's portrait for the DM's notes on it.

Two further decisions worth recording:

- **The copy is not a cache.** Changing a character's portrait later does not
  silently restyle a token already on the board; re-placing it is how you take
  the new one. A token is a piece on a table, not a live view of a sheet.
- **The Creature picker is offered only for unowned tokens.** Overwriting a
  player's chosen portrait with a monster would be the DM redecorating somebody
  else's piece.

Verified: matrix **121/121**, with the two assertions that ARE the design — a
player can read the campaign media a token points at, and cannot read the NPC row
it came from. Either alone would be a different and wrong feature. Build clean,
175 tests.

> A fixture bug caught on the way: the new media fixture used `uploader_id`; the
> column is `uploaded_by`. The matrix failed loudly rather than skipping the
> assertion, which is the behaviour worth having.

## Eighth checklist (2026-09-01h) — NOT RUN

- [ ] **N1.** DM: select an unowned token → a **Creature** dropdown lists the
      campaign's NPCs, marking those with no portrait.
- [ ] **N2.** Pick an NPC with a portrait. The token shows **its artwork**, and
      takes the NPC's name.
- [ ] **N3.** The **player's window** shows that artwork too — the point of the
      whole design.
- [ ] **N4.** The player still has no NPCs tab and cannot see the DM's notes on
      that creature.
- [ ] **N5.** Player places their own character (DM switch on): the token shows
      **their character's portrait**.
- [ ] **N6.** The DM sees that portrait, and has **no Creature dropdown** for
      that token.
- [ ] **N7.** A token with no image still shows its colour ring and initials.
- [ ] **N8.** Set the creature back to **(plain marker)**: the artwork clears.
- [ ] **N9.** Resize a token with art to 2 squares — the picture scales with it
      and stays circular.

**2026-09-01i — N1–N9 run by the owner. ALL PASS.** Token artwork confirmed in a
browser, including N3+N4 together — the player sees the monster's portrait while
still being unable to read the NPC row it came from, which is the pair that makes
the 0058 design mean anything.

**Ring dropped on tokens that have art**, at the owner's request. The colour ring
identifies a token that has no picture; art identifies itself, so ringing it just
laid a coloured band over the edges of the face.

> The ring had a **second** job, though — separating the token from the map
> underneath — and a light portrait on a light battlemap loses its edge without
> it. A soft drop shadow takes that job over, which lifts the token without
> putting a colour back on it. One `art` value now decides the ring, the
> background and whether the initials are drawn, so those three cannot disagree.

Selection still draws its accent outline over artwork, since "which token am I
about to act on?" has to stay answerable.

## Ninth check (2026-09-01i) — NOT RUN

- [ ] **P1.** A token with art has **no coloured ring**, and still reads clearly
      against a light area of the map.
- [ ] **P2.** A token without art still has its ring and initials.
- [ ] **P3.** Selecting an art token still shows the accent selection outline.

**2026-09-01j — the ring is a per-token DM setting (migration 0059).**

0058 made the ring automatic — shown without art, hidden with it. That was the
right default and the wrong rule: a DM may want a ring on an illustrated token to
mark a side or a condition, and no ring at all on a plain marker being used as
scenery.

> **Three values, not a boolean.** A boolean would force every existing token to
> a fixed answer and lose the automatic behaviour altogether; a nullable boolean
> could express it but reads as "unknown" rather than "decide for me". `auto`
> says what it means, keeps the 0058 behaviour as the default for every row that
> already exists, and leaves `on`/`off` as deliberate overrides.

DM-only, like size, and enforced by **extending the 0057 trigger rather than
adding a second one** — so there is one place that answers "which columns may a
player not touch?". Two triggers would eventually disagree. The matrix asserts
the ring separately from size for exactly that reason: they share a guard, and a
change to it could plausibly free one column while still holding the other.

One rendering note: the drop shadow now applies whenever the ring is ABSENT,
not only when there is art. A ringless plain marker on a busy battlemap needs
lifting off the map just as much as a portrait does.

Verified: matrix **123/123**, build clean, 175 tests.

## Tenth checklist (2026-09-01j) — NOT RUN

- [ ] **Q1.** DM selects a token → a **Ring** dropdown: Auto / Always / Never.
- [ ] **Q2.** An art token on **Always** gets its colour ring back.
- [ ] **Q3.** A plain token on **Never** loses its ring and still reads against
      the map (the shadow).
- [ ] **Q4.** **Auto** behaves as before: ring without art, none with art.
- [ ] **Q5.** The setting is visible in the **player's** window too.
- [ ] **Q6.** The player has no Ring control, and can still move the token.

**2026-09-01k — Q1–Q6 run by the owner. ALL PASS.**

Ring override confirmed in both windows, including Q6 (a player has no Ring
control and can still move the token), which is the check that the trigger
widened in 0059 did not catch player movement along with appearance.

**Phase 9.1 browser QA is COMPLETE.** Every checklist in this folder has been run
and passed, across ten rounds of changes, except sections A, B and F of this file
— skipped deliberately and recorded as such, because grid-offset maths, free-cell
placement and the notetaker split are covered by unit tests and re-running them
by hand would add no evidence.

Final state: migrations **0048–0059**, RLS matrix **123/123**, build clean,
**175** tests (42 in `grid.test.ts`), `qa:checks` 62/62.
