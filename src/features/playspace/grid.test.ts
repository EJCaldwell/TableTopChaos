/**
 * Tests for the battlemap coordinate maths (9.1.2).
 *
 * These exist so grid snapping and drop positioning are covered WITHOUT a
 * browser step. Everything here is a case a manual checklist would either miss
 * or state so vaguely ("snapping works") that it proves nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  clampToMap,
  clientToMap,
  combinedDelta,
  dropPosition,
  findFreeCell,
  gridLines,
  movementDelta,
  snapToGrid,
  snapToken,
} from './grid'

const MAP = { width_px: 1400, height_px: 900, grid_size: 70 }
/** A map element displayed at exactly half its intrinsic size. */
const HALF_RECT = { left: 0, top: 0, width: 700, height: 450 }

describe('snapToGrid', () => {
  it('snaps to cell CENTRES, not corners', () => {
    // A token drawn centred on a corner would straddle four cells.
    expect(snapToGrid({ x: 0, y: 0 }, 70)).toEqual({ x: 35, y: 35 })
    expect(snapToGrid({ x: 69, y: 1 }, 70)).toEqual({ x: 35, y: 35 })
    expect(snapToGrid({ x: 70, y: 70 }, 70)).toEqual({ x: 105, y: 105 })
  })

  it('sends every point in a cell to the same centre', () => {
    const centre = snapToGrid({ x: 140, y: 140 }, 70)
    for (const d of [0, 1, 34, 35, 69]) {
      expect(snapToGrid({ x: 140 + d, y: 140 + d }, 70)).toEqual(centre)
    }
  })

  it('leaves the point alone for a nonsense grid size', () => {
    // Guard against the failure that collapses every token onto the origin.
    for (const g of [0, -70, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(snapToGrid({ x: 123, y: 456 }, g)).toEqual({ x: 123, y: 456 })
    }
  })

  it('handles negative coordinates without flipping direction', () => {
    // Math.floor, not Math.trunc: trunc rounds toward zero and would make the
    // cell straddling the origin twice as wide.
    expect(snapToGrid({ x: -1, y: -1 }, 70)).toEqual({ x: -35, y: -35 })
  })
})

describe('clampToMap', () => {
  it('pulls out-of-bounds points back onto the map', () => {
    expect(clampToMap({ x: -50, y: 5000 }, MAP)).toEqual({ x: 0, y: 900 })
  })
  it('leaves in-bounds points untouched, edges included', () => {
    expect(clampToMap({ x: 0, y: 900 }, MAP)).toEqual({ x: 0, y: 900 })
    expect(clampToMap({ x: 700, y: 450 }, MAP)).toEqual({ x: 700, y: 450 })
  })
})

describe('clientToMap', () => {
  it('scales from on-screen size to map pixels', () => {
    // The whole point: the same drop lands in the same place at any display size.
    expect(clientToMap(350, 225, HALF_RECT, MAP)).toEqual({ x: 700, y: 450 })
    expect(clientToMap(350, 225, { left: 0, top: 0, width: 1400, height: 900 }, MAP))
      .toEqual({ x: 350, y: 225 })
  })

  it('accounts for the element not being at the viewport origin', () => {
    expect(clientToMap(450, 325, { left: 100, top: 100, width: 700, height: 450 }, MAP))
      .toEqual({ x: 700, y: 450 })
  })

  it('returns the origin rather than NaN for an unlaid-out element', () => {
    // width 0 would make the scale factor Infinity and corrupt the stored row.
    expect(clientToMap(10, 10, { left: 0, top: 0, width: 0, height: 0 }, MAP))
      .toEqual({ x: 0, y: 0 })
  })
})

describe('dropPosition', () => {
  it('snaps and clamps, and returns integers for int columns', () => {
    const p = dropPosition(350, 225, HALF_RECT, MAP, true)
    expect(p).toEqual({ x: 735, y: 455 })
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true)
  })

  it('does not snap when snapping is off', () => {
    expect(dropPosition(350, 225, HALF_RECT, MAP, false)).toEqual({ x: 700, y: 450 })
  })

  it('clamps AFTER snapping, so the result is always in bounds', () => {
    // The regression this ordering exists for: a drop past the right edge snaps
    // to a cell centre BEYOND the map, and only a bound that runs afterwards
    // brings it back. Bound-then-snap would return x = 1435 > width.
    //
    // This expectation has moved twice, and both moves were deliberate:
    //  - it was {1400, 900} — the map's corner, with the token half off it;
    //  - then {1365, 805}, when movement was briefly confined to cells WHOLLY
    //    inside the map;
    //  - now {1365, 865}, because edge tiles were restored at the owner's
    //    request. x snaps to the last column's centre (1365); y snaps to 875 in
    //    the partial bottom row and is pulled to 865 so the token — half a
    //    square, 35px — stays fully on the map.
    // The token may stand in a partial square; it may not hang off the edge.
    const p = dropPosition(9999, 9999, HALF_RECT, MAP, true, 35, 1)
    expect(p.x).toBeLessThanOrEqual(MAP.width_px)
    expect(p.y).toBeLessThanOrEqual(MAP.height_px)
    expect(p).toEqual({ x: 1365, y: 865 })
  })

  it('never returns a fractional coordinate, at any display scale', () => {
    const odd = { left: 0, top: 0, width: 333, height: 217 }
    for (let i = 0; i < 40; i++) {
      const p = dropPosition(i * 7, i * 5, odd, MAP, false)
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true)
    }
  })
})

