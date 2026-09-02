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
import type { Point, Segment } from './walls'

export type { Point, Segment }

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
