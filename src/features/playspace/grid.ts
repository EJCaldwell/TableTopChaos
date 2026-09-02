/**
 * playspace/grid.ts — the battlemap's coordinate maths (Phase 9.1.2).
 *
 * Owns every conversion between the three coordinate spaces the canvas juggles,
 * kept OUT of the React component on purpose: this is the part with real edge
 * cases, and pure functions are the only part of a drag interaction that can be
 * tested without a browser. The project rules out handing the user console
 * steps, so anything provable belongs here rather than in a checklist.
 *
 * THE THREE SPACES:
 *  - **Map pixels** — the stored coordinate system (`playspace_tokens.x/y`).
 *    Independent of zoom and of the element's on-screen size. Migration 0048
 *    decision 1: positions are pixels, NOT grid cells, because a battlemap image
 *    usually has its own grid drawn on it and off-grid placement is normal.
 *  - **Client pixels** — CSS pixels inside the map element, i.e. what a
 *    PointerEvent reports relative to the element's bounding box.
 *  - **Cells** — only ever a display concept (the overlay, and snapping).
 *
 * Map pixels are the source of truth; the other two are derived. That is what
 * makes a token land in the same place on a phone and a 4K monitor.
 */

/** A point in map-pixel space. */
export interface Point {
  x: number
  y: number
}

/**
 * The bit of a map row this module needs, so tests need not build a full row.
 *
 * `grid_offset_x/y` shift the overlay WITHOUT moving anything already placed
 * (0048 decision 1). They exist because a scanned battlemap's printed grid
 * almost never starts at the exact top-left pixel, so spacing alone can be
 * correct and still be half a square out everywhere.
 */
export interface MapGeometry {
  width_px: number
  height_px: number
  grid_size: number
  grid_offset_x?: number
  grid_offset_y?: number
}

/** Reads an offset that older callers (and older rows) may not carry. */
function offset(map: MapGeometry): Point {
  return { x: map.grid_offset_x ?? 0, y: map.grid_offset_y ?? 0 }
}

/**
 * Snaps a map-pixel point to the CENTRE of its grid cell.
 *
 * Centres rather than corners: a token is drawn centred on its coordinate, so
 * snapping to a corner would leave it straddling four cells — visibly wrong on a
 * map whose printed grid the overlay is aligned to.
 *
 * @param p - The point in map pixels.
 * @param gridSize - Cell size in map pixels. Values below 1 are treated as "no
 *        grid" and the point is returned unchanged, so a nonsense grid can never
 *        collapse every token onto the origin.
 * @returns The snapped point, or `p` when snapping is meaningless.
 */
export function snapToGrid(p: Point, gridSize: number, off: Point = { x: 0, y: 0 }): Point {
  if (!Number.isFinite(gridSize) || gridSize < 1) return p
  // Subtract the offset, snap in grid space, add it back. Doing it in one
  // expression instead would put the offset inside the floor() and shift the
  // cell boundaries by a rounding error rather than by the offset.
  return {
    x: Math.floor((p.x - off.x) / gridSize) * gridSize + gridSize / 2 + off.x,
    y: Math.floor((p.y - off.y) / gridSize) * gridSize + gridSize / 2 + off.y,
  }
}

/**
 * Clamps a point to the map's bounds so a token cannot be dragged into the void.
 *
 * `inset` is what keeps a token WHOLLY on the map rather than merely centred on
 * its edge. A token is drawn centred on its coordinate, so clamping the centre
 * to x = 0 leaves half of it hanging outside — which is exactly what happened
 * when dragging off the edge (reported 2026-09-01): the token went half off and
 * stayed there. Passing half the token's width pulls it fully inside.
 *
 * NOTE the asymmetry with the server, which deliberately does NOT clamp (0048:
 * "clamping server-side would silently move a token a DM dragged to the edge").
 * This is a UI affordance, not an invariant: a token already outside the bounds
 * — because the DM shrank the map afterwards — still renders where it is, and is
 * only pulled in if someone drags it.
 *
 * @param p - The point in map pixels.
 * @param map - The map's dimensions.
 * @param inset - Margin to keep clear of each edge, in map pixels. Halved
 *        automatically if the map is narrower than two insets, so a token bigger
 *        than the map lands at the centre instead of inverting the bounds and
 *        snapping to a nonsense corner.
 * @returns The point, clamped into [inset, width - inset] x [inset, height - inset].
 */