describe('gridLines', () => {
  it('lays lines on interior cell boundaries only', () => {
    const lines = gridLines({ width_px: 280, height_px: 140, grid_size: 70 })
    // Not 0 and not the far edge — those are the map border, not grid lines.
    expect(lines?.vertical).toEqual([70, 140, 210])
    expect(lines?.horizontal).toEqual([70])
  })

  it('refuses to draw an absurdly dense grid instead of emitting 4000 nodes', () => {
    // The schema's worst case: maximum map, minimum grid.
    expect(gridLines({ width_px: 20000, height_px: 20000, grid_size: 10 })).toBeNull()
  })

  it('returns null for a nonsense grid size rather than looping forever', () => {
    // A zero step in the `for` loop would never terminate.
    expect(gridLines({ width_px: 1400, height_px: 900, grid_size: 0 })).toBeNull()
  })
})

describe('grid offset (0055)', () => {
  const OFF = { x: 20, y: 10 }

  it('shifts cell centres by the offset', () => {
    // Without an offset this point snaps to (35, 35).
    expect(snapToGrid({ x: 30, y: 30 }, 70, OFF)).toEqual({ x: 55, y: 45 })
  })

  it('keeps cells exactly one grid apart, not offset-by-a-rounding-error', () => {
    // The bug this guards: folding the offset inside floor() shifts the cell
    // BOUNDARIES rather than the whole lattice.
    const a = snapToGrid({ x: 25, y: 15 }, 70, OFF)
    const b = snapToGrid({ x: 95, y: 85 }, 70, OFF)
    expect(b.x - a.x).toBe(70)
    expect(b.y - a.y).toBe(70)
  })

  it('is a no-op at zero offset', () => {
    expect(snapToGrid({ x: 30, y: 30 }, 70, { x: 0, y: 0 })).toEqual(snapToGrid({ x: 30, y: 30 }, 70))
  })

  it('handles a NEGATIVE offset without gaps', () => {
    const p = snapToGrid({ x: 100, y: 100 }, 70, { x: -20, y: -20 })
    expect(p).toEqual({ x: 85, y: 85 })
  })

  it('draws the first grid line inside the map when shifted', () => {
    // A shifted grid must still rule the left edge, not leave a wide first column.
    const lines = gridLines({ width_px: 280, height_px: 140, grid_size: 70, grid_offset_x: 20, grid_offset_y: 0 })
    expect(lines?.vertical).toEqual([20, 90, 160, 230])
  })

  it('is applied by dropPosition, not just by snapToGrid', () => {
    const map = { width_px: 1400, height_px: 900, grid_size: 70, grid_offset_x: 20, grid_offset_y: 10 }
    const rect = { left: 0, top: 0, width: 1400, height: 900 }
    expect(dropPosition(30, 30, rect, map, true)).toEqual({ x: 55, y: 45 })
  })
})

