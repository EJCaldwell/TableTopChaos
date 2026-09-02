/**
 * Tests for the token background style (added 2026-09-01, after a real bug).
 *
 * The bug: `background: 'rgba(0,0,0,0.55)'` was set AFTER `backgroundImage`, and
 * the shorthand reset the image to none. Tokens drew their circle, ring and
 * initials — everything but the picture — with no error anywhere, while the
 * storage logs showed the image being fetched successfully. The bytes arrived
 * and the CSS discarded them.
 *
 * These assertions exist so that reintroducing the shorthand fails here rather
 * than in somebody's game.
 */
import { describe, expect, it } from 'vitest'
import { tokenBackground } from './tokenStyle'

describe('tokenBackground', () => {
  it('keeps the artwork when there is some', () => {
    const s = tokenBackground('https://example.test/a.webp')
    expect(s.backgroundImage).toBe('url(https://example.test/a.webp)')
  })

  it('NEVER uses the `background` shorthand', () => {
    // The whole point. A shorthand anywhere in this object can reset the image
    // depending only on key order, which no type or build can catch.
    for (const art of ['https://example.test/a.webp', undefined]) {
      expect(Object.keys(tokenBackground(art))).not.toContain('background')
    }
  })

  it('still paints the dark disc behind the artwork', () => {
    // It is what the initials are legible against with no picture, and harmless
    // behind one — but if it were dropped, a transparent PNG token would vanish.
    expect(tokenBackground('x').backgroundColor).toBeTruthy()
    expect(tokenBackground(undefined).backgroundColor).toBeTruthy()
  })

  it('omits image properties entirely when there is no art', () => {
    const s = tokenBackground(undefined)
    expect(s.backgroundImage).toBeUndefined()
    expect(s.backgroundSize).toBeUndefined()
  })

  it('crops rather than letterboxes', () => {
    // `contain` would shrink a rectangular portrait inside the circle and leave
    // gaps; `cover` fills it and crops to the middle, which is where a face is.
    expect(tokenBackground('x').backgroundSize).toBe('cover')
    expect(tokenBackground('x').backgroundPosition).toBe('center')
  })
})
