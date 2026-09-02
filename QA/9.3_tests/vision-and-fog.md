# QA — line of sight & fog (Phase 9.3)

**Manual, in-browser. The user runs these.** What is already proven without a
browser is not repeated:

| Already verified | How |
|---|---|
| Sight is DM-set: a player cannot widen their own | RLS matrix **136/136** |
| Walls block sight, both directions, round corners, closed rooms | 25 unit tests in `vision.test.ts` |
| Range limits sight; blind = 0; null = unlimited | same |
| No NaN vertices on a corner / zero-length wall | same — a NaN vertex fails OPEN, showing the whole map |
| The deployed maths IS the tested maths | `geometryBundle.test.ts` — proven by tampering with the copy |
| Anonymous callers refused | live `curl` → 401 |

**Prerequisites:** DM window + player window (second profile). A playspace/rpg
campaign, a map, a wall or two, and a token **owned by that player** on the map.

## A. Vision off (the default)

- [ ] **A1.** With **"Limit what players can see"** unticked, the player sees the
      whole map, no fog. *(Unchanged behaviour — this is the regression check.)*

## B. Vision on

- [ ] **B1.** DM ticks the box. The **player's** map darkens, with a lit area
      around their token.
- [ ] **B2.** The **DM's** own view is unchanged — no fog for the DM, ever.
- [ ] **B3.** The player's lit area **stops at walls.** Stand them beside a wall:
      the far side is dark.
- [ ] **B4.** The dark area **hides tokens**, not just the floor. Put a DM
      monster behind a wall — the player must not see it at all.
- [ ] **B5.** The player drags their token. The lit area follows within a second
      or so.
- [ ] **B6.** Walk the token round a corner: what was hidden becomes visible.

## C. Sight range

- [ ] **C1.** DM selects the player's token → a **Sight** box (blank = ∞).
- [ ] **C2.** Set it to **6**. The player's lit area becomes a circle about six
      squares across, even with no walls nearby.
- [ ] **C3.** Set it to **0**. The player sees nothing at all.
- [ ] **C4.** Clear it. Back to walls-only.
- [ ] **C5.** The **player** has no way to change it.

## D. Two players

- [ ] **D1.** With two player accounts, each sees from **their own** token, not
      the other's.
- [ ] **D2.** One player moving does not open fog for the other.

## E. The leak check — NOT a manual step, deliberately

The original draft of this file asked the user to open DevTools and inspect the
`vision` response for wall coordinates. **That was wrong**, and it broke this
project's own rule: never hand the user a console or devtools step, because a
checklist they will not run is not coverage — it is a permanently open file.

It is also unnecessary, which is the better reason. The claim "a player never
receives wall geometry" is proved server-side and permanently:

- `walls/player: receives NO wall geometry at all (0061)` in the RLS matrix
  asserts a player's own credentials return **zero** wall rows. Any request the
  client could make — intended or not — is subject to that same policy.
- 0061 additionally asserts `playspace_walls` has exactly ONE select policy and
  that it does not mention `is_campaign_member`, so a future migration cannot
  quietly restore the read.
- `geometryBundle.test.ts` asserts the deployed function is the tested code.

A network-tab check would confirm one response on one afternoon. The matrix
confirms every response, on every deploy, forever.

## Pass criteria

All of B, plus C2 and C3. **B4 is the one that matters most** — fog that hides
the floor but not the monsters standing on it is worse than no fog, because it
looks like it works.

## Known gaps, stated rather than hidden

- **Fog is not persistent "explored" memory.** Walk away and an area is dark
  again. Remembered fog-of-war is not built.
- **Darkness and light are 9.4.** `dark_sight_squares` is stored and unused.
- **One round trip per token move** (debounced 250ms). On a slow link the fog
  lags the token slightly. Deliberate: the walls cannot come to the client.
- **A player with no token on the map sees nothing**, by design — it fails
  closed.

## Run log

**2026-09-01 — automated + server-side PASS; browser steps NOT RUN.**
Migration 0062; matrix **136/136**; **266** tests (25 vision, 3 bundle-drift);
build clean; `vision` deployed and returning 401 to anonymous callers.
Sections A–E are the user's and are unrun.

---

**2026-09-01 — owner-run QA found two problems. Both fixed.**

> **"You are able to see things through the walls that you shouldn't be able to."**

**Cause: my own design choice.** The fog was drawn at 92% opacity, so a player
could "just make out the shape of the map they are in" — which felt right and
was wrong. 8% of a bright token portrait or a coloured ring is perfectly
readable against dark, so every monster behind a wall showed through as a faint
disc.

**Partial fog does not hide things partially.** It hides the FLOOR partially and
gives away everything standing on it, because the things that matter are the
high-contrast ones. Two fixes, because opacity alone was not enough:

1. The fog is now **fully opaque**.
2. **Tokens outside the visible area are not rendered at all.** Opaque fog hides
   a token visually, but it was still in the DOM — findable by anyone who looks,
   and briefly visible during a re-render before the fog paints. Your own tokens
   are always drawn regardless, because a token with sight 0 has a polygon that
   does not contain its own centre, and losing your own piece is disorienting.

> **Honest limit, recorded rather than implied:** token ROWS are still
> member-readable, so a determined player can read positions out of the data
> layer. Unlike walls (0061), tokens cannot simply be withheld — every client
> needs them to render anything. Closing that means filtering tokens per player
> server-side, which is a real piece of work and is not this one. What these
> fixes make honest is the FOG.

> **"Walls should not be able to be moved through."**

Built as migrations **0063** + **0064**. It had to be server-side, and that is
0061's choice paying off a second time: a player's browser has no walls, so it
cannot refuse a move it cannot see the reason for — and a rule in the database
also binds a crafted request, not just the app.

Rules: players only (the DM stages what is behind their own walls); only where
the map has vision enabled (a campaign using walls as scenery keeps the movement
it always had); the path is the straight line from where the token was to where
it is going.

> **The matrix caught an exploit on its first run, in the test case itself.**
> 0063 defined crossing as a PROPER intersection, which correctly allows sliding
> along a wall — and incorrectly allows a move that ENDS on one. That gives a
> two-step crossing: land exactly on the wall, then step off the far side, both
> legal. My first assertion happened to put its destination exactly on the wall
> and reported ALLOWED. The badly-written test case was a working exploit. 0064
> refuses a move that ends on a wall; the START is deliberately still unchecked,
> because a DM can draw a wall across a token that is already standing there and
> blocking that would trap it forever.

> **A second self-inflicted problem, worth recording.** While restructuring these
> assertions I spliced out the 0057/0059/0062 player-side denials — and the
> matrix still reported "all assertions passed", because assertions that no
> longer exist cannot fail. The only signal was the total dropping from 139 to
> 128. That is why the assertion count is quoted in PLANNING on every change, and
> why it is worth reading.

Verified after both fixes: matrix **134/134**, build clean, 266 tests.

**2026-09-01 (later) — four owner requests, all built.**

1. **Fog density is the DM's choice** (migration **0065**, 0.3–1.0, default
   opaque). Safe to lower ONLY because of (2): it now governs the TERRAIN alone.
   Floor of 0.3 rather than 0, because "vision on, no fog" is what the vision
   toggle already means and two controls saying the same thing is how a table
   ends up arguing about which one is on.

2. **A token is shown only if it is in line of sight, and only the part that
   is.** Two mechanisms, because one is not enough:
   - a token with NO part in the lit area is not rendered at all (it would
     otherwise sit in the DOM under opaque fog, findable, and flash during a
     re-render before the fog paints);
   - a token that is PARTLY lit is drawn and clipped to the visible area, so a
     creature edging past a corner shows exactly as much of itself as the party
     can see.

   The clip is an SVG `clipPath` in objectBoundingBox units, so it survives zoom
   with no recomputation — and a clipPath UNIONS its children, which is how a
   player with two tokens gets both lit areas for free. That is the second place
   this project gets a union without writing polygon boolean maths.

   The visibility test samples the token's rim as well as its centre: a creature
   standing half-past a corner has its CENTRE in shadow, and testing the centre
   alone made it vanish entirely — which both looks broken and hides someone the
   party can genuinely see.

3. **A blocked move is now refused, not reverted.** The token stops against the
   wall instead of passing through and springing back.

   > This needed something new, because the client has no walls to check
   > against. The `vision` function now also returns **`movePolygons`** — the
   > same sweep with the sight range removed. A straight line inside a visibility
   > polygon provably crosses no wall, which is exactly the movement rule, so the
   > client can stop a drag at a wall without ever being told where the wall is.
   > Separate from the sight polygon because a blind token must still be able to
   > WALK; clamping movement to sight would freeze it.
   >
   > **Honest trade:** `movePolygons` reveals the shape of the space the token
   > stands in — slightly more than a short-sighted token can see. Bounded by the
   > same walls, and learnable by walking into them, but more than zero.
   >
   > The database trigger (0063/0064) is still the rule; this only means it
   > rarely has to fire. The revert path remains for when the two disagree.

4. **Line and Room snap to grid INTERSECTIONS** (corners, not cell centres — a
   wall runs along the edges of squares, a token stands in one). On by default,
   a checkbox while a drawing tool is armed, and <kbd>Alt</kbd> overrides —
   the same modifier token placement uses, so there is one "exactly where I say"
   key in the whole app. Freehand never snaps: a stroke dragged through the
   lattice would collapse into a staircase.

Verified: matrix **134/134**, **277** tests, build clean, `vision` redeployed.