describe('findFreeCell', () => {
  const MAP2 = { width_px: 1400, height_px: 900, grid_size: 70 }
  const centre = snapToGrid({ x: 700, y: 450 }, 70)

  it('uses the centre when nothing is there', () => {
    expect(findFreeCell(MAP2, [])).toEqual(centre)
  })

  it('steps aside when the centre is taken', () => {
    // Otherwise three added monsters look like one.
    const p = findFreeCell(MAP2, [centre])
    expect(p).not.toEqual(centre)
    // ...and lands in an ADJACENT cell, not somewhere across the map.
    expect(Math.abs(p.x - centre.x) <= 70 && Math.abs(p.y - centre.y) <= 70).toBe(true)
  })

  it('keeps finding new cells as tokens accumulate', () => {
    const taken: { x: number; y: number }[] = []
    for (let i = 0; i < 12; i++) {
      const p = findFreeCell(MAP2, taken)
      // Every placement must be somewhere not already used.
      expect(taken.some((t) => t.x === p.x && t.y === p.y)).toBe(false)
      taken.push(p)
    }
  })

  it('counts a nearby off-grid token as occupying its square', () => {
    // A token dropped with Alt still blocks the cell it is sitting in.
    const nudged = { x: centre.x + 5, y: centre.y - 5 }
    expect(findFreeCell(MAP2, [nudged])).not.toEqual(centre)
  })

  it('falls back to the centre rather than looping forever on a full map', () => {
    // A tiny map, every cell taken. An "Add token" that silently does nothing
    // would be worse than one that stacks.
    const tiny = { width_px: 140, height_px: 140, grid_size: 70 }
    const all = [
      { x: 35, y: 35 }, { x: 105, y: 35 }, { x: 35, y: 105 }, { x: 105, y: 105 },
      { x: 175, y: 35 }, { x: 35, y: 175 }, { x: 175, y: 175 }, { x: 105, y: 175 }, { x: 175, y: 105 },
    ]
    expect(findFreeCell(tiny, all)).toEqual(snapToGrid({ x: 70, y: 70 }, 70))
  })

  it('respects the grid offset when choosing a cell', () => {
    const offMap = { ...MAP2, grid_offset_x: 20, grid_offset_y: 10 }
    const p = findFreeCell(offMap, [])
    // On the offset lattice, so ((p - offset) mod grid) lands on a half-cell.
    expect((((p.x - 20) % 70) + 70) % 70).toBe(35)
    expect((((p.y - 10) % 70) + 70) % 70).toBe(35)
  })
})

describe('keeping a token wholly on the map (2026-09-01)', () => {
  const MAP3 = { width_px: 1400, height_px: 900, grid_size: 70 }

  it('insets the clamp by the given margin', () => {
    // A token is drawn CENTRED on its coordinate, so clamping the centre to 0
    // leaves half of it outside — the reported "goes half off and stays there".
    expect(clampToMap({ x: -100, y: -100 }, MAP3, 35)).toEqual({ x: 35, y: 35 })
    expect(clampToMap({ x: 9999, y: 9999 }, MAP3, 35)).toEqual({ x: 1365, y: 865 })
  })

  it('leaves an interior point alone', () => {
    expect(clampToMap({ x: 700, y: 450 }, MAP3, 35)).toEqual({ x: 700, y: 450 })
  })

  it('defaults to no inset, so other callers are unaffected', () => {
    expect(clampToMap({ x: -100, y: -100 }, MAP3)).toEqual({ x: 0, y: 0 })
  })

  it('centres rather than inverting when the token is bigger than the map', () => {
    // Without the guard the bounds cross over (min 400 > max 200) and the point
    // snaps to a nonsense corner.
    const tiny = { width_px: 400, height_px: 400, grid_size: 70 }
    expect(clampToMap({ x: 0, y: 0 }, tiny, 400)).toEqual({ x: 200, y: 200 })
  })

  it('is applied by dropPosition when an inset is passed', () => {
    const rect = { left: 0, top: 0, width: 1400, height: 900 }
    const p = dropPosition(9999, 9999, rect, MAP3, true, 35)
    expect(p.x).toBeLessThanOrEqual(1400 - 35)
    expect(p.y).toBeLessThanOrEqual(900 - 35)
  })
})