export function clampToMap(
  p: Point,
  map: Pick<MapGeometry, 'width_px' | 'height_px'>,
  inset = 0,
): Point {
  const ix = Math.min(inset, map.width_px / 2)
  const iy = Math.min(inset, map.height_px / 2)
  return {
    x: Math.min(Math.max(p.x, ix), map.width_px - ix),
    y: Math.min(Math.max(p.y, iy), map.height_px - iy),
  }
}

/**
 * Converts a pointer position inside the map element into map pixels.
 *
 * @param clientX - PointerEvent.clientX.
 * @param clientY - PointerEvent.clientY.
 * @param rect - The map element's bounding rect (its ON-SCREEN size).
 * @param map - The map's intrinsic dimensions in map pixels.
 * @returns The equivalent point in map pixels.
 *
 * A zero-width rect (an element not yet laid out, or display:none) would make
 * the scale factor Infinity and send every token to NaN, so it is guarded — the
 * caller gets the origin and the drag is a no-op rather than a corruption.
 */
export function clientToMap(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  map: Pick<MapGeometry, 'width_px' | 'height_px'>,
): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((clientX - rect.left) / rect.width) * map.width_px,
    y: ((clientY - rect.top) / rect.height) * map.height_px,
  }
}

/**
 * The full drop calculation: pointer position → stored coordinate.
 *
 * Order matters and is not interchangeable. Snap FIRST, then clamp: clamping
 * first can leave a point exactly on the boundary that then snaps back outside
 * it. Doing it this way, the last operation is the one that guarantees bounds.
 *
 * @param clientX - PointerEvent.clientX.
 * @param clientY - PointerEvent.clientY.
 * @param rect - The map element's bounding rect.
 * @param map - Map dimensions and grid size.
 * @param snap - Whether grid snapping is on (the DM may hold a modifier to place
 *        freely; off-grid placement is expected — see 0048 decision 1).
 * @param inset - Half the token's size, so free (un-snapped) placement stops
 *        with the token fully on the map rather than half over the edge.
 * @param sizeCells - The token's size in squares, used when snapping. See
 *        {@link snapToken} for why size changes where a token snaps to.
 * @returns Integer map-pixel coordinates, ready to store. Rounded because the
 *          columns are `int`: sending 34.5 would be silently truncated by
 *          Postgres, and a half-pixel that survives locally but not on reload is
 *          the kind of drift that looks like a sync bug.
 */
export function dropPosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  map: MapGeometry,
  snap: boolean,
  inset = 0,
  sizeCells = 1,
): Point {
  const raw = clientToMap(clientX, clientY, rect, map)
  const bounded = snap ? snapToken(raw, map, sizeCells) : clampToMap(raw, map, inset)
  return { x: Math.round(bounded.x), y: Math.round(bounded.y) }
}

/**
 * How many grid lines to draw, capped.
 *
 * A 20000px map (the schema's maximum) with a 10px grid (its minimum) is 2000
 * lines in each direction — 4000 DOM nodes for something nobody can see at that
 * density. Above the cap the overlay is dropped entirely rather than drawn
 * wrong, and the caller says so.
 *
 * @param map - Map dimensions and grid size.
 * @param maxLines - Cap per axis (default 400).
 * @returns Line offsets in map pixels for each axis, or null when over the cap.
 */
export function gridLines(
  map: MapGeometry,
  maxLines = 400,
): { vertical: number[]; horizontal: number[] } | null {
  const g = map.grid_size
  if (!Number.isFinite(g) || g < 1) return null
  if (map.width_px / g > maxLines || map.height_px / g > maxLines) return null
  const off = offset(map)
  // Start at the first line at or after 0 given the offset, so a shifted grid
  // still covers the left/top edge instead of leaving a wider first column.
  const first = (o: number) => {
    const m = ((o % g) + g) % g
    return m === 0 ? g : m
  }
  const vertical: number[] = []
  for (let x = first(off.x); x < map.width_px; x += g) vertical.push(x)
  const horizontal: number[] = []
  for (let y = first(off.y); y < map.height_px; y += g) horizontal.push(y)
  return { vertical, horizontal }
}

