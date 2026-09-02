/**
 * Tests for the visibility computation (Phase 9.3).
 *
 * This is the most consequential geometry in the project: a sign error here is
 * invisible on screen until a player sees through a wall, and "the fog looked
 * about right" is not evidence of anything. The cases are written as
 * can-A-see-B questions, because that is the actual question the feature
 * answers — asserting exact polygon vertices would pin the implementation rather
 * than the behaviour, and would break every time the ray count changed.
 */
import { describe, expect, it } from 'vitest'
import {
  pointInPolygon,
  rayHit,
  sightRadiusPx,
  tokenTouchesVision,
  visibilityPolygon,
} from './vision'
import { segmentsOf } from './walls'

const BOUNDS = { width: 1000, height: 1000 }

/** Can a viewer at `from` see `target`, given these walls? */
function canSee(
  from: { x: number; y: number },
  target: { x: number; y: number },
  segments: Parameters<typeof visibilityPolygon>[1],
  radius = Infinity,
) {
  return pointInPolygon(target, visibilityPolygon(from, segments, radius, BOUNDS))
}

/** A vertical wall from (x, y0) to (x, y1). */
const vwall = (x: number, y0: number, y1: number) => ({ a: { x, y: y0 }, b: { x, y: y1 } })

describe('rayHit', () => {
  it('finds a hit straight ahead', () => {
    expect(rayHit({ x: 0, y: 0 }, 0, vwall(10, -5, 5))).toBeCloseTo(10)
  })

  it('does NOT report a wall behind the viewer', () => {
    // Forgetting the t < 0 check is the classic way to see through walls in one
    // direction only — and it looks correct half the time, which is worse.
    expect(rayHit({ x: 0, y: 0 }, 0, vwall(-10, -5, 5))).toBeNull()
  })

  it('misses when the ray passes the end of the segment', () => {
    // u outside 0..1: the infinite LINE is hit, the segment is not.
    expect(rayHit({ x: 0, y: 0 }, 0, vwall(10, 50, 60))).toBeNull()
  })

  it('treats a parallel ray as a miss rather than dividing by zero', () => {
    const horizontal = { a: { x: 5, y: 0 }, b: { x: 20, y: 0 } }
    expect(rayHit({ x: 0, y: 0 }, 0, horizontal)).toBeNull()
  })
})

describe('visibilityPolygon — walls actually block', () => {
  const wall = vwall(500, 0, 1000) // full-height wall down the middle

  it('sees a point on its own side', () => {
    expect(canSee({ x: 100, y: 500 }, { x: 300, y: 500 }, [wall])).toBe(true)
  })

  it('CANNOT see through the wall', () => {
    // The headline assertion of the whole phase.
    expect(canSee({ x: 100, y: 500 }, { x: 900, y: 500 }, [wall])).toBe(false)
  })

  it('sees round the end of a partial wall', () => {
    // A wall that stops short must not block what is past its end — the failure
    // that makes every wall behave like a full-height one.
    const partial = vwall(500, 0, 400)
    expect(canSee({ x: 100, y: 900 }, { x: 900, y: 900 }, [partial])).toBe(true)
  })

  it('is blocked in BOTH directions by the same wall', () => {
    // Symmetry is the cheap check that catches a sign error in the ray test.
    expect(canSee({ x: 900, y: 500 }, { x: 100, y: 500 }, [wall])).toBe(false)
  })

  it('sees everything when there are no walls at all', () => {
    // This is the test that caught the angle-convention bug: Math.atan2 returns
    // (-π, π] while the circle rays were generated as 0..2π, so sorting the
    // mixture produced a self-crossing polygon. The symptom was a viewer in an
    // EMPTY room unable to see to their left — which reads as a wall bug and is
    // not one. All four quadrants are checked, because the failure was
    // directional and two of these passed while the others did not.
    for (const p of [
      { x: 10, y: 10 },
      { x: 990, y: 990 },
      { x: 10, y: 990 },
      { x: 990, y: 10 },
      { x: 500, y: 10 },
      { x: 10, y: 500 },
    ]) {
      expect(canSee({ x: 500, y: 500 }, p, [])).toBe(true)
    }
  })
})

describe('visibilityPolygon — a closed room', () => {
  // A room via segmentsOf, so the closing edge comes from the same code the app
  // uses. A missing closing edge is a room with an invisible doorway.
  const room = segmentsOf(
    [
      { x: 300, y: 300 },
      { x: 700, y: 300 },
      { x: 700, y: 700 },
      { x: 300, y: 700 },
    ],
    true,
  )

  it('someone inside cannot see out', () => {
    expect(canSee({ x: 500, y: 500 }, { x: 900, y: 500 }, room)).toBe(false)
    expect(canSee({ x: 500, y: 500 }, { x: 500, y: 100 }, room)).toBe(false)
  })

  it('someone inside CAN see the rest of the room', () => {
    expect(canSee({ x: 400, y: 400 }, { x: 650, y: 650 }, room)).toBe(true)
  })

  it('someone outside cannot see in', () => {
    expect(canSee({ x: 900, y: 500 }, { x: 500, y: 500 }, room)).toBe(false)
  })

  it('leaks through a gap where a wall is missing — as it should', () => {
    // The same room with one side omitted: a doorway must let sight through, or
    // "walls block sight" is really "any wall shape is a sealed box".
    const open = segmentsOf(
      [
        { x: 300, y: 300 },
        { x: 700, y: 300 },
        { x: 700, y: 700 },
        { x: 300, y: 700 },
      ],
      false,
    )
    expect(canSee({ x: 500, y: 500 }, { x: 100, y: 500 }, open)).toBe(true)
  })
})

