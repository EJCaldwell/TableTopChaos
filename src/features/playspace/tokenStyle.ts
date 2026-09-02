/**
 * playspace/tokenStyle.ts — the visual style of one token (Phase 9.1/9.3).
 *
 * Extracted from the canvas on 2026-09-01 for one reason: a bug that was
 * invisible to every other kind of test.
 *
 * THE BUG. The token's style object set `backgroundImage` from the token's
 * artwork and then, further down the same object, set the `background`
 * SHORTHAND for the dark disc behind the initials:
 *
 *     ...(art ? { backgroundImage: `url(${art})` } : null),
 *     background: 'rgba(0,0,0,0.55)',      // <- resets background-image to none
 *
 * `background` is a shorthand, so setting it after `backgroundImage` resets the
 * image to `none`. The token still drew its circle, its ring and its initials —
 * everything except the picture. Nothing failed: no error, no 404, and the
 * storage logs showed the player's own browser fetching the image successfully.
 * The bytes arrived and the CSS threw them away.
 *
 * That is why this is a function with a test rather than an inline object: the
 * failure is a property of the ORDER of keys, which a build cannot see, a type
 * cannot express, and a screenshot only reveals if you know what the picture was
 * meant to be.
 */

/** The background-related style for a token. */
export interface TokenBackground {
  backgroundColor: string
  backgroundImage?: string
  backgroundSize?: string
  backgroundPosition?: string
}

/**
 * Builds the token's background style.
 *
 * Uses `backgroundColor`, never the `background` shorthand, so it cannot reset
 * the image whatever order the keys end up in.
 *
 * @param art - Signed URL of the token's artwork, if any.
 * @returns Style properties to spread into the token's style object.
 */
export function tokenBackground(art: string | undefined): TokenBackground {
  // The dark disc sits UNDER the artwork: it is what the initials are legible
  // against when there is no picture, and it is harmless behind one.
  const base: TokenBackground = { backgroundColor: 'rgba(0,0,0,0.55)' }
  if (!art) return base
  return {
    ...base,
    // `cover` on a circular button crops a rectangular portrait to the middle,
    // which is where a face is; `contain` would letterbox it inside the circle.
    backgroundImage: `url(${art})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}
