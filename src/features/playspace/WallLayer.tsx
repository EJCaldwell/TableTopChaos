/**
 * WallLayer — draws and edits sight-blocking walls (Phase 9.2.2).
 *
 * DM-ONLY, and not merely by being hidden: migration 0061 makes walls
 * unreadable to anyone else, so a player's `listWalls` returns an empty array
 * and this renders nothing even if it were mounted. The gating here is for
 * tidiness; RLS is the rule.
 *
 * WHY AN SVG OVERLAY rather than more absolutely-positioned divs like the
 * tokens. A wall is a path, often a long freehand one, and a div can only be a
 * rectangle. The SVG uses a viewBox of the map's own pixel dimensions, so map
 * pixels ARE the path's coordinate units — no scaling arithmetic here at all,
 * the same trick that lets tokens position in percent.
 *
 * `vector-effect: non-scaling-stroke` keeps walls the same visual thickness at
 * every zoom. Without it a wall drawn at 100% becomes a hairline when you zoom
 * out to check the whole map, which is exactly when you want to see the layout.
 *
 * All geometry lives in ./walls.ts and is unit-tested; this file owns pointer
 * handling and nothing else.
 */
import { useRef, useState } from 'react'
import {
  pointsFromJson,
  pointsToJson,
  rectPoints,
  simplifyStroke,
  toSvgPath,
  type Point,
} from './walls'
import type { PlayspaceMap, PlayspaceWall, WallKind } from './api'

/** Which wall tool is active. 'none' means tokens are draggable as usual. */
export type WallTool = 'none' | 'segment' | 'rect' | 'freehand' | 'erase'

/**
 * @param map - The map being drawn on, for its pixel dimensions.
 * @param walls - Existing walls (DM's own read; empty for everyone else).
 * @param tool - The active tool. 'none' makes this layer click-through so it
 *        never steals a token drag.
 * @param onCreate - Called with a finished wall. The caller persists it.
 * @param onErase - Called with a wall id when the erase tool hits one.
 */
export function WallLayer({
  map,
  walls,
  tool,
  onCreate,
  onErase,
}: {
  map: PlayspaceMap
  walls: PlayspaceWall[]
  tool: WallTool
  onCreate: (kind: WallKind, points: [number, number][], closed: boolean) => void
  onErase: (wallId: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  /** The stroke in progress, in map pixels. Empty when not drawing. */
  const [draft, setDraft] = useState<Point[]>([])
  const drawingRef = useRef(false)

  /**
   * Converts a pointer event to map pixels.
   *
   * Uses the SVG element's own rect rather than the map div's: they are the same
   * box, but reading the element the coordinates will be drawn into removes any
   * chance of the two drifting apart if the layout changes.
   */
  function toMap(e: React.PointerEvent): Point | null {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * map.width_px,
      y: ((e.clientY - rect.top) / rect.height) * map.height_px,
    }
  }

  function handleDown(e: React.PointerEvent) {
    if (tool === 'none' || tool === 'erase') return
    const p = toMap(e)
    if (!p) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    setDraft([p, p])
  }

  function handleMove(e: React.PointerEvent) {
    if (!drawingRef.current) return
    const p = toMap(e)
    if (!p) return
    setDraft((prev) => {
      if (prev.length === 0) return prev
      // Segment and rect are defined by exactly two points — the anchor and
      // wherever the pointer is now — so the second point is REPLACED, not
      // appended. Freehand accumulates.
      if (tool === 'freehand') return [...prev, p]
      return [prev[0], p]
    })
  }

  function handleUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = draft
    setDraft([])
    if (stroke.length < 2) return

    if (tool === 'rect') {
      const pts = rectPoints(stroke[0], stroke[stroke.length - 1])
      // Zero-area rectangles come from a click that did not become a drag. They
      // would store four identical points and block nothing.
      if (pts[0].x === pts[1].x || pts[0].y === pts[2].y) return
      onCreate('rect', pointsToJson(pts), true)
      return
    }
    if (tool === 'segment') {
      const [a, b] = [stroke[0], stroke[stroke.length - 1]]
      if (a.x === b.x && a.y === b.y) return
      onCreate('segment', pointsToJson([a, b]), false)
      return
    }
    // Freehand: simplify BEFORE storing. simplifyStroke guarantees the database
    // limit, so a long wall cannot fail at save time after being drawn.
    const simplified = simplifyStroke(stroke)
    if (simplified.length < 2) return
    onCreate('freehand', pointsToJson(simplified), false)
  }

  /** Preview geometry for the stroke in progress. */
  const preview =
    draft.length < 2
      ? null
      : tool === 'rect'
        ? { points: rectPoints(draft[0], draft[draft.length - 1]), closed: true }
        : { points: draft, closed: false }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${map.width_px} ${map.height_px}`}
      preserveAspectRatio="none"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // Click-through unless a tool is active, so the wall layer never steals
        // a token drag. This is why it can sit above the tokens without being in
        // the way — walls must draw ON TOP to be visible over a crowded map.
        pointerEvents: tool === 'none' ? 'none' : 'auto',
        cursor: tool === 'erase' ? 'not-allowed' : tool === 'none' ? 'default' : 'crosshair',
        touchAction: 'none',
      }}
    >
      {walls.map((w) => {
        const pts = pointsFromJson(w.points)
        const d = toSvgPath(pts, w.closed)
        if (!d) return null
        return (
          <g key={w.id}>
            {/* A wide, invisible copy under each wall: a 3px line is almost
                impossible to click, and an eraser you have to aim at is worse
                than no eraser. Only interactive while erasing. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={18}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: tool === 'erase' ? 'stroke' : 'none' }}
              onPointerDown={(e) => {
                if (tool !== 'erase') return
                e.stopPropagation()
                onErase(w.id)
              }}
            />
            <path
              d={d}
              fill="none"
              stroke="var(--color-danger)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
              opacity={0.85}
            />
          </g>
        )
      })}

      {preview && (
        <path
          d={toSvgPath(preview.points, preview.closed)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={3}
          strokeDasharray="6 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}