describe('snapToken — size decides where a token snaps to', () => {
  const M = { width_px: 1400, height_px: 900, grid_size: 70 }

  it('centres a 1-square token on a CELL CENTRE', () => {
    expect(snapToken({ x: 30, y: 30 }, M, 1)).toEqual({ x: 35, y: 35 })
  })

  it('centres a 2-square token on a CELL CORNER', () => {
    // Centred on a cell centre, a 2x2 straddles four half-cells and lines up
    // with nothing — the first thing anyone notices at a table.
    expect(snapToken({ x: 62, y: 62 }, M, 2)).toEqual({ x: 70, y: 70 })
  })

  it('centres a 3-square token on a cell centre again', () => {
    expect(snapToken({ x: 200, y: 200 }, M, 3)).toEqual({ x: 175, y: 175 })
  })

  it('centres a 4-square token on a corner', () => {
    expect(snapToken({ x: 200, y: 200 }, M, 4)).toEqual({ x: 210, y: 210 })
  })

  it('centres a HALF-square token in its square, not in a corner of it', () => {
    // Changed 2026-09-01 at the owner's request. It previously snapped to
    // quarter-cells so four halves could tile one square, which put a lone small
    // creature in a corner — the wrong reading of where it is standing.
    expect(snapToken({ x: 10, y: 10 }, M, 0.5)).toEqual({ x: 35, y: 35 })
    expect(snapToken({ x: 50, y: 60 }, M, 0.5)).toEqual({ x: 35, y: 35 })
  })

  it('keeps a large token fully on the map', () => {
    const p = snapToken({ x: 9999, y: 9999 }, M, 4)
    expect(p.x).toBeLessThanOrEqual(M.width_px - 2 * M.grid_size)
    expect(p.y).toBeLessThanOrEqual(M.height_px - 2 * M.grid_size)
  })

  it('ALLOWS the partial square at a ragged edge', () => {
    // 1400 / 64 leaves a 56px sliver. Restored on 2026-09-01 at the owner's
    // request: the partial squares at a map's edge are still places to stand.
    const ragged = { width_px: 1400, height_px: 900, grid_size: 64 }
    const p = snapToken({ x: 1399, y: 450 }, ragged, 1)
    expect(p.x).toBeGreaterThan(1344)
    expect(p.x).toBeLessThanOrEqual(1400)
  })

  it('respects the grid offset', () => {
    const off = { ...M, grid_offset_x: 20, grid_offset_y: 0 }
    expect(snapToken({ x: 50, y: 30 }, off, 1).x).toBe(55)
  })

  it('is what dropPosition uses when snapping', () => {
    const rect = { left: 0, top: 0, width: 1400, height: 900 }
    expect(dropPosition(62, 62, rect, M, true, 70, 2)).toEqual({ x: 70, y: 70 })
  })
})

