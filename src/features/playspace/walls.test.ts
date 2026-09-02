/**
 * Tests for the wall geometry (Phase 9.2.2).
 *
 * This is the half of the wall tools that fails invisibly: a stroke that exceeds
 * the database's point limit only fails at save time, a closed shape missing its
 * final edge leaks sight through a wall that looks solid, and a NaN coordinate
 * blanks an entire SVG element rather than one path. None of those are things a
 * DM would notice while drawing.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_WALL_POINTS,
  distanceToSegment,
  pointsFromJson,
  pointsToJson,
  rectPoints,
  segmentsOf,
  simplifyStroke,
  snapToGridCorner,
  toSvgPath,
} from './walls'

describe('rectPoints', () => {
  it('returns corners in path order, not diagonal order', () => {
    // Listing opposite corners consecutively draws a bow-tie, not a rectangle.
    expect(rectPoints({ x: 0, y: 0 }, { x: 10, y: 5 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])
  })

  it('works for a drag in any direction', () => {
    // Dragging up-and-left is not a mistake.
    const up = rectPoints({ x: 10, y: 10 }, { x: 0, y: 0 })
    expect(up).toHaveLength(4)
    expect(new Set(up.map((p) => `${p.x},${p.y}`)).size).toBe(4)
  })
})

describe('segmentsOf', () => {
  it('makes one segment per edge of an open path', () => {
    const segs = segmentsOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    expect(segs).toHaveLength(2)
  })

  it('adds the closing edge for a closed shape', () => {
    // Without it, sight leaks through the gap where the loop closes — a room
    // with an invisible doorway, and it looks solid on screen.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(segmentsOf(pts, false)).toHaveLength(2)
    const closed = segmentsOf(pts, true)
    expect(closed).toHaveLength(3)
    expect(closed[2]).toEqual({ a: { x: 10, y: 10 }, b: { x: 0, y: 0 } })
  })

  it('does not add a duplicate closing edge to a two-point line', () => {
    // Closing a segment would produce the same edge twice, which doubles its
    // cost in the sight calculation for no effect.
    expect(segmentsOf([{ x: 0, y: 0 }, { x: 10, y: 0 }], true)).toHaveLength(1)
  })

  it('returns nothing for a degenerate wall', () => {
    // A zero-length segment has no direction and makes a ray cast divide by zero.
    expect(segmentsOf([])).toEqual([])
    expect(segmentsOf([{ x: 1, y: 1 }])).toEqual([])
  })
})

describe('distanceToSegment', () => {
  it('measures perpendicular distance to the line', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
  })

  it('measures to the ENDPOINT for a point beyond the segment', () => {
    // Using the infinite line here would under-measure and simplify away real
    // corners at the end of a short segment.
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10)
  })

  it('handles a zero-length segment without returning NaN', () => {
    // NaN compares false against every tolerance, so RDP would keep every point
    // forever and the stroke would never simplify.
    const d = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    expect(d).toBe(5)
  })
})

describe('simplifyStroke', () => {
  it('collapses a straight drag to its endpoints', () => {
    const straight = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }))
    expect(simplifyStroke(straight)).toEqual([{ x: 0, y: 0 }, { x: 99, y: 0 }])
  })

  it('KEEPS a corner', () => {
    // The whole point: wobble goes, shape stays.
    const corner = [
      ...Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })),
      ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i })),
    ]
    const out = simplifyStroke(corner)
    expect(out.length).toBeLessThan(10)
    expect(out.some((p) => p.x === 49 && p.y === 0)).toBe(true)
  })

  it('always keeps the first and last point', () => {
    // The last point is where the DM let go; losing it shortens the wall.
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 20 }))
    const out = simplifyStroke(pts)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('never exceeds the database limit, even for a dense scribble', () => {
    // This is the guarantee that matters: without it a long freehand wall fails
    // at SAVE time, after the DM has already drawn it.
    //
    // It also caught a performance defect. At 12000 points this took 2.8s —
    // which in the app is not a slow test but a page frozen at the moment the
    // DM releases the mouse. simplifyStroke now strides the input down before
    // recursing; the assertion below pins the cost so a future change cannot
    // quietly reintroduce it.
    const scribble = Array.from({ length: 12000 }, (_, i) => ({
      x: (i % 2 === 0 ? i : -i) % 3000,
      y: (i % 3 === 0 ? -i : i) % 3000,
    }))
    const started = performance.now()
    const out = simplifyStroke(scribble, 0)
    const elapsed = performance.now() - started
    expect(out.length).toBeLessThanOrEqual(MAX_WALL_POINTS)
    expect(out.length).toBeGreaterThan(1)
    // Deliberately loose. It flaked at 500ms when the full suite runs files in
    // parallel — and a flaky test is worse than no test, because it trains you
    // to re-run rather than to look. 1500 still fails on the 2.8s regression
    // this exists to catch, which is the only thing it is for; it is not a
    // benchmark.
    expect(elapsed).toBeLessThan(1500)
  })

  it('leaves a two-point stroke alone', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }]
    expect(simplifyStroke(pts)).toEqual(pts)
  })

  it('does not mutate its input', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 10, y: 0 }]
    simplifyStroke(pts)
    expect(pts).toHaveLength(3)
  })
})

describe('toSvgPath', () => {
  it('emits a move and lines', () => {
    expect(toSvgPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0 0 L 10 5')
  })

  it('closes a closed shape', () => {
    expect(toSvgPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)).toContain('Z')
  })

  it('returns empty for a degenerate wall rather than a broken path', () => {
    expect(toSvgPath([])).toBe('')
    expect(toSvgPath([{ x: 1, y: 1 }])).toBe('')
  })
})

describe('pointsFromJson / pointsToJson', () => {
  it('round-trips', () => {
    const pts = [{ x: 1, y: 2 }, { x: 30, y: 40 }]
    expect(pointsFromJson(pointsToJson(pts))).toEqual(pts)
  })

  it('rounds on the way out', () => {
    // Sub-pixel precision on a wall is meaningless and doubles the stored size
    // of a long stroke.
    expect(pointsToJson([{ x: 1.4, y: 2.6 }])).toEqual([[1, 3]])
  })

  it('drops malformed entries instead of rendering NaN', () => {
    // A NaN coordinate silently blanks the WHOLE svg path element — taking
    // every other wall drawn in it along too.
    expect(
      pointsFromJson([[0, 0], ['a', 1], [10], null, [1, 2, 3], [5, 5]]),
    ).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }])
  })

  it('drops non-finite numbers', () => {
    expect(pointsFromJson([[0, 0], [Infinity, 1], [NaN, 2]])).toEqual([{ x: 0, y: 0 }])
  })

  it('returns empty for anything that is not an array', () => {
    for (const v of [null, undefined, {}, 'x', 42]) {
      expect(pointsFromJson(v)).toEqual([])
    }
  })
})

describe('snapToGridCorner', () => {
  it('snaps to intersections, not cell centres', () => {
    // A wall runs ALONG the edges of squares; a token stands IN one. Snapping
    // wall endpoints to centres puts every wall half a square off the grid it
    // is meant to follow.
    expect(snapToGridCorner({ x: 66, y: 5 }, 70)).toEqual({ x: 70, y: 0 })
    // 34 is nearer 0 than 70, so it snaps back to the origin — NOT to 70. The
    // cell-centre function would send it to 35; this one must not.
    expect(snapToGridCorner({ x: 34, y: 34 }, 70)).toEqual({ x: 0, y: 0 })
    expect(snapToGridCorner({ x: 40, y: 40 }, 70)).toEqual({ x: 70, y: 70 })
  })

  it('rounds to the NEAREST line, not the one before', () => {
    expect(snapToGridCorner({ x: 104, y: 0 }, 70).x).toBe(70)
    expect(snapToGridCorner({ x: 106, y: 0 }, 70).x).toBe(140)
  })

  it('follows a shifted grid', () => {
    // Otherwise a DM who aligned the overlay to the picture finds walls snapping
    // to an imaginary unshifted grid instead.
    expect(snapToGridCorner({ x: 66, y: 0 }, 70, { x: 20, y: 0 }).x).toBe(90)
  })

  it('handles negative coordinates symmetrically', () => {
    expect(snapToGridCorner({ x: -66, y: 0 }, 70).x).toBe(-70)
  })

  it('leaves the point alone for a nonsense grid', () => {
    for (const g of [0, -70, Number.NaN]) {
      expect(snapToGridCorner({ x: 123, y: 456 }, g)).toEqual({ x: 123, y: 456 })
    }
  })
})