describe('visibilityPolygon — sight range', () => {
  it('cannot see beyond the range even with no walls', () => {
    expect(canSee({ x: 500, y: 500 }, { x: 900, y: 500 }, [], 100)).toBe(false)
  })

  it('can see within the range', () => {
    expect(canSee({ x: 500, y: 500 }, { x: 560, y: 500 }, [], 100)).toBe(true)
  })

  it('range and walls both apply — the nearer limit wins', () => {
    const wall = vwall(550, 0, 1000)
    // Inside the range but behind the wall.
    expect(canSee({ x: 500, y: 500 }, { x: 580, y: 500 }, [wall], 200)).toBe(false)
    // Past the range but with nothing in the way.
    expect(canSee({ x: 500, y: 500 }, { x: 400, y: 500 }, [wall], 50)).toBe(false)
  })

  it('a blind token (range 0) sees nothing', () => {
    expect(canSee({ x: 500, y: 500 }, { x: 510, y: 500 }, [], 0)).toBe(false)
  })
})

describe('visibilityPolygon — robustness', () => {
  it('never returns fewer than 3 points', () => {
    // Callers render this directly; a 2-point polygon is not drawable.
    expect(visibilityPolygon({ x: 500, y: 500 }, [], 0, BOUNDS).length).toBeGreaterThanOrEqual(3)
  })

  it('stays inside the map when sight is unlimited', () => {
    // Without the map edges acting as walls, rays escape and the polygon bulges
    // past the picture — visible as fog lifting off the edge of the map.
    const poly = visibilityPolygon({ x: 500, y: 500 }, [], Infinity, BOUNDS)
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(-0.01)
      expect(p.x).toBeLessThanOrEqual(BOUNDS.width + 0.01)
      expect(p.y).toBeGreaterThanOrEqual(-0.01)
      expect(p.y).toBeLessThanOrEqual(BOUNDS.height + 0.01)
    }
  })

  it('produces no NaN vertices for a viewer standing ON a wall endpoint', () => {
    // A DM can and will drop a token exactly on a corner. A NaN vertex blanks
    // the whole fog path, which fails OPEN — the map would be fully visible.
    const poly = visibilityPolygon({ x: 500, y: 500 }, [vwall(500, 500, 800)], 300, BOUNDS)
    for (const p of poly) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('handles a zero-length wall without hanging or NaN', () => {
    const degenerate = { a: { x: 200, y: 200 }, b: { x: 200, y: 200 } }
    const poly = visibilityPolygon({ x: 500, y: 500 }, [degenerate], 400, BOUNDS)
    expect(poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('is fast enough to run per token per move', () => {
    // 40 walls is a busy dungeon. If this is slow, every token drag is slow for
    // everyone, so the budget is pinned rather than assumed.
    const many = Array.from({ length: 40 }, (_, i) => vwall(50 + i * 20, 100, 900))
    const started = performance.now()
    for (let i = 0; i < 20; i++) visibilityPolygon({ x: 500, y: 500 }, many, Infinity, BOUNDS)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('sightRadiusPx', () => {
  it('converts squares to pixels using the map grid', () => {
    expect(sightRadiusPx(12, 70)).toBe(840)
  })

  it('treats null as unlimited, not as zero', () => {
    // Zero is a real value (a blinded creature); null means "not configured",
    // and a token nobody has configured must not be blind.
    expect(sightRadiusPx(null, 70)).toBe(Infinity)
    expect(sightRadiusPx(0, 70)).toBe(0)
  })

  it('follows a re-grid, which is why range is stored in squares', () => {
    expect(sightRadiusPx(12, 64)).toBe(768)
  })
})

describe('tokenTouchesVision', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('sees a token well inside', () => {
    expect(tokenTouchesVision({ x: 50, y: 50 }, 10, [square])).toBe(true)
  })

  it('hides a token well outside', () => {
    expect(tokenTouchesVision({ x: 500, y: 500 }, 10, [square])).toBe(false)
  })

  it('SEES a token whose centre is outside but whose edge is not', () => {
    // The case the centre-only test got wrong: a creature standing just past a
    // corner, half-lit. Hiding it entirely looks like a bug AND conceals someone
    // the party can genuinely see.
    expect(tokenTouchesVision({ x: 108, y: 50 }, 20, [square])).toBe(true)
  })

  it('hides a token that only just fails to reach', () => {
    expect(tokenTouchesVision({ x: 130, y: 50 }, 20, [square])).toBe(false)
  })

  it('treats no polygons as seeing nothing — failing closed', () => {
    expect(tokenTouchesVision({ x: 50, y: 50 }, 10, [])).toBe(false)
  })

  it('checks every polygon, not just the first', () => {
    // A player with two tokens has two lit areas; a creature in the second must
    // not be hidden because it is missing from the first.
    const far = [
      { x: 400, y: 400 },
      { x: 500, y: 400 },
      { x: 500, y: 500 },
      { x: 400, y: 500 },
    ]
    expect(tokenTouchesVision({ x: 450, y: 450 }, 10, [square, far])).toBe(true)
  })
})
