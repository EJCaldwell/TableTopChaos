/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from src/features/playspace/walls.ts + vision.ts by
 * geometryBundle.ts, because an Edge Function cannot import from src/.
 *
 * To change anything here, edit those files and run:
 *     npm run sync:geometry
 *
 * A test (geometryBundle.test.ts) fails if this file does not match its
 * sources, so the deployed maths can never quietly fall behind the tested maths.
 */

/**
 * playspace/walls.ts — the geometry behind the DM's wall tools (Phase 9.2.2).
 *
 * Pure, and deliberately separate from the drawing component, because this is
 * the half that can be wrong in ways nobody sees: a freehand stroke that quietly
 * exceeds the database's point limit, a rectangle whose corners are in the wrong
 * order, a "closed" shape missing its last edge. All of it is map-pixel
 * arithmetic with no DOM in sight, so it belongs in tests rather than on a
 * checklist.
 *
 * Everything here works in MAP PIXELS, the same space as tokens (0048 decision
 * 1), so a wall stays put through zoom and re-gridding.
 */

/** A point in map-pixel space. */
export interface Point {
  x: number
  y: number
}

/** A line segment — what the 9.3 sight calculation will actually consume. */
export interface Segment {
  a: Point
  b: Point
}

/**
 * The database's ceiling on points in one wall (migration 0060).
 * Mirrored here so {@link simplifyStroke} can guarantee what it returns.
 */
export const MAX_WALL_POINTS = 2000

/**
 * Most points fed to the recursive simplifier.
 *
 * RDP is O(n²) in the worst case, so an unbounded stroke does not merely take
 * longer — it freezes the page at the moment the DM releases the mouse. Above
 * this, the stroke is strided down first. Only slightly above the stored limit,
 * because anything over that is decimated at the end regardless — recursing over
 * points destined to be thrown away is pure cost. Ordinary strokes are far below
 * this and never take the path at all.
 */
const RDP_INPUT_CAP = 2500

/**
 * The four corners of a rectangle from two dragged corners, in order.
 *
 * Order matters: the points are consumed as a path, so listing them
 * diagonally-opposite first would draw a bow-tie rather than a rectangle. Works
 * for a drag in any direction, since a DM dragging up-and-left is not making a
 * mistake.
 *
 * @param a - Where the drag started.
 * @param b - Where it ended.
 * @returns Four corners, clockwise from the drag's origin corner.
 */
export function rectPoints(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ]
}

/**
 * Splits a point list into the segments a sight calculation consumes.
 *
 * @param points - The wall's ordered points.
 * @param closed - Whether the last point joins back to the first.
 * @returns One segment per edge. An empty list for fewer than two points,
 *          rather than a segment from a point to itself — a zero-length segment
 *          has no direction, and a ray cast against it divides by zero.
 */
export function segmentsOf(points: Point[], closed = false): Segment[] {
  if (points.length < 2) return []
  const out: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) out.push({ a: points[i], b: points[i + 1] })
  // A closed shape's final edge exists only implicitly in the point list. Sight
  // would leak through that missing edge — the classic "room with an invisible
  // doorway where the loop closes".
  if (closed && points.length > 2) out.push({ a: points[points.length - 1], b: points[0] })
  return out
}

/**
 * Reduces a freehand stroke to its meaningful points (Ramer–Douglas–Peucker).
 *
 * NOT cosmetic. A pointermove-per-pixel stroke across a large map easily runs to
 * several thousand points, and the database refuses more than
 * {@link MAX_WALL_POINTS} — so without this, drawing a long freehand wall fails
 * at save time, after the DM has already drawn it. It also keeps the 9.3 sight
 * calculation tractable, since cost there is per segment.
 *
 * The algorithm keeps the endpoints and recursively keeps whichever interior
 * point is furthest from the line between them, until everything remaining is
 * within `tolerance`. Corners survive; the wobble along a straight drag does not.
 *
 * @param points - The raw captured points.
 * @param tolerance - Maximum distance, in map pixels, a dropped point may be
 *        from the line that replaces it. 2 is roughly "invisible at 100% zoom".
 * @returns A simplified list, guaranteed to be at most MAX_WALL_POINTS long.
 */