/**
 * Finds a free cell centre near the middle of the map for a NEW token.
 *
 * Why not simply the exact centre: dropping every new token on the same pixel
 * stacks them, and the top one hides the rest — so the DM adds three monsters
 * and appears to have added one. Searching outward means each new token lands
 * somewhere it can actually be seen and grabbed.
 *
 * The search is a growing square ring around the centre cell, so the first free
 * cell found is the nearest one; it stops at the map's edge and, if the middle
 * of the map really is full, falls back to the exact centre rather than
 * refusing to place anything. A token you must then drag is a far better
 * outcome than an "Add token" button that does nothing.
 *
 * @param map - Map dimensions, grid size and offset.
 * @param taken - Existing token positions, in map pixels.
 * @param tolerance - How close a token must be to count as occupying a cell.
 *        Defaults to a third of a cell, so a deliberately off-grid token still
 *        blocks the square it is visually sitting in.
 * @returns A point in map pixels, already snapped to a cell centre.
 */
export function findFreeCell(
  map: MapGeometry,
  taken: Point[],
  tolerance = map.grid_size / 3,
): Point {
  const centre = clampToMap(
    snapToGrid({ x: map.width_px / 2, y: map.height_px / 2 }, map.grid_size, offset(map)),
    map,
  )
  const g = map.grid_size
  if (!Number.isFinite(g) || g < 1) return centre

  const occupied = (p: Point) =>
    taken.some((t) => Math.abs(t.x - p.x) < tolerance && Math.abs(t.y - p.y) < tolerance)

  if (!occupied(centre)) return centre

  // Rings outward. Capped by the map's own size, so a full map terminates
  // rather than searching forever.
  const maxRing = Math.ceil(Math.max(map.width_px, map.height_px) / g)
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only the ring's edge; the interior was covered by smaller rings.
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
        const p = { x: centre.x + dx * g, y: centre.y + dy * g }
        if (p.x < 0 || p.y < 0 || p.x > map.width_px || p.y > map.height_px) continue
        if (!occupied(p)) return p
      }
    }
  }
  return centre
}

/**
 * Snaps a token of a given size to the grid, and keeps it on the map.
 *
 * WHY SIZE CHANGES WHERE A TOKEN SNAPS TO. A token is drawn centred on its
 * coordinate, so where its centre belongs depends on how many squares wide it
 * is:
 *  - an ODD number of squares (1 or 3) is centred on a CELL CENTRE, so it covers
 *    a symmetric block of cells;
 *  - an EVEN number (2 or 4) is centred on a CELL CORNER — the intersection —
 *    because a 2x2 token centred on a cell centre straddles four half-cells and
 *    lines up with nothing;
 *  - a HALF-square token (0.5) is centred on the CELL CENTRE too, like any other
 *    odd-ish size. An earlier version snapped it to quarter-cells so four could
 *    tile one square; the owner's answer was that a small creature belongs in
 *    the middle of its square, not tucked into a corner of one — which is also
 *    how a small creature is read at a glance on a printed map.
 *
 * Getting this wrong is not subtle at a table: a large monster that will not sit
 * inside its own square is the first thing anyone notices.
 *
 * Edge tiles ARE allowed. An earlier version confined movement to cells wholly
 * inside the map, which is defensible but was not what the owner wanted: the
 * partial squares at the edge of a battlemap are still places a creature stands.
 * The token is only kept from hanging off the map entirely.
 *
 * @param p - The point in map pixels.
 * @param map - Dimensions, grid size and offset.
 * @param sizeCells - Token size in squares (0.5, 1, 2, 3, 4).
 * @returns The snapped, on-map centre.
 */
