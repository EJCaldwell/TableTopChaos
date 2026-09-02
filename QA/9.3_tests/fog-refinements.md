# QA — fog refinements & token art fix (Phase 9.3, second pass)

**Manual, in-browser. The user runs these.** Covers only what changed after the
first fog run. Everything already proved without a browser is not repeated:

| Already verified | How |
|---|---|
| Walls block sight both ways, round corners, in closed rooms | 25 tests in `vision.test.ts` |
| A partly-lit token counts as visible (rim sampled, not just centre) | 6 tests, same file |
| Wall endpoints snap to intersections, not cell centres | 5 tests in `walls.test.ts` |
| The token style never emits the `background` shorthand | 5 tests in `tokenStyle.test.ts` |
| Movement: through a wall refused, onto a wall refused, elsewhere allowed, DM exempt, vision-off unaffected | RLS matrix **134/134** |
| Players still receive no wall geometry | matrix, same run |
| Deployed vision maths = tested maths | `geometryBundle.test.ts` |

**Prerequisites:** DM window + player window (second profile). A playspace/rpg
campaign with a map, **at least one wall**, a DM token **with a portrait**, and a
player token owned by the player's account.

## A. Token artwork (the regression)

Do this FIRST, with **vision off**, so a fog bug cannot be mistaken for an art
bug.

- [ ] **A1.** DM window: a token with a creature portrait shows **the picture**,
      not a coloured circle with initials.
- [ ] **A2.** Player window: the **same** token shows the picture too.
- [ ] **A3.** A token with no portrait still shows its ring and initials.

> If A1 fails, stop — the art fix did not work and nothing below is meaningful.

## B. Fog density (0065)

- [ ] **B1.** DM ticks **"Limit what players can see"**. A **Fog** slider appears
      (30–100%), starting at 100.
- [ ] **B2.** Player's unseen area is **solid** at 100%.
- [ ] **B3.** DM drags Fog to ~50%. The player can now make out the **terrain**
      they cannot see — the map image and grid.
- [ ] **B4.** **At 50%, a token behind a wall is still completely invisible.**
      Not faint. Not a disc. Nothing.
- [ ] **B5.** Reload: the fog setting survived.

## C. Partial visibility

- [ ] **C1.** Move a DM token so it is **half behind** a wall corner, with part
      in the player's line of sight.
- [ ] **C2.** The player sees **only the visible part** of it — a crescent, cut
      along the sight line, not the whole token and not nothing.
- [ ] **C3.** Move it fully behind the wall: it disappears entirely.
- [ ] **C4.** Move it fully into the open: the whole token is back.

## D. Moving into walls

- [ ] **D1.** Player drags their token towards a wall. It **stops against the
      wall** — it does not pass through and spring back.
- [ ] **D2.** The player can still move freely everywhere a wall is not in the
      way.
- [ ] **D3.** Arrow-key the token into a wall: it stops, no rebound.
- [ ] **D4.** **DM** drags a token through the same wall: allowed (they stage
      what is behind their own walls).
- [ ] **D5.** DM unticks vision, player drags across the wall: **allowed** — a
      campaign using walls as scenery keeps the movement it always had.

## E. Grid-snapped walls

- [ ] **E1.** Arm **Line**. A **"Snap to grid"** checkbox appears, ticked.
- [ ] **E2.** Draw a line: both ends land on grid **intersections** (corners),
      not in the middle of squares.
- [ ] **E3.** Draw a **Room**: its corners sit on intersections and its edges run
      along grid lines.
- [ ] **E4.** Hold **Alt** while drawing: it lands exactly where you release.
- [ ] **E5.** **Freehand** is unaffected — it follows the pointer, never snapped.
- [ ] **E6.** Shift the grid (Maps tab → Shift →), then draw: walls snap to the
      **shifted** lines, not the original ones.

## Pass criteria

**A1, A2, B4, C2 and D1.** In order of how badly each failing would matter:

- **B4** — if a token shows through translucent fog, the fog-density setting has
  reintroduced exactly the leak it was built around, and must go back to opaque.
- **C2** — partial visibility is the feature; whole-or-nothing means the clip is
  not applying.
- **A2** — the art fix, on the view that reported it.
- **D1** — a stop rather than a rebound.

## Known gaps, stated rather than hidden

- **Token positions are still readable in the data layer.** The fog hides them
  visually and out-of-sight tokens are not rendered, but token rows remain
  member-readable — unlike walls, which are withheld entirely (0061). Closing
  this means filtering tokens per player server-side; it is not built.
- **`movePolygons` reveals the shape of the space a token stands in**, which is
  slightly more than a short-sighted token can see. Bounded by the same walls,
  and learnable by walking into them.