export function simplifyStroke(points: Point[], tolerance = 2): Point[] {
  if (points.length <= 2) return points.slice()

  // Pre-decimate before RDP. This is a PERFORMANCE guard, found by a test: RDP
  // is O(n²) in the worst case, and 12000 points took 2.8 seconds — which in the
  // app is not a slow test but a frozen UI at the moment the DM lets go of the
  // mouse. Striding first bounds the recursion; the points dropped here are
  // adjacent samples from one pointer path, which RDP would almost certainly
  // have dropped anyway.
  const source =
    points.length > RDP_INPUT_CAP
      ? decimate(points, Math.ceil(points.length / RDP_INPUT_CAP))
      : points

  let simplified = rdp(source, tolerance)

  // A guarantee, not a hope: a pathological stroke (a dense scribble, where
  // every point genuinely is a corner) can survive simplification and still be
  // over the limit. Raising the tolerance until it fits is better than saving a
  // wall the database will reject.
  //
  // The floor of 0.5 is load-bearing, not tidiness: doubling from a tolerance of
  // 0 stays at 0 forever, and the loop never terminates. A test with
  // `tolerance: 0` hung the suite until this was added.
  let t = Math.max(tolerance, 0.5)
  while (simplified.length > MAX_WALL_POINTS && t < 1e6) {
    t *= 2
    simplified = rdp(source, t)
  }
  // Last resort: keep every Nth point. Only reachable for input so degenerate
  // that doubling the tolerance twenty times did not help, but "drop the wall"
  // is not an acceptable outcome for a DM mid-session.
  if (simplified.length > MAX_WALL_POINTS) {
    return decimate(simplified, Math.ceil(simplified.length / MAX_WALL_POINTS))
  }
  return simplified
}

/**
 * Keeps every `step`th point, plus the last.
 *
 * The last point is kept explicitly because striding by index will usually miss
 * it, and it is where the DM let go — dropping it visibly shortens the wall.
 *
 * @param points - Source points.
 * @param step - Keep one in every `step`.
 */
function decimate(points: Point[], step: number): Point[] {
  const kept = points.filter((_, i) => i % step === 0)
  const last = points[points.length - 1]
  if (kept[kept.length - 1] !== last) kept.push(last)
  return kept
}

/**
 * Recursive Ramer–Douglas–Peucker. Assumes at least two points.
 *
 * Worst case is O(n²) — a stroke where every point is a corner splits one point
 * at a time. That is survivable only because {@link simplifyStroke} caps the
 * input at what a pointer can physically produce and raises the tolerance rather
 * than recursing harder.
 */