export function snapToken(p: Point, map: MapGeometry, sizeCells = 1): Point {
  const g = map.grid_size
  if (!Number.isFinite(g) || g < 1) return p
  const off = offset(map)

  // The lattice this token's centre lives on, and the phase within it.
  //  - even squares (2, 4): full grid, ON the lines, because a 2x2 centred on a
  //    cell centre straddles four half-cells and lines up with nothing;
  //  - everything else (0.5, 1, 3): full grid, centred in each cell.
  const step = g
  const phase = sizeCells >= 1 && sizeCells % 2 === 0 ? 0 : step / 2

  const axis = (v: number, o: number) => Math.round((v - o - phase) / step) * step + phase + o

  return clampToMap({ x: axis(p.x, off.x), y: axis(p.y, off.y) }, map, (sizeCells * g) / 2)
}

/**
 * The movement a key press means, in grid steps.
 *
 * Returns a {dx, dy} in CELLS (-1, 0 or 1 each), or null for a key that is not
 * movement. The caller multiplies by the grid size.
 *
 * WHY THREE SETS OF KEYS. Arrows are what everyone tries first, but a keyboard
 * has only four of them and a battlemap has eight directions — diagonal movement
 * is normal at a table and was missing (owner, 2026-09-02).
 *
 *  - **Arrows** — the four orthogonals, unchanged.
 *  - **Numpad 1–9** — the roguelike/VTT convention, and the only layout where
 *    the keys are physically arranged like the directions they mean. 5 is a
 *    deliberate no-op rather than an error: on a numpad it is the centre.
 *  - **Home / PageUp / End / PageDown** — the four diagonals for the many
 *    laptops with no numpad at all. Without these, diagonal movement would be
 *    unavailable to most people using this app, which is not a feature.
 *
 * Numpad keys are read from `event.code` (`Numpad7`), not `event.key`, because
 * `key` is '7' or 'Home' depending on NumLock — the same physical key meaning
 * two different things is exactly what `code` exists to avoid.
 *
 * @param key - KeyboardEvent.key.
 * @param code - KeyboardEvent.code.
 * @returns Step in cells, or null if the key is not a movement key.
 */
export function movementDelta(key: string, code: string): { dx: number; dy: number } | null {
  switch (code) {
    case 'Numpad7': return { dx: -1, dy: -1 }
    case 'Numpad8': return { dx: 0, dy: -1 }
    case 'Numpad9': return { dx: 1, dy: -1 }
    case 'Numpad4': return { dx: -1, dy: 0 }
    // The centre of the numpad. Consumed as movement so it does not fall
    // through to the browser, but moves nothing.
    case 'Numpad5': return { dx: 0, dy: 0 }
    case 'Numpad6': return { dx: 1, dy: 0 }
    case 'Numpad1': return { dx: -1, dy: 1 }
    case 'Numpad2': return { dx: 0, dy: 1 }
    case 'Numpad3': return { dx: 1, dy: 1 }
  }
  switch (key) {
    case 'ArrowLeft': return { dx: -1, dy: 0 }
    case 'ArrowRight': return { dx: 1, dy: 0 }
    case 'ArrowUp': return { dx: 0, dy: -1 }
    case 'ArrowDown': return { dx: 0, dy: 1 }
    // Laptop diagonals. Deliberately AFTER the numpad switch: with NumLock off,
    // Numpad7 reports key 'Home', and the code branch above has already handled
    // it with the same meaning, so the two can never disagree.
    case 'Home': return { dx: -1, dy: -1 }
    case 'PageUp': return { dx: 1, dy: -1 }
    case 'End': return { dx: -1, dy: 1 }
    case 'PageDown': return { dx: 1, dy: 1 }
  }
  return null
}

/**
 * Combines the movement keys currently held into one step.
 *
 * WHY THIS EXISTS. Diagonal movement was first offered on the numpad and on
 * Home/PgUp/End/PgDn — both of which a compact laptop keyboard may lack
 * entirely (owner, 2026-09-02: "I am unable to test the ones that require a full
 * size keyboard"). Holding Left and Up together is the input everyone already
 * knows from games and needs no keys at all beyond the four arrows.
 *
 * Contributions are summed and then CLAMPED to one cell per axis. Summing alone
 * would make Left+Left a two-square step if a key ever repeated into the set
 * twice, and Up+PageDown would cancel to nothing on one axis while leaving the
 * other — clamping keeps every result a legal single step in one of the eight
 * directions, or no step at all.
 *
 * Opposite keys cancelling to zero is correct, not a bug: holding Left and Right
 * together means no horizontal intent, exactly as it does in every game.
 *
 * @param held - The keys currently down, as {key, code} pairs.
 * @returns A step of -1..1 on each axis, or null if nothing held is movement.
 */