describe('movementDelta (diagonals, 2026-09-02)', () => {
  it('maps the four arrows', () => {
    expect(movementDelta('ArrowLeft', '')).toEqual({ dx: -1, dy: 0 })
    expect(movementDelta('ArrowRight', '')).toEqual({ dx: 1, dy: 0 })
    expect(movementDelta('ArrowUp', '')).toEqual({ dx: 0, dy: -1 })
    expect(movementDelta('ArrowDown', '')).toEqual({ dx: 0, dy: 1 })
  })

  it('maps the numpad, including all four diagonals', () => {
    expect(movementDelta('7', 'Numpad7')).toEqual({ dx: -1, dy: -1 })
    expect(movementDelta('9', 'Numpad9')).toEqual({ dx: 1, dy: -1 })
    expect(movementDelta('1', 'Numpad1')).toEqual({ dx: -1, dy: 1 })
    expect(movementDelta('3', 'Numpad3')).toEqual({ dx: 1, dy: 1 })
  })

  it('gives laptops without a numpad a way to move diagonally', () => {
    // Otherwise diagonal movement is unavailable to most people using the app,
    // which is not a feature.
    expect(movementDelta('Home', '')).toEqual({ dx: -1, dy: -1 })
    expect(movementDelta('PageUp', '')).toEqual({ dx: 1, dy: -1 })
    expect(movementDelta('End', '')).toEqual({ dx: -1, dy: 1 })
    expect(movementDelta('PageDown', '')).toEqual({ dx: 1, dy: 1 })
  })

  it('agrees with itself when NumLock is off', () => {
    // With NumLock off the physical Numpad7 reports key 'Home'. Both paths must
    // mean the same direction, or the same key moves differently depending on a
    // lock light.
    expect(movementDelta('Home', 'Numpad7')).toEqual(movementDelta('Home', ''))
  })

  it('treats numpad 5 as a no-op, not as nothing', () => {
    // It is the centre of the pad. Returning a zero step consumes the key so it
    // does not fall through to the browser; returning null would let it scroll
    // the page.
    expect(movementDelta('5', 'Numpad5')).toEqual({ dx: 0, dy: 0 })
  })

  it('ignores keys that are not movement', () => {
    for (const [k, c] of [['a', 'KeyA'], ['Enter', 'Enter'], [' ', 'Space'], ['Tab', 'Tab']]) {
      expect(movementDelta(k, c)).toBeNull()
    }
  })

  it('never returns a step larger than one cell', () => {
    // A diagonal is one square across and one down — not a knight's move.
    for (const c of ['Numpad1', 'Numpad3', 'Numpad7', 'Numpad9']) {
      const d = movementDelta('', c)!
      expect(Math.abs(d.dx)).toBeLessThanOrEqual(1)
      expect(Math.abs(d.dy)).toBeLessThanOrEqual(1)
    }
  })
})

describe('combinedDelta (two-key diagonals, 2026-09-02)', () => {
  const k = (key: string, code = '') => ({ key, code })

  it('turns two arrows into a diagonal', () => {
    // The reason this exists: diagonals were only reachable on keys a compact
    // laptop keyboard may not have.
    expect(combinedDelta([k('ArrowLeft'), k('ArrowUp')])).toEqual({ dx: -1, dy: -1 })
    expect(combinedDelta([k('ArrowRight'), k('ArrowDown')])).toEqual({ dx: 1, dy: 1 })
  })

  it('is order-independent', () => {
    expect(combinedDelta([k('ArrowUp'), k('ArrowLeft')])).toEqual(
      combinedDelta([k('ArrowLeft'), k('ArrowUp')]),
    )
  })

  it('still handles a single key', () => {
    expect(combinedDelta([k('ArrowLeft')])).toEqual({ dx: -1, dy: 0 })
  })

  it('cancels opposite keys to no movement on that axis', () => {
    // Correct, not a bug: holding Left and Right means no horizontal intent.
    expect(combinedDelta([k('ArrowLeft'), k('ArrowRight')])).toEqual({ dx: 0, dy: 0 })
    expect(combinedDelta([k('ArrowLeft'), k('ArrowRight'), k('ArrowUp')])).toEqual({
      dx: 0,
      dy: -1,
    })
  })

  it('never produces a step larger than one cell', () => {
    // Three keys on one axis must not become a three-square leap.
    const d = combinedDelta([k('ArrowLeft'), k('ArrowLeft'), k('ArrowLeft')])!
    expect(d).toEqual({ dx: -1, dy: 0 })
  })

  it('combines an arrow with a numpad key without exceeding one cell', () => {
    const d = combinedDelta([k('ArrowLeft'), k('7', 'Numpad7')])!
    expect(d).toEqual({ dx: -1, dy: -1 })
  })

  it('ignores non-movement keys mixed in', () => {
    expect(combinedDelta([k('Shift', 'ShiftLeft'), k('ArrowUp')])).toEqual({ dx: 0, dy: -1 })
  })

  it('returns null when nothing held is movement', () => {
    expect(combinedDelta([k('a', 'KeyA')])).toBeNull()
    expect(combinedDelta([])).toBeNull()
  })
})