- **No explored-area memory.** Walk away and it is dark again.
- **Darkness and light are 9.4.** `dark_sight_squares` is stored and unused.

## Run log

**2026-09-01 — automated PASS; browser steps NOT RUN.** Migration 0065; matrix
**134/134**; **282** tests; build clean; `vision` redeployed with `movePolygons`.
Sections A–E are the user's and are unrun.

---

**2026-09-01 — sections A–E run by the owner. ALL PASS.**

Confirms the four things automation could not: token artwork is back in both
views, a token behind a wall stays completely invisible even at 50% fog, a
half-seen creature shows only its visible part, and a blocked move stops rather
than rebounding.

**2026-09-02 — diagonal movement added** (owner: "we should be able to move
characters diagonally").

Keyboard movement was orthogonal only. A battlemap has eight directions and a
keyboard has four arrows, so this is a lookup table rather than another arm on a
chain of key comparisons — `movementDelta`, with 7 unit tests.

Three input sets, because one is not enough:
- **arrows** — the four orthogonals, unchanged;
- **numpad 1–9** — the roguelike/VTT convention, and the only layout where the
  keys are physically arranged like the directions they mean (5 is a deliberate
  no-op: it is the centre of the pad, and consuming it stops the key falling
  through to the browser);
- **Home / PageUp / End / PageDown** — the diagonals for the many laptops with
  no numpad. Without these, diagonal movement would be unavailable to most
  people using the app, which is not a feature.

> Numpad keys are read from `event.code` (`Numpad7`), never `event.key`, because
> `key` is '7' or 'Home' depending on NumLock — the same physical key meaning two
> different things is precisely what `code` exists to avoid. A test asserts both
> paths give the same direction, so a lock light cannot change how a token moves.

Diagonal moves go through the same snapping, the same wall check and the same
batched save as orthogonal ones — nothing new to verify there.

**2026-09-02 (later) — TWO-ARROW diagonals**, after the owner pointed out they
could not test the numpad or Home/PgUp cluster at all: *"I am unable to test the
ones that require a full size keyboard."*

That is the more important input anyway. Holding Left and Up is what everyone
already knows from games, and it needs no keys beyond the four arrows every
keyboard has — the numpad path was a convention borrowed from tools whose users
have desktop keyboards.

`combinedDelta` sums every held movement key and CLAMPS to one cell per axis:
three keys on one axis must not become a three-square leap, and opposite keys
cancelling to nothing is correct rather than a bug — holding Left and Right means
no horizontal intent, exactly as in any game. 8 unit tests.

> **The bug this shape avoids.** Held keys are tracked in a map keyed by
> `event.code`, and cleared on both the token's blur and the window's. A token
> that loses focus mid-press never receives its keyup — so without that, the key
> stays "held" forever and every later press moves diagonally, which is a
> baffling state to be stuck in and impossible to guess the cause of.

**2026-09-02 (later still) — the grace window.** Holding two arrows worked, but
pressing them a moment apart produced *"left, then up-left"*: nobody presses two
keys on the same millisecond, and the first press was being acted on alone.

The first step of a fresh press now waits **70ms** for a second key. Only the
first — repeats and keys added to an already-moving token step immediately, so
holding a direction still walks at full cadence and the delay is paid once per
press, not once per square. 70ms is under the 120ms step cadence, so it costs
nothing while walking.

> **The bug this could easily have introduced.** A tap SHORTER than 70ms would
> release its key before the pending step fired; the timer would then find the
> held map empty and swallow the press entirely. So a keyup with a step still
> pending takes that step immediately, while the key is still in the map — a
> silently-dropped keypress would be a worse bug than the stray step this fixed.

## Follow-up checklist (2026-09-02) — NOT RUN

- [ ] **F1.** Click a token you own. **Hold Left and Up together** — it moves
      diagonally up-left, one square each way.
- [ ] **F1b.** Press them a fraction apart, as you naturally would: **one
      diagonal step**, not a sideways step followed by a diagonal one.
- [ ] **F1c.** **Tap a single arrow as fast as you can.** It still moves one
      square — the press is not swallowed.
- [ ] **F2.** All four diagonal pairs work.
- [ ] **F3.** Arrows alone still move orthogonally.
- [ ] **F4.** Holding **Left and Right together** moves nothing horizontally.
- [ ] **F5.** A diagonal move into a wall **stops**, like an orthogonal one.
- [ ] **F6.** Hold a diagonal pair: it walks smoothly, and the page does not
      scroll underneath it.
- [ ] **F7.** Press a diagonal pair, then **click away and back**, then press a
      single arrow — it moves **orthogonally**, not diagonally. *(The stuck-key
      case.)*
- [ ] **F8.** The move persists after a reload.
- [ ] **F9.** *(Only if you have a numpad.)* Numpad 7/9/1/3 still work.

**2026-09-02 — F1–F9 run by the owner. ALL PASS.**

Including the two that pull against each other: **F1b** (keys pressed a fraction
apart give ONE diagonal step) and **F1c** (a very fast tap is not swallowed by
the pending timer). Fixing either of those by breaking the other would have been
easy and invisible.

**Phase 9.3 browser QA is COMPLETE.** With it, the last of Phase 9.2 closes too:
the vision toggle's visible half only existed once fog did, which is why 9.2.3's
section C was deferred rather than passed.

---

**2026-09-02 — two more owner requests.**

**1. The fog keeps up with your own moves.** Recomputes caused by THIS session
now wait 60ms instead of 250ms. Somebody else's move still uses 250ms: the fog
opening is part of the move you just made, and a quarter-second lag reads as the
app being slow to follow your own hand — nobody has that expectation of another
player's turn, and their moves arrive in bursts worth collapsing. 60ms still
collapses a held arrow key's run of steps into one request, which is the whole
reason the debounce exists.

**2. Walls the players can see** (migration **0066**), opt-in per wall.

> **This is a deliberate hole in 0061, and the shape of it is the point.** The
> default stays FALSE, so a DM who never touches the setting keeps exactly the
> privacy 0061 gave them, and the only walls that reach a player are the ones
> they chose to show. Not every wall is a secret — the edge of a chasm, a
> portcullis, the side of a building are all scenery the party can already see
> in the picture the wall is drawn on, and hiding those makes the map harder to
> read for no benefit.
>
> 0061 asserted that `playspace_walls` had exactly ONE select policy and that it
> did not mention `is_campaign_member`, precisely so a later change could not
> silently restore the member read. This IS that later change — so the assertion
> was **updated, not deleted**: two policies now, and any member-facing one must
> be gated on `visible_to_players`. A third still fails the deploy.

Visible walls are drawn differently **on the DM's side too** — muted and thicker,
against red for secret ones. A DM needs to know at a glance which of their walls
the party can see.

> **A process failure worth recording, because it is the second instance.** The
> careless splice noted above deleted MORE than I first found: as well as the
> appearance assertions, it removed all four wall read/write ones, and the matrix
> reported "all assertions passed" both times. Assertions that no longer exist
> cannot fail. The only signal is the total — 141 now — which is why it is quoted
> in PLANNING on every change, and why a count that goes DOWN deserves more
> suspicion than a test that goes red.

Verified: matrix **141/141**, **297** tests, build clean.

## Follow-up checklist (2026-09-02c) — NOT RUN

- [ ] **G1.** Player moves their token: the fog follows **immediately**, not
      after a visible pause.
- [ ] **G2.** DM moves a monster: the player's fog still updates, slightly
      later, without stutter.
- [ ] **G3.** Hold an arrow to walk several squares: the fog updates once at the
      end, not once per square.
- [ ] **G4.** DM arms **Line** → a **"Players can see this wall"** checkbox
      appears, **ticked** (changed 2026-09-02 — see below).
- [ ] **G5.** Draw a wall with it TICKED. On the DM's map it is muted/thicker;
      on the **player's** map it is **visible**.
- [ ] **G6.** Draw one with it UNTICKED. Red for the DM, **invisible** to the
      player.
- [ ] **G7.** Both walls still block sight and movement for the player.
- [ ] **G8.** The player cannot erase or move the visible wall.
- [ ] **G9.** A visible wall inside a fogged area is **still drawn** — the fog
      covers the floor and the tokens, but not the wall.

      > **This step inverted on 2026-09-02**, at the owner's request ("you can
      > see walls constantly"), and the earlier version was the wrong model. A
      > wall a player can see is scenery they KNOW about — a chasm edge, the side
      > of a building — and you do not forget a cliff is there because you walked
      > away from it. Letting the fog erase it made known terrain behave like a
      > secret. Nothing new is revealed: a player only ever receives walls the DM
      > marked visible (0066), so a secret wall cannot appear here whatever the
      > layering.

**2026-09-02 — stacking order, written down because it has been wrong twice.**

    grid → tokens → FOG → walls

Each mistake looked like a completely different bug. Fog under the tokens showed
every enemy through it — read as "fog is broken". Walls under the fog made
visible landmarks vanish — read as "the wall setting does not work". Both were
one line of document order. The order is now stated in the component so the next
change to it is a decision rather than an accident.

**2026-09-02 — the visible-wall control now defaults to ON.**

Note that this is the OPPOSITE of the column's default, and both are correct
where they sit:

- **the column** defaults to false, so anything written without an explicit
  choice — an import, a script, a future feature — is secret. That is the safe
  default for data, and 0066's own assertion depends on it;
- **the control** defaults to true, because most walls a DM draws are the
  outline of the room the party is standing in. Making the common case require a
  tick meant either ticking it every time or accidentally hiding scenery the
  players can see in the picture anyway.

The consequence, stated rather than glossed: a DM who never looks at this will
draw walls their players can see. That is the right way round — a visible wall is
at worst redundant with the map image, whereas an accidentally hidden one is a
landmark that silently vanishes for the party.

**2026-09-02 — how fast can the fog update, and what was actually slow.**

Asked directly, so measured rather than guessed.

**The floor is two sequential round trips**, and it cannot be reduced to one: the
move must be WRITTEN before vision is recomputed, because the server computes
from the stored position. Sending both at once would race, and trusting a
client-supplied position would let anyone claim to be anywhere. So the work was
making each trip cheap, not overlapping them.

Three things were making it slower than that floor:

1. **The function's own queries were going out to the public internet.**
   `SUPABASE_URL` on the functions service holds the PUBLIC gateway hostname, so
   every query the vision function made left Railway, came back in through the
   edge, and only then reached the gateway — from a container sitting a few
   milliseconds from the database on the internal network. Now
   `SUPABASE_INTERNAL_URL=http://gateway.railway.internal:8000`, used by
   `serviceClient`/`userClient` with a fallback to the public URL. This helps
   every Edge Function, not just this one.

2. **Four sequential queries.** Map + `getUser` now run together, and tokens +
   walls together — neither pair depends on the other. Two round trips instead of
   four.

3. **A 60ms debounce that earned nothing.** A drag or a held-key walk already
   produces exactly one write, and the recompute runs after it resolves, so the
   delay was added to a request that was going to be made once anyway. Now 0 —
   still deferred a tick, so same-tick bursts collapse, but nothing is waited for.

**Cold starts are the remaining variable, and they are the big one.** Measured
from outside: ~**100ms** warm, ~**500ms–1.1s** cold. That cost lands precisely on
the first move after a lull, which at a table is the start of somebody's turn.
So a player on a fogged map now sends a slow heartbeat (60s) that doubles as a
correctness backstop if a realtime event is ever missed.

> **Measurement caveat, stated rather than glossed:** these timings are from a
> developer machine to Railway and include that latency. They are useful for
> comparing warm against cold, not as an absolute figure for a player.

> **A process note.** Setting the own-move delay to 0 silently did nothing the
> first time — the edit's anchor no longer matched after an earlier reword, and
> the constant stayed at 60 while the build passed. That is the third silent
> no-op edit in this phase. The value is now verified by reading it back, which
> is the only thing that actually establishes a change happened.

## Follow-up checklist (2026-09-02d) — NOT RUN

- [ ] **H1.** Player moves their token: the fog follows **immediately**.
- [ ] **H2.** Leave the map idle a few minutes, then move: the first move is
      still quick (the heartbeat has kept the function warm).
- [ ] **H3.** Everything else about fog, walls and movement is unchanged.

**2026-09-02 — G/H steps run by the owner. ALL PASS.** Then two more requests.

**1. "The DM can move things anywhere, including through walls."** — **Already
true; no change made.** Recorded rather than quietly skipped, because "I built
that" and "that already worked" are different facts:

- server side, the 0063 trigger exempts a campaign DM outright, and the matrix
  asserts it (`walls/DM: CAN move through their own wall`);
- client side, the drag clamp only applies when `movePolys` exists, and that is
  null for a DM — the vision function returns `isDm: true` and no polygons at
  all, so there is nothing to clamp against.

> **One edge worth knowing:** in the dev "view as player" mode (9.1a) the DM
> keeps DM privileges, because the SERVER still sees a DM. That mode shows what
> a player's UI renders, not what a player may do — as its banner has always
> said. It does not simulate movement restrictions or fog.

**2. "Only see walls that are in your line of sight."** Visible walls are now
clipped to the viewer's visible area.

> With the previous change this sounds contradictory and is not:
>
>     "you can see walls constantly"    -> above the fog, not under it
>     "only see walls in line of sight" -> clipped to the lit area
>
> Together: a wall is not a secret you forget, but you only see the stretch of it
> you can actually look at. Walking along a cliff edge reveals it as you go,
> rather than the whole outline appearing the moment one corner is lit. Under the
> fog it vanished behind you — the first wrong model. Unclipped it drew a wall's
> full extent from one glimpse — the second.

The clip reuses the SAME path the tokens use, so a wall and the creature standing
against it can never disagree about where the light stops. A DM is never clipped:
they are drawing these, and half a wall is not much use to draw with.

## Follow-up checklist (2026-09-02e) — NOT RUN

- [ ] **J1.** Player near a long visible wall sees **only the part in view**, not
      its whole length.
- [ ] **J2.** Walking along it reveals more of it, and the part behind them
      **stays** drawn only where still in sight.
- [ ] **J3.** A visible wall entirely out of sight is not drawn at all.
- [ ] **J4.** The wall's visible edge lines up with the fog edge and with where
      tokens stop being drawn — one clip, no seams.
- [ ] **J5.** DM view: whole walls, unclipped, still drawable and erasable.

**2026-09-02 — the DM can inspect any token's line of sight.**

Select a token and its sight is drawn over the map: a faint accent fill with a
dashed edge, so the shape reads at a glance AND the exact boundary is legible —
a fill alone is ambiguous about where sight stops, which is the entire question
being asked.

> **Computed in the browser, and this is the one place in the feature that can
> be.** A DM already holds every wall (RLS gives them the lot), so the same
> `visibilityPolygon` the Edge Function runs works here with no round trip and no
> new endpoint. Migration 0061 forced the server-side path for PLAYERS, whose
> clients have no walls — it never applied to the DM, and pretending otherwise
> would have meant a slower feature for nothing.

Deliberately an INSPECTION overlay, not fog: it lights up what the token sees
rather than darkening what it does not. Fogging the DM's own view would hide the
rest of the board, which is the thing they are usually looking at.

Drawn UNDER the walls, so the wall that blocks the sight stays legible on top of
the shape it is cutting — that pairing is the point of looking at all.

## Checklist (2026-09-02f) — NOT RUN

### A. Line-of-sight inspection (DM window)

- [ ] **A1.** Select a token → a **"Show its line of sight"** checkbox appears,
      ticked, and a shaded region with a dashed edge appears on the map.
- [ ] **A2.** The region **stops at walls** — put the token beside one and the
      far side is not shaded.
- [ ] **A3.** It reaches round the END of a partial wall.
- [ ] **A4.** Drag the token: the region **follows as you drag**, not after.
- [ ] **A5.** Set that token's **Sight** to 6 → the region becomes a circle about
      six squares across. Clear it → back to walls-only.
- [ ] **A6.** Deselect (click the map background) → the region disappears.
- [ ] **A7.** Untick the checkbox → gone; tick → back.
- [ ] **A8.** It appears for an **NPC/monster** token, not only a player's.
- [ ] **A9.** The token can still be **dragged** while its region is showing —
      the overlay does not swallow the pointer.
- [ ] **A10.** Walls stay drawn **on top of** the shaded region.

### B. Walls clipped to line of sight (player window) — WITHDRAWN 2026-09-02k

> B1–B4 test clipping that was later removed; B3 now asserts the opposite of
> G1. B5 survives as G5. See the consolidated checklist at the end.

- [ ] **B1.** Near a long visible wall, the player sees **only the part in
      view**, not its whole length.
- [ ] **B2.** Walking along it reveals more; it does not appear all at once.
- [ ] **B3.** A visible wall entirely out of sight is **not drawn**.
- [ ] **B4.** The wall's visible edge lines up with the fog edge and with where
      tokens stop being drawn — one clip, no seams.
- [ ] **B5.** DM view: whole walls, unclipped, still drawable and erasable.

### C. Nothing else moved

- [ ] **C1.** Player fog still follows their own move immediately.
- [ ] **C2.** Player still cannot drag through a wall; **DM still can**.
- [ ] **C3.** A hidden wall is still invisible to the player.

## Pass criteria

**A2, A4, B1 and B4.** A2 is the feature being correct at all; A4 is what makes
it usable while staging an encounter rather than a static readout. B1 is the new
clipping; **B4 is the one that would betray a subtle error** — three different
things (fog, tokens, walls) share one clip path, and a seam between them means
they have drifted apart.

## Known gaps

- The sight preview shows ONE token at a time — the selected one. Comparing two
  creatures' sight means selecting each in turn.
- It uses the same sight rules as a player's fog, so it does not yet account for
  light or darkness. That is 9.4, and `dark_sight_squares` is still unused.

**2026-09-02 — a bug I had just introduced, and sight-only walls.**

> **"I cannot interact with any player tokens as a DM."**

Caused by the wall-clipping wrapper added an hour earlier. It covers the whole
map and sits ABOVE the tokens, and I gave its inner element
`pointer-events: auto` so the DM's drawing surface would still work — which made
it swallow every click meant for a token.

The fix is one property: the wrapper is `pointer-events: none`, and WallLayer
sets `auto` on ITSELF while a tool is armed. A child may opt back in even when
its parent has opted out, so the drawing surface works and nothing else is
blocked. The intermediate div is gone entirely.

> Worth noting how it presented: not as "walls are broken" but as "I can't select
> tokens" — a layer you cannot see, breaking something two layers below it.

> **"A fog wall without a wall that stops players."**

Migration **0067**: `blocks_movement`, default true. Unticking it makes a
sight-only obstruction — a curtain, a hedge, a bank of fog. Sight is always
blocked, because that is what a wall IS here; only the barrier is optional.

A column rather than a new `kind`, because `kind` records which TOOL drew the
wall and nothing reads it for behaviour. And because the pair wants to be two
independent booleans anyway: the mirror case — a chasm or railing you can see
over but not cross — is the other combination, and is left for when it is asked
for rather than guessed at now.

Sight-only walls draw **dashed** for the DM. Two independent properties, two
independent cues: colour says who can see it, dashes say whether it stops anyone.

> **The matrix's fixture ordering bit for the second time.** Restoring the token
> position AFTER re-arming the wall makes the setup UPDATE cross a live wall —
> and the owner role bypasses RLS but NOT triggers, so the restore is refused
> exactly like a player's move and the run dies in setup rather than in an
> assertion. The reordering now carries a comment saying so.

Matrix **143/143**.

## Additional checklist (2026-09-02g) — NOT RUN

- [ ] **D1.** As DM, **click a player's token** — it selects, and its line of
      sight appears. *(This is the regression.)*
- [ ] **D2.** As DM, **drag a player's token**. It moves.
- [ ] **D3.** As DM, drag any token **through a wall**. Allowed.
- [ ] **D4.** Arm a wall tool → drawing still works; disarm → tokens selectable
      again.
- [ ] **D5.** Draw a wall with **"Blocks movement" unticked**. It appears
      **dashed** on the DM's map.
- [ ] **D6.** The player **cannot see through it** — it still fogs.
- [ ] **D7.** The player **CAN walk through it**.
- [ ] **D8.** A normal wall next to it still blocks the player's movement.

**2026-09-02 — walls are remembered.** Not too complicated, but the obvious
implementation is a trap worth recording.

> **The naive version is four lines and quietly ruins the map.** "Remember what
> you have seen" reads as: keep every visibility polygon and union them — and an
> SVG clipPath unions its children for free, so it barely looks like work. It is
> also unbounded: ~100 vertices per move, so a two-hour session is tens of
> thousands of points in a clip path the browser re-evaluates on every frame of
> every drag. Fine for ten minutes, then progressively worse, and the cause would
> be nowhere near the symptom.

So memory is a set of CELLS. Each polygon is rasterised once into the cells it
covers, and the cells are what persists — bounding the cost by the SIZE OF THE
MAP rather than by how long anyone has played. A hundred moves down the same
corridor cost exactly what one move costs. Adjacent cells merge into horizontal
runs before rendering, so a cleared 10×10 room is ten rectangles, not a hundred.
16 unit tests, and the ones that matter assert GROWTH rather than geometry.

**Walls are remembered; tokens and floor are not.** A corridor keeps its shape
when you walk out of it. A creature you saw a minute ago is not necessarily still
standing there, and drawing it would be worse than drawing nothing — it would be
confidently wrong.

> **Honest limit: session-only.** A reload forgets. Persisting means a table
> keyed by (player, map), RLS, and a throttled write per move — a real piece of
> work worth doing on its own rather than smuggled in here. Say the word.

## Additional checklist (2026-09-02h) — NOT RUN

- [ ] **E1.** Player looks down a corridor with a visible wall, then walks away.
      The wall **stays drawn**.
- [ ] **E2.** A wall never seen is still not drawn.
- [ ] **E3.** Walking around reveals more wall and never un-reveals any.
- [ ] **E4.** **Tokens are NOT remembered** — a monster seen and then left
      behind disappears when it goes out of sight.
- [ ] **E5.** The floor is not remembered either: the fog closes behind you.
- [ ] **E6.** Move to a different map and back: memory is per-map, not smeared
      across both.
- [ ] **E7.** After a lot of movement, the map is still smooth to drag and zoom.
- [ ] **E8.** Reload: memory is gone (expected — session-only).

**2026-09-02 — remembered walls were dropping out. Two causes, both mine.**

> *"I walk past a wall with it in sight, then walk out of being able to see it
> and sometimes I am unable to see it still."*

The word that mattered was **sometimes**. An always-broken feature is usually one
mistake; an intermittent one is usually a boundary, and here it was two.

**1. Walls are drawn ON cell boundaries.** A wall almost always runs along a grid
line — which is exactly the edge between two cells. The cell you explored
contained only half the wall's stroke; the other half lay in a cell you had not
seen. Clipped to the unpadded region, a remembered wall on a boundary lost half
its width, and at low zoom — where a 4px non-scaling stroke covers many map
pixels — it vanished entirely. Whether you noticed depended on which side you
had been standing and how far you were zoomed out, which is exactly the shape of
"sometimes".

Fixed by padding each remembered rectangle by half a cell, so the region overlaps
its own boundary.

**2. A cell was only remembered if its CENTRE had been visible.** A wall at the
LIMIT of sight sits in a cell whose centre falls just outside the polygon — so
the cell was never marked, and a wall you had plainly seen was not remembered.

Fixed by sampling the centre AND the four corners: the rule is now "any part of
this cell was visible", which is what a person means by having seen something.
Five point tests per cell instead of one, on a bounded cell count, only when
vision is recomputed.

Both have tests written as the failure rather than the fix — a polygon that
clips only a corner of a cell, and a padded rectangle covering the shared edge.
20 tests in `explored.test.ts`, **313 → 317** overall.

## Re-check (2026-09-02i) — NOT RUN

- [ ] **F1.** Walk past a wall, then away. It **stays drawn**, fully, not as a
      thin sliver.
- [ ] **F2.** Same at low zoom — zoom out and the remembered wall is still
      there at full thickness.
- [ ] **F3.** Look at a wall from the far edge of your sight range, then walk
      away: it is remembered.
- [ ] **F4.** Approach the same wall from the other side: no gaps appear.
- [ ] **F5.** A wall never in sight is still not drawn.

**2026-09-02 — remembered walls REMOVED. Visible walls are simply always drawn.**

> *"I am now unable to check if this change works because the walls are
> constantly being shown, lets just skip this idea for now and make walls
> permanently visible."*

The memory feature had become impossible to evaluate: after the two boundary
fixes, exploration was generous enough that a few moves marked most of the map,
so "is it remembering correctly?" and "is it just showing everything?" looked
identical from the map. A feature you cannot tell is working is not finished, and
chasing the padding down to where it was both correct AND observable would have
been tuning two approximations against each other.

Visible walls are now drawn **in full, always**. Three models were tried, and
this is the only one that is never wrong:

| Model | Failure |
|---|---|
| Under the fog | A wall vanished when you looked away — known terrain behaving like a secret |
| Clipped to line of sight | Only the stretch in view was drawn; needed memory to be usable |
| Clipped to remembered area | Boundary bugs, then indistinguishable from showing everything |
| **Always drawn** | — |

The DM marked the wall visible; it is visible. **Nothing is leaked**: RLS sends a
player only the walls marked visible (0066), so there was never anything here to
clip for safety — only for atmosphere.

`explored.ts` and its 20 tests are **deleted** rather than left unused. The design
is recorded above in full — cell rasterisation bounded by map size, horizontal run
merging, half-cell padding, corner sampling — so it can be rebuilt deliberately if
persistent fog-of-war is ever wanted, which is where it actually belongs.

Steps E1–E8 and F1–F5 above are **withdrawn**, not deferred: they test a feature
that no longer exists.

## Re-check (2026-09-02j) — NOT RUN

- [ ] **G1.** A visible wall is drawn **in full**, everywhere, regardless of
      where the player stands or what they can see.
- [ ] **G2.** A HIDDEN wall is still not drawn at all.
- [ ] **G3.** Fog still covers floor and tokens normally.
- [ ] **G4.** Tokens still appear/disappear and clip with line of sight.
- [ ] **G5.** DM view unchanged: all walls, drawable, erasable.

## Consolidated checklist before 9.4 (2026-09-02k) — NOT RUN

Eight "NOT RUN" sections had stacked up above, several of them testing behaviour
that a LATER change in the same session removed. Handing over all of them would
have asked for failures on steps that are now supposed to fail.

**B1–B4 are withdrawn**, alongside E1–E8 and F1–F5. They test walls clipped to
line of sight; that clipping is gone, and **B3 now asserts the opposite of G1** —
it wants an out-of-sight visible wall NOT drawn, which is exactly the behaviour
that was deliberately removed. B5 survives as G5.

Verified in code, not from memory: the only `clipPath` left in
`BattlemapCanvas.tsx` is `tokenClipId`. Nothing clips walls any more.

**What actually remains: A1–A10, C1–C3, D1–D8, G1–G5 — 26 steps.**

Order matters — each section leaves the app ready for the next:

1. **A** (DM window alone) — sight preview.
2. **D** (DM window alone) — DM interaction + fog-only walls. Ends with a
   fog-only wall and a normal wall drawn, which C and G both need.
3. **G**, then **C** (needs the player window open beside the DM's).

Pass criteria, unchanged in substance:

- **A2** — the preview stops at walls. Without this the feature is decorative.
- **A4** — it follows the drag, so it is usable while staging an encounter.
- **D1** — the regression: the DM can click a player's token at all.
- **D7 with D6** — the fog-only wall blocks sight but not movement. Either half
  alone proves nothing.
- **G1 with G2** — walls always drawn, EXCEPT hidden ones. G1 alone would also
  pass if hidden walls had started leaking.

## Checklist (2026-09-02l) — six owner reports — NOT RUN

Two of the six turned out to be defects rather than requests, and both are
recorded here because of WHERE they hid.

**`movePolygons` ignored `blocks_movement`.** The sight-only walls added by 0067
still stopped movement — but only in the browser. The database permitted the
move; the client never sent it. The server-side matrix therefore could not see
the bug, and could not have: it asserts what the database allows, and the
database was right. This is the failure mode of "the client check is only a
convenience" — it stays true only while the two checks agree, and nothing was
watching that they did.

**Token hit areas were square while tokens are round.** The corners of a square
around a circle are about 21% of the element: empty map that answered clicks.
On a 4x4 monster those corners reach well into the neighbouring squares, which
is why it presented as "you are unable to select things without selecting
something else". `clipPath: circle(50%)` clips hit-testing as well as painting,
so one line fixed both the stray selection and the stray drag. Tokens now also
paint biggest-first, so the small, hard-to-hit token sits ABOVE the large,
easy-to-hit one.

**On the fog latency**, which was the sharpest question asked: the gap between
the two windows was never computation. A DM computes locally from walls they
already hold. A player must wait for the move to be WRITTEN and then ask the
server, because the server computes from the stored position — two sequential
round trips, by construction, and no amount of tuning removes a step that has to
happen. So the client now sends where it is GOING (`at`) instead of asking where
it has arrived. It grants nothing: the sweep is still bounded by the real walls
and the token's real sight range, so a crafted position shows exactly what
standing there would show, and nothing is persisted.

**Occupancy is enforced by a trigger (0068), not just the client**, and the DM is
NOT exempt — unlike the wall rules. A wall is a fiction the DM authors and may
cross; two creatures in one square is a mistake, and one nobody notices until
initiative order stops making sense.

### H. The six reports

- [ ] **H1.** Click a token near its **edge** → it selects and does **not** move.
- [ ] **H2.** Click dead centre → selects, does not move.
- [ ] **H3.** Drag it normally → still moves, no stickiness at the start.
- [ ] **H4.** Click the **empty corner** just outside a token's circle → nothing
      is selected. *(This was the stray hit area.)*
- [ ] **H5.** With a **4x4** token beside a **1x1**, click the small one → the
      SMALL one selects, not the big one under the pointer.
- [ ] **H6.** Try to move one token **onto** another → refused; it stops against
      it rather than springing back.
- [ ] **H7.** Move it to the square **beside** another → allowed. *(The
      tolerance case; the failure here would be intermittent.)*
- [ ] **H8.** A **4x4** token cannot be moved so its BODY covers a small one,
      even though their centres are squares apart.
- [ ] **H9.** Walk a player token through a **sight-only** (dashed) wall → it
      goes through. *(This is the regression: it used to be blocked.)*
- [ ] **H10.** A normal wall beside it still stops the player.
- [ ] **H11.** As the player, **move**: the fog opens **with** the token, not a
      beat behind it. Compare against how it felt before.
- [ ] **H12.** With the player window open and idle, the DM **draws a wall** →
      it appears in the player's window within about a second, with nobody
      moving. Erase it → it disappears the same way.

## Pass criteria

**H4, H5, H7, H9 and H11.**

- H4 and H5 are the selection complaint from both ends — a click that should
  hit nothing, and a click that should hit the harder target.
- **H7 is the one that would betray a subtle error.** H6 passing only proves
  the rule fires; H7 is what proves it does not fire too often, and its failure
  mode is direction-dependent, so a single lucky attempt is not evidence. Try
  approaching from more than one side.
- H9 is the defect the matrix could not see.
- H11 is subjective by nature, and worth saying so rather than dressing up: it
  is the report that started this, and the honest test is whether it still
  reads as lag.

## Known gaps

- **Two requests a second, per player, while a fogged map is open.** That is the
  owner's chosen figure and it is not free. Paused when the tab is hidden and
  while this session is moving something — the latter because a poll landing
  mid-drag would overwrite the speculative polygon with one computed from the
  token's old stored position, and the fog would flicker backwards under the
  player's hand.
- The speculative viewpoint applies to **all** of the caller's tokens, since the
  request does not say which one moved. A player with two tokens on one map gets
  one polygon drawn from a position that token is not at, for an instant, until
  the authoritative refresh corrects it. Slightly MORE fog opens, never less.
- **0068 can freeze an already-overlapping token**: every future update re-runs
  the check and fails. The migration reports the count as a warning rather than
  silently shoving pieces apart. Zero on this database at apply time.
