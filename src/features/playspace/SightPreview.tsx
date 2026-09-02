/**
 * SightPreview — shows the DM what one token can see (Phase 9.3, 2026-09-02).
 *
 * The DM selects a token and its line of sight is drawn over the map: bright
 * where that creature can see, outlined at the edge. It answers the question a
 * DM actually has mid-encounter — "can the goblin see them from there?" — which
 * was previously only answerable by signing in as somebody else.
 *
 * COMPUTED IN THE BROWSER, and it is the one place in this feature that can be.
 * A DM holds every wall already (RLS gives them the lot), so the same
 * `visibilityPolygon` the Edge Function runs can run here with no round trip and
 * no new endpoint. Migration 0061 forced the server-side path for PLAYERS, whose
 * clients have no walls — it never applied to the DM, and pretending otherwise
 * would have meant a slower feature for no gain.
 *
 * Deliberately not fog: this is an INSPECTION overlay, so it lights up what the
 * token sees rather than darkening what it does not. Fogging the DM's own view
 * would hide the thing they are usually looking at — the rest of the board — and
 * the DM is meant to see everything.
 */
import { useMemo } from 'react'
import { visibilityPolygon, sightRadiusPx } from './vision'
import { segmentsOf, pointsFromJson } from './walls'
import type { PlayspaceMap, PlayspaceToken, PlayspaceWall } from './api'

/**
 * @param map - The map, for bounds, grid size and the SVG coordinate space.
 * @param walls - Every wall on it (the DM's full set).
 * @param token - The token whose sight to draw.
 */
export function SightPreview({
  map,
  walls,
  token,
}: {
  map: PlayspaceMap
  walls: PlayspaceWall[]
  token: PlayspaceToken
}) {
  // Recomputed only when the geometry that matters changes — not on every
  // render, and not while some unrelated token moves. Sight range is part of the
  // key because changing it in the toolbar should redraw this immediately.
  const polygon = useMemo(() => {
    const segments = walls.flatMap((w) => segmentsOf(pointsFromJson(w.points), w.closed))
    return visibilityPolygon(
      { x: token.x, y: token.y },
      segments,
      sightRadiusPx(token.sight_squares, map.grid_size),
      { width: map.width_px, height: map.height_px },
    )
  }, [walls, token.x, token.y, token.sight_squares, map.width_px, map.height_px, map.grid_size])

  const points = polygon.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${map.width_px} ${map.height_px}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // Never intercepts: the DM must still be able to drag the very token
        // whose sight this is showing.
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      {/* Faint fill so the shape reads at a glance, plus a hard edge so the
          exact boundary is legible — a fill alone is ambiguous about where sight
          actually stops, which is the whole question being asked. */}
      <polygon
        points={points}
        fill="var(--color-accent)"
        fillOpacity={0.16}
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeDasharray="8 5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
