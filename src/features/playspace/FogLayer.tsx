/**
 * FogLayer — draws what a player CANNOT see (Phase 9.3.2).
 *
 * Renders a dark sheet over the whole map with the player's visibility polygons
 * punched out of it. The polygons come from the `vision` Edge Function; this
 * component never sees a wall, which is the entire point of migration 0061 —
 * there is nothing here to extract from the DOM but the shape of what the player
 * is already looking at.
 *
 * HOW THE HOLE IS MADE. An SVG `<mask>`: white shows the fog, black hides it. So
 * the mask is a white rectangle (fog everywhere) with the visibility polygons
 * filled black (holes). Several polygons — a player with more than one token —
 * simply overlap in the mask, which is why the server does not need to union
 * them and no polygon boolean arithmetic exists anywhere in this project.
 *
 * WHY NOT `clip-path`: a clip keeps what is INSIDE the shape, and we need the
 * inverse. Doing it with a clip means computing the complement of the polygon
 * against the map rectangle, which is real geometry with real edge cases, for
 * exactly the same pixels.
 *
 * FAILING CLOSED. An empty polygon list fogs everything. That is what a player
 * with no token on the map gets, and what a failed request gets — see
 * `fetchVision`. Showing the map on error would defeat the feature at the worst
 * moment.
 */
import { useId } from 'react'
import type { PlayspaceMap } from './api'

/**
 * @param map - The map, for its pixel dimensions (the SVG's coordinate space).
 * @param polygons - Visible areas, in map pixels. Empty means "see nothing".
 * @param opacity - How dense to draw it (0065). Safe to lower ONLY because
 *        tokens are clipped to the visible area elsewhere — otherwise this is
 *        the setting that reintroduces the leak it was fixed for.
 */
export function FogLayer({
  map,
  polygons,
  opacity = 1,
}: {
  map: PlayspaceMap
  polygons: [number, number][][]
  opacity?: number
}) {
  // useId, not a constant: two maps could be mounted at once (the workspace and
  // a floating panel), and duplicate mask ids in one document silently make the
  // second one use the first's mask.
  const maskId = `fog-${useId().replace(/:/g, '')}`

  return (
    <svg
      viewBox={`0 0 ${map.width_px} ${map.height_px}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // Never intercepts anything: a player must still be able to drag their
        // own token through the fog they are standing in.
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <defs>
        <mask id={maskId}>
          {/* White = fogged. */}
          <rect x={0} y={0} width={map.width_px} height={map.height_px} fill="white" />
          {/* Black = visible. Overlapping polygons union for free. */}
          {polygons.map((poly, i) => (
            <polygon key={i} points={poly.map(([x, y]) => `${x},${y}`).join(' ')} fill="black" />
          ))}
        </mask>
      </defs>
      {/* Density is the DM's choice (0065), defaulting to fully opaque.
          
          It was briefly hard-coded at 0.92, and that was a leak: 8% of a bright
          token portrait is perfectly readable against dark, so every monster
          behind a wall showed as a faint disc. The fix was not "make fog
          opaque" but "stop drawing tokens that are not visible" — once tokens
          are clipped to the lit area, this opacity governs only the TERRAIN, and
          a DM can safely let the party sense the shape of the room they are in.
          
          The general lesson stands: partial fog does not hide things partially.
          It hides the floor partially and gives away everything standing on it,
          because the things that matter are the high-contrast ones. */}
      <rect
        x={0}
        y={0}
        width={map.width_px}
        height={map.height_px}
        fill="#05070d"
        opacity={opacity}
        mask={`url(#${maskId})`}
      />
    </svg>
  )
}
