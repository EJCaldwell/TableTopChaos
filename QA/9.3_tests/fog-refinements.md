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
