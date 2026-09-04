/**
 * A tiny cache of precomputed visibility, keyed by where the token is standing.
 *
 * WHAT THIS IS FOR. A player's client is never sent the walls (migration 0061),
 * so it cannot work out what it can see — it must ask the server, and that round
 * trip is what makes fog lag a move. The server, which HAS the walls, can just
 * as cheaply answer for the eight squares around you as for the one you are on,
 * so a single step is then answered from memory and the fog changes with the
 * move rather than after it.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not a growing map of everywhere you have
 * been. Every response REPLACES the cache wholesale, which is what keeps a wall
 * the DM has just drawn or erased from being answered out of a stale entry. A
 * cache that accumulates would be faster and would eventually show a player a
 * doorway that is no longer there — and that failure would appear long after the
 * change that caused it.
 *
 * THE LEAK, STATED PLAINLY. Holding the neighbouring squares' polygons means a
 * player's browser knows what it would see one step away in any direction,
 * slightly before they take that step. They learn the same thing by stepping.
 * This is a real cost and a bounded one; it is not the same order of thing as
 * shipping the wall geometry itself, which is what this whole design avoids.
 */

/** One position's answer: what may be seen there, and where it may be moved. */
export interface CachedVision {
  polygons: [number, number][][]
  movePolygons: [number, number][][]
}

/**
 * The cache key for a position.
 *
 * Rounded to whole map pixels because that is what the database stores — token
 * x/y are integers — so the client and the server arrive at the same key by
 * doing the same arithmetic. A fractional coordinate would simply miss and fall
 * back to the network, which is the safe direction to fail in.
 */
export function cellKey(p: { x: number; y: number }): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`
}

/**
 * Builds a fresh cache from a server response.
 *
 * @param anchor - The position the response was computed FOR.
 * @param at - Vision at the anchor itself.
 * @param neighbours - Vision at the surrounding squares, as returned by the
 *        `vision` Edge Function. Empty when the server declined to precompute
 *        them (see its NEIGHBOUR_SEGMENT_CAP) — in which case this is a
 *        one-entry cache and every move costs a round trip, exactly as before.
 * @returns A map from position key to vision, replacing any previous cache.
 */
export function buildVisionCache(
  anchor: { x: number; y: number },
  at: CachedVision,
  neighbours: { at: [number, number]; polygons: [number, number][][]; movePolygons: [number, number][][] }[],
): Map<string, CachedVision> {
  const cache = new Map<string, CachedVision>()
  cache.set(cellKey(anchor), at)
  for (const n of neighbours) {
    cache.set(cellKey({ x: n.at[0], y: n.at[1] }), {
      polygons: n.polygons,
      movePolygons: n.movePolygons,
    })
  }
  return cache
}

/**
 * Looks up a position, or null.
 *
 * A miss is not an error — it means the step went somewhere the server did not
 * precompute (a diagonal beyond the ring, a clamp at the map edge, a jump by
 * drag) and the caller should fall back to asking. Returning null rather than
 * stale-but-close vision is deliberate: showing a player the light from the
 * wrong square is worse than showing them the light a moment late.
 */
export function lookupVision(
  cache: Map<string, CachedVision> | null,
  p: { x: number; y: number },
): CachedVision | null {
  if (!cache) return null
  return cache.get(cellKey(p)) ?? null
}