export function combinedDelta(
  held: { key: string; code: string }[],
): { dx: number; dy: number } | null {
  let dx = 0
  let dy = 0
  let any = false
  for (const h of held) {
    const d = movementDelta(h.key, h.code)
    if (!d) continue
    any = true
    dx += d.dx
    dy += d.dy
  }
  if (!any) return null
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  return { dx: clamp(dx), dy: clamp(dy) }
}

/**
 * A token's footprint on the map, in map pixels.
 *
 * A token is drawn centred on its coordinate and is `sizeCells` squares across,
 * so its footprint is a square of side `sizeCells * grid_size` centred on that
 * point. This is the ONE definition of "the space a token takes up"; both the
 * client's move check and the server's trigger are written against it, and if
 * they ever disagree the server wins.
 *
 * @param p - The token's centre, in map pixels.
 * @param sizeCells - Its size in squares (0.5, 1, 2, 3, 4).
 * @param gridSize - The map's current grid size in pixels.
 * @returns Left/top/right/bottom edges in map pixels.
 */
export function tokenFootprint(
  p: Point,
  sizeCells: number,
  gridSize: number,
): { left: number; top: number; right: number; bottom: number } {
  const half = (sizeCells * gridSize) / 2
  return { left: p.x - half, top: p.y - half, right: p.x + half, bottom: p.y + half }
}

/**
 * How much two footprints may overlap before they count as occupying the same
 * space, in map pixels.
 *
 * NOT zero, and this is the whole subtlety of the feature. Two tokens in
 * ADJACENT squares share an edge exactly, so their footprints touch at a single
 * coordinate — and floating-point snapping puts that coordinate a fraction of a
 * pixel either side of the boundary depending on which direction the token
 * arrived from. A strict `>` test therefore rejects perfectly legal
 * side-by-side placement, intermittently, which reads as "sometimes I can't
 * stand next to someone".
 *
 * A quarter of a pixel is far below anything a player can see or aim at, and far
 * above the snapping error.
 */
const OCCUPANCY_EPSILON = 0.25

/**
 * Do two tokens occupy the same space?
 *
 * Axis-aligned rectangle overlap, with the epsilon above so that merely TOUCHING
 * — which is what standing side by side means — is not an overlap.
 *
 * @param a - First token's centre.
 * @param aSize - First token's size in squares.
 * @param b - Second token's centre.
 * @param bSize - Second token's size in squares.
 * @param gridSize - The map's grid size in pixels.
 */
export function tokensOverlap(
  a: Point,
  aSize: number,
  b: Point,
  bSize: number,
  gridSize: number,
): boolean {
  const ra = tokenFootprint(a, aSize, gridSize)
  const rb = tokenFootprint(b, bSize, gridSize)
  return (
    ra.left < rb.right - OCCUPANCY_EPSILON &&
    ra.right > rb.left + OCCUPANCY_EPSILON &&
    ra.top < rb.bottom - OCCUPANCY_EPSILON &&
    ra.bottom > rb.top + OCCUPANCY_EPSILON
  )
}

/**
 * Is a square free for a token of a given size?
 *
 * @param p - The candidate centre, in map pixels.
 * @param sizeCells - The moving token's size in squares.
 * @param others - Every OTHER token on the map: `{x, y, size_cells}`. The moving
 *        token must be excluded by the caller, or it will collide with itself
 *        and nothing will ever be able to move.
 * @param gridSize - The map's grid size in pixels.
 */
export function isSpaceFree(
  p: Point,
  sizeCells: number,
  others: { x: number; y: number; size_cells: number }[],
  gridSize: number,
): boolean {
  return !others.some((o) =>
    tokensOverlap(p, sizeCells, { x: o.x, y: o.y }, o.size_cells, gridSize),
  )
}