function rdp(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice()
  const first = points[0]
  const last = points[points.length - 1]

  let worst = 0
  let worstIndex = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], first, last)
    if (d > worst) {
      worst = d
      worstIndex = i
    }
  }

  if (worst <= tolerance) return [first, last]
  // Split at the worst point and keep it: it is by definition the one the
  // straight line represents least well.
  const left = rdp(points.slice(0, worstIndex + 1), tolerance)
  const right = rdp(points.slice(worstIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

/**
 * Perpendicular distance from a point to the segment a–b.
 *
 * Segment, not infinite line: a point beyond an endpoint is measured to that
 * endpoint. Using the infinite line would under-measure points off the end of a
 * short segment and simplify away real corners.
 *
 * @param p - The point.
 * @param a - Segment start.
 * @param b - Segment end.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // Degenerate segment (a === b): fall back to point-to-point, rather than
  // dividing by zero and returning NaN, which compares false against every
  // tolerance and would keep every point forever.
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Renders a point list as an SVG path in map-pixel coordinates.
 *
 * The SVG is drawn inside a viewBox of the map's own dimensions, so map pixels
 * ARE the path's units and no scaling is needed here — the same trick that lets
 * tokens position in percent.
 *
 * @param points - Ordered points.
 * @param closed - Whether to emit the closing 'Z'.
 * @returns An SVG `d` attribute, or '' for fewer than two points.
 */
export function toSvgPath(points: Point[], closed = false): string {
  if (points.length < 2) return ''
  const [head, ...rest] = points
  const body = rest.map((p) => `L ${p.x} ${p.y}`).join(' ')
  return `M ${head.x} ${head.y} ${body}${closed ? ' Z' : ''}`
}

/**
 * Converts stored JSON geometry back into points.
 *
 * Defensive because the column is `jsonb`: the database CHECK guarantees the
 * shape of anything IT accepted, but a row could predate a constraint or arrive
 * from a restore. A malformed wall is dropped rather than allowed to render as
 * NaN coordinates, which in SVG silently blanks the entire path element —
 * taking every other wall in the same element with it.
 *
 * @param raw - The `points` column value.
 * @returns Valid points, possibly empty.
 */
export function pointsFromJson(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return []
  const out: Point[] = []
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue
    const [x, y] = pair
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({ x, y })
  }
  return out
}

/**
 * Converts points to the stored JSON form, rounded.
 *
 * Rounded because sub-pixel precision on a wall is meaningless and doubles the
 * stored size of a long freehand stroke for nothing.
 *
 * @param points - Points in map pixels.
 */
export function pointsToJson(points: Point[]): [number, number][] {
  return points.map((p) => [Math.round(p.x), Math.round(p.y)])
}

/**
 * Snaps a point to the nearest grid INTERSECTION.
 *
 * Corners, not cell centres — and that is the whole point of having a separate
 * function from the token one. A token stands IN a square, so it snaps to the
 * middle of one; a wall runs ALONG the edges of squares, so it snaps to where
 * the lines meet. Snapping wall endpoints to cell centres would put every wall
 * half a square off the grid it is meant to follow, which is worse than not
 * snapping at all.
 *
 * @param p - Point in map pixels.
 * @param gridSize - Cell size in map pixels.
 * @param offset - The grid's offset (0055), so a shifted overlay still snaps to
 *        its own lines rather than to an imaginary unshifted grid.
 * @returns The nearest intersection, or `p` unchanged for a nonsense grid.
 */
export function snapToGridCorner(
  p: Point,
  gridSize: number,
  offset: Point = { x: 0, y: 0 },
): Point {
  if (!Number.isFinite(gridSize) || gridSize < 1) return p
  return {
    x: Math.round((p.x - offset.x) / gridSize) * gridSize + offset.x,
    y: Math.round((p.y - offset.y) / gridSize) * gridSize + offset.y,
  }
}

/**
 * playspace/vision.ts — visibility polygon computation (Phase 9.3).
 *
 * Given a viewpoint, a set of wall segments and a sight range, produces the
 * polygon of everything that point can see. This is the whole of the fog
 * feature's correctness, and it is pure arithmetic with no DOM, no network and
 * no database — so it lives here and is unit-tested, and the Edge Function that
 * runs it in production is a thin wrapper.
 *
 * THIS FILE IS SHARED WITH THE SERVER on purpose. Migration 0061 made walls
 * DM-only, so the polygon must be computed where the walls are — in an Edge
 * Function — and only the RESULT is sent to a player. Keeping the maths in one
 * tested module means the thing running on the server is the thing the tests
 * exercised, rather than a re-implementation of it.
 *
 * THE ALGORITHM: an angular sweep.
 *   1. Every wall endpoint defines an interesting angle from the viewpoint.
 *   2. Cast a ray at each such angle, plus one a hair either side. The hairs are
 *      the whole trick — a ray exactly at a corner hits the corner and stops,
 *      while the rays just past it slip by and find whatever is behind, which is
 *      what produces the shadow's edges.
 *   3. Take the nearest hit along each ray, or the sight radius if it hits
 *      nothing.
 *   4. Sort the hits by angle. That ordered list of points IS the visible
 *      polygon.
 *
 * A sign error anywhere in here is invisible on screen until someone sees
 * through a wall, which is exactly why it is tested rather than eyeballed.
 */


/**
 * How far either side of a corner the extra rays are cast, in radians.
 *
 * Small enough that the two rays are visually identical to the corner ray, large
 * enough to survive floating-point noise at map-pixel scale. Too small and the
 * three rays all hit the corner and the shadow has no edges; too large and the
 * polygon visibly cuts the corners off solid walls.
 */
const ANGLE_EPSILON = 0.00001

/**
 * How many rays approximate the sight-range circle where nothing blocks it.
 *
 * The circle is the only curved part of the polygon; everything else is exact.
 * 60 is a segment every 6 degrees, which reads as round at any zoom this app
 * offers, and keeps the polygon small enough to send over the wire per token.
 */
const CIRCLE_RAYS = 60

/**
 * Normalises an angle to [0, 2π).
 *
 * LOAD-BEARING, not tidiness. `Math.atan2` returns (-π, π] while the circle rays
 * below are generated as 0..2π — two different conventions for the same
 * directions. Sorting the mixture put a ray at 4.0 rad after one at 3.0 rad even
 * though 4.0 rad is the same direction as -2.28 rad, so the "sorted" vertex list
 * was not in angular order at all and the polygon crossed itself. The symptom
 * was a viewer in an EMPTY room seeing nothing to their left, which reads as a
 * wall-blocking bug and is not one.
 *
 * @param a - Any angle in radians.
 */
function normaliseAngle(a: number): number {
  const twoPi = Math.PI * 2
  return ((a % twoPi) + twoPi) % twoPi
}

/**
 * Where a ray from `origin` in direction `angle` first meets a segment.
 *
 * @param origin - Ray start.
 * @param angle - Ray direction in radians.
 * @param seg - The segment to test.
 * @returns Distance along the ray to the hit, or null if it misses.
 */
export function rayHit(origin: Point, angle: number, seg: Segment): number | null {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const sx = seg.b.x - seg.a.x
  const sy = seg.b.y - seg.a.y

  // Cross product of the two directions. Zero means parallel: either no
  // intersection, or the ray runs ALONG the segment — in which case there is no
  // single hit point, and reporting one would put a spurious vertex in the
  // polygon. Treated as a miss, which is correct: a wall edge-on blocks nothing
  // it is not already blocking via its endpoints.
  const denom = dx * sy - dy * sx
  if (Math.abs(denom) < 1e-12) return null

  const ox = seg.a.x - origin.x
  const oy = seg.a.y - origin.y

  // t = distance along the ray; u = position along the segment (0..1).
  const t = (ox * sy - oy * sx) / denom
  const u = (ox * dy - oy * dx) / denom

  // t must be forward along the ray — a negative t is the wall BEHIND the
  // viewer, and forgetting this sign is the classic way to see through walls in
  // one direction only.
  if (t < 0) return null
  if (u < 0 || u > 1) return null
  return t
}

/**
 * Computes the polygon of everything visible from a point.
 *
 * @param origin - The viewpoint, in map pixels.
 * @param segments - Every wall segment (see walls.ts/segmentsOf).
 * @param radius - Sight range in map pixels. Use Infinity for unlimited; the
 *        polygon is then bounded by `bounds` instead.
 * @param bounds - The map's extent, so unlimited sight is still a finite
 *        polygon. Rays that hit nothing stop here.
 * @returns Polygon vertices in angular order. Always at least 3 points, so the
 *          caller never has to special-case a degenerate shape.
 */
export function visibilityPolygon(
  origin: Point,
  segments: Segment[],
  radius: number,
  bounds: { width: number; height: number },
): Point[] {
  // The map's own edges are treated as walls. Without them, a ray that escapes
  // through a gap runs to the radius and the polygon bulges outside the picture
  // — visible as fog lifting off the edge of the map.
  const edges: Segment[] = [
    { a: { x: 0, y: 0 }, b: { x: bounds.width, y: 0 } },
    { a: { x: bounds.width, y: 0 }, b: { x: bounds.width, y: bounds.height } },
    { a: { x: bounds.width, y: bounds.height }, b: { x: 0, y: bounds.height } },
    { a: { x: 0, y: bounds.height }, b: { x: 0, y: 0 } },
  ]
  const all = [...segments, ...edges]

  // The furthest anything can be seen: the sight range, or the map's diagonal
  // when sight is unlimited. A finite cap is needed either way, because a ray
  // that hits nothing has to stop somewhere.
  const diagonal = Math.hypot(bounds.width, bounds.height)
  const reach = Number.isFinite(radius) ? Math.min(radius, diagonal) : diagonal

  const angles: number[] = []
  for (const seg of all) {
    for (const p of [seg.a, seg.b]) {
      const base = Math.atan2(p.y - origin.y, p.x - origin.x)
      // The three-ray trick: at the corner, and a hair either side. Normalised
      // so every angle in this list is on the same scale — see normaliseAngle.
      angles.push(
        normaliseAngle(base - ANGLE_EPSILON),
        normaliseAngle(base),
        normaliseAngle(base + ANGLE_EPSILON),
      )
    }
  }
  // Rays around the sight circle, so an unobstructed view is round rather than
  // an arbitrary polygon joining whatever corners happened to exist.
  for (let i = 0; i < CIRCLE_RAYS; i++) {
    angles.push((i / CIRCLE_RAYS) * Math.PI * 2)
  }

  const hits: { angle: number; point: Point }[] = []
  for (const angle of angles) {
    let nearest = reach
    for (const seg of all) {
      const t = rayHit(origin, angle, seg)
      if (t !== null && t < nearest) nearest = t
    }
    hits.push({
      angle,
      point: {
        x: origin.x + Math.cos(angle) * nearest,
        y: origin.y + Math.sin(angle) * nearest,
      },
    })
  }

  hits.sort((a, b) => a.angle - b.angle)
  const polygon = hits.map((h) => h.point)

  // A degenerate result (a viewpoint exactly on a corner, say) would be an
  // unrenderable polygon. Returning a tiny triangle keeps every caller simple;
  // it shows as "sees almost nothing", which is the honest answer.
  if (polygon.length < 3) {
    return [
      { x: origin.x, y: origin.y },
      { x: origin.x + 1, y: origin.y },
      { x: origin.x, y: origin.y + 1 },
    ]
  }
  return polygon
}

/**
 * Is `target` inside the polygon? Ray-casting parity test.
 *
 * Used by tests, and by any caller wanting to ask "can this token see that one?"
 * without re-deriving the geometry.
 *
 * @param target - The point to test.
 * @param polygon - Polygon vertices in order.
 */
export function pointInPolygon(target: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    // The `!==` on the y-comparisons is what makes a vertex count once rather
    // than twice — the standard fix for a ray passing exactly through a corner,
    // which otherwise flips parity twice and reports inside as outside.
    const intersects =
      a.y > target.y !== b.y > target.y &&
      target.x < ((b.x - a.x) * (target.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Converts a sight range in grid squares to map pixels.
 *
 * @param squares - Range in squares, or null for unlimited (0062).
 * @param gridSize - The map's current grid size in pixels.
 * @returns Radius in map pixels; Infinity when unlimited.
 */
export function sightRadiusPx(squares: number | null, gridSize: number): number {
  if (squares === null || squares === undefined) return Infinity
  return squares * gridSize
}

/**
 * Is any part of a circular token inside the visible area?
 *
 * Tests the centre plus points around the rim, rather than the centre alone. A
 * token standing just behind a wall corner can have its centre in shadow while
 * half of it is lit — testing only the centre makes it vanish entirely, which
 * looks like a bug and, worse, hides a creature the party can genuinely see.
 *
 * Sampling rather than exact circle-polygon intersection: exact is real
 * geometry with real edge cases, and this decides only whether to RENDER the
 * token — the clip path then decides which pixels of it show, exactly. A sample
 * that misses by a few degrees costs nothing the clip does not already fix.
 *
 * @param centre - Token centre in map pixels.
 * @param radius - Token radius in map pixels.
 * @param polygons - The visible areas.
 * @param samples - Rim points to test (default 12, i.e. every 30 degrees).
 * @returns True if the centre or any sampled rim point is visible.
 */
export function tokenTouchesVision(
  centre: Point,
  radius: number,
  polygons: Point[][],
  samples = 12,
): boolean {
  if (polygons.length === 0) return false
  if (polygons.some((poly) => pointInPolygon(centre, poly))) return true
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2
    const p = { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius }
    if (polygons.some((poly) => pointInPolygon(p, poly))) return true
  }
  return false
}
