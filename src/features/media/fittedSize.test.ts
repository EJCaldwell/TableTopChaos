/**
 * Tests for the image downscaling maths (Phase 1.6, tested 2026-09-01).
 *
 * This is the arithmetic behind the fix for the Edge worker running out of
 * memory on large rasters — the reason big photos upload at all. It had never
 * been exercised outside a browser, and the cases below are the ones that would
 * fail an upload rather than merely mis-size it.
 */
import { describe, expect, it } from 'vitest'
import { fittedSize, MAX_IMAGE_DIM } from './api'

describe('fittedSize', () => {
  it('returns null when the image already fits', () => {
    // null means "send the original untouched" — re-encoding a small image
    // would cost quality for nothing.
    expect(fittedSize(800, 600, 2048)).toBeNull()
    expect(fittedSize(2048, 2048, 2048)).toBeNull()
  })

  it('fits the LONGEST side, whichever it is', () => {
    expect(fittedSize(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024 })
    expect(fittedSize(2048, 4096, 2048)).toEqual({ width: 1024, height: 2048 })
  })

  it('preserves aspect ratio within a pixel', () => {
    const out = fittedSize(3000, 2000, 2048)!
    expect(Math.abs(out.width / out.height - 3000 / 2000)).toBeLessThan(0.01)
  })

  it('scales a long, thin image without losing its short side', () => {
    // 60000x100 at a 2048 cap comes to 3px, not the 1 I first assumed — the
    // ratio has to be far more extreme than "very thin" before the floor is
    // reached at all.
    expect(fittedSize(60000, 100, 2048)).toEqual({ width: 2048, height: 3 })
  })

  it('never returns a zero dimension, however extreme the ratio', () => {
    // THIS is where the floor earns its place: the short side rounds to 0, and
    // a canvas of width 0 THROWS — so the upload would fail outright for
    // exactly the images that most need shrinking.
    const out = fittedSize(60000, 10, 2048)!
    expect(out.height).toBe(1)
    expect(fittedSize(10, 60000, 2048)!.width).toBe(1)
  })

  it('always returns whole pixels', () => {
    // A fractional canvas dimension is silently truncated by the browser, which
    // would shift the aspect ratio by a hair on every upload.
    for (const [w, h] of [[3333, 1777], [4001, 2999], [5000, 3]]) {
      const out = fittedSize(w, h, 2048)!
      expect(Number.isInteger(out.width) && Number.isInteger(out.height)).toBe(true)
    }
  })

  it('never exceeds the limit it was given', () => {
    for (const [w, h] of [[9999, 8888], [2049, 10], [10, 2049]]) {
      const out = fittedSize(w, h, 2048)!
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048)
    }
  })

  it('uses a limit the Edge worker can actually decode', () => {
    // The whole point of the client-side resize. If this grows, the OOM the fix
    // was for comes back.
    expect(MAX_IMAGE_DIM).toBeLessThanOrEqual(2048)
  })
})
