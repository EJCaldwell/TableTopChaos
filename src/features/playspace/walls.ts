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
