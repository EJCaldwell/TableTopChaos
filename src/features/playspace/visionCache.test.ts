/**
 * Tests for the neighbourhood vision cache (9.3, 2026-09-02).
 *
 * The cache is small and its bugs are not: a stale hit shows a player light from
 * a doorway that no longer exists, and would do so long after the DM changed it.
 * These assert the REPLACEMENT behaviour and the miss behaviour, which are the
 * two rules that keep that from happening.
 */
import { describe, expect, it } from 'vitest'
import { buildVisionCache, cellKey, lookupVision } from './visionCache'

const V = (tag: number) => ({
  polygons: [[[tag, tag]]] as [number, number][][],
  movePolygons: [[[tag, tag]]] as [number, number][][],
})

describe('cellKey', () => {
  it('rounds to whole pixels, because that is what the database stores', () => {
    // The server keys on stored integer coordinates. If the client keyed on
    // fractions the two would never agree and the cache would always miss —
    // silently, and looking exactly like the cache not working at all.
    expect(cellKey({ x: 70.4, y: 139.5 })).toBe(cellKey({ x: 70, y: 140 }))
  })

  it('distinguishes positions a pixel apart', () => {
    expect(cellKey({ x: 70, y: 70 })).not.toBe(cellKey({ x: 71, y: 70 }))
  })
})

describe('buildVisionCache', () => {
  it('holds the anchor and every neighbour', () => {
    const cache = buildVisionCache({ x: 100, y: 100 }, V(0), [
      { at: [170, 100], ...V(1) },
      { at: [30, 100], ...V(2) },
    ])
    expect(cache.size).toBe(3)
    expect(lookupVision(cache, { x: 170, y: 100 })).toEqual(V(1))
  })

  it('REPLACES rather than merging, so an erased wall cannot be answered from a stale entry', () => {
    // The rule the whole design rests on. A cache that accumulated would be
    // faster and would eventually show a doorway the DM had already removed —
    // a failure appearing long after the change that caused it.
    const first = buildVisionCache({ x: 100, y: 100 }, V(0), [{ at: [170, 100], ...V(1) }])
    const second = buildVisionCache({ x: 170, y: 100 }, V(9), [{ at: [240, 100], ...V(8) }])
    expect(lookupVision(second, { x: 100, y: 100 })).toBeNull()
    expect(first.size).toBe(2)
  })

  it('survives a server that sent no neighbours at all', () => {
    // The Edge Function declines to precompute on a very complex map. That must
    // degrade to one round trip per move, not to an error.
    const cache = buildVisionCache({ x: 100, y: 100 }, V(0), [])
    expect(cache.size).toBe(1)
    expect(lookupVision(cache, { x: 100, y: 100 })).toEqual(V(0))
  })
})

describe('lookupVision', () => {
  it('misses rather than returning nearby vision', () => {
    // Deliberate: light from the wrong square is worse than light a moment
    // late. A miss simply costs the round trip we always used to pay.
    const cache = buildVisionCache({ x: 100, y: 100 }, V(0), [])
    expect(lookupVision(cache, { x: 101, y: 100 })).toBeNull()
  })

  it('is null-safe before the first response has arrived', () => {
    expect(lookupVision(null, { x: 0, y: 0 })).toBeNull()
  })
})
