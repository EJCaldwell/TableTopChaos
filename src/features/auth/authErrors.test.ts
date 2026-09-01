/**
 * Tests for authErrorMessage (Phase 7.3, tested 2026-09-01).
 *
 * This function exists because `@supabase/auth-js` renders every GoTrue 5xx as
 * the literal string `"{}"`, discarding the server's actual explanation before
 * our code ever sees it. It is the only thing standing between a real user and
 * an error box containing two braces — which is exactly what shipped once,
 * on the change-email form.
 *
 * Everything here is pure, so it belongs in a unit test rather than in a
 * checklist: reproducing a GoTrue 500 by hand to check one string is not a
 * reasonable thing to ask of a person, and it would only be checked once.
 */
import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './authErrors'

const FALLBACK = 'Your email has NOT been changed.'

describe('authErrorMessage — the opaque cases', () => {
  it('replaces the auth-js 5xx artefact "{}"', () => {
    // The bug this whole module exists for.
    expect(authErrorMessage(new Error('{}'), FALLBACK)).toBe(FALLBACK)
  })

  it('replaces a browser fetch failure', () => {
    // Chrome and Safari word this differently, and this project has been bitten
    // twice by a CORS rejection presenting as one — once as a "wrong password".
    for (const m of ['Failed to fetch', 'Load failed', 'NetworkError']) {
      expect(authErrorMessage(new Error(m), FALLBACK)).toBe(FALLBACK)
    }
  })

  it('replaces an empty or whitespace-only message', () => {
    expect(authErrorMessage(new Error(''), FALLBACK)).toBe(FALLBACK)
    expect(authErrorMessage(new Error('   '), FALLBACK)).toBe(FALLBACK)
    expect(authErrorMessage(new Error('\n\t'), FALLBACK)).toBe(FALLBACK)
  })

  it('replaces "{}" even when the library pads it with whitespace', () => {
    // The set is matched against the TRIMMED string; without that trim this
    // returns " {} " to the user, which is worse than the original bug.
    expect(authErrorMessage(new Error('  {}  '), FALLBACK)).toBe(FALLBACK)
  })
})

describe('authErrorMessage — the useful cases', () => {
  it('keeps a real server message', () => {
    // The whole point is to preserve these. A blanket fallback would be easier
    // to write and would throw away every message worth reading.
    const real = 'Email address is already in use'
    expect(authErrorMessage(new Error(real), FALLBACK)).toBe(real)
  })

  it('keeps the message GoTrue actually sent in the 2026-08-27 incident', () => {
    const msg = 'Error sending email change email'
    expect(authErrorMessage(new Error(msg), FALLBACK)).toBe(msg)
  })

  it('trims surrounding whitespace off a real message', () => {
    expect(authErrorMessage(new Error('  Invalid login credentials  '), FALLBACK)).toBe(
      'Invalid login credentials',
    )
  })

  it('does NOT treat a message that merely CONTAINS braces as opaque', () => {
    // Matching by substring rather than equality would swallow this.
    const msg = 'Database error saving new user {code: 500}'
    expect(authErrorMessage(new Error(msg), FALLBACK)).toBe(msg)
  })
})

describe('authErrorMessage — things that are not Errors', () => {
  it('accepts a bare string', () => {
    expect(authErrorMessage('Invalid login credentials', FALLBACK)).toBe('Invalid login credentials')
    expect(authErrorMessage('{}', FALLBACK)).toBe(FALLBACK)
  })

  it('falls back for null, undefined and objects', () => {
    // supabase-js rejects with an AuthError, but a caller may pass anything a
    // catch block gave it, and a `[object Object]` in an error box helps nobody.
    for (const v of [null, undefined, {}, { message: 'nested' }, 42, []]) {
      expect(authErrorMessage(v, FALLBACK)).toBe(FALLBACK)
    }
  })

  it('never returns an empty string, whatever it is given', () => {
    // The caller renders this straight into a <FormError>; an empty message
    // shows an error box with nothing in it, which reads as a rendering bug.
    for (const v of [null, '', '  ', new Error(''), new Error('{}'), {}]) {
      expect(authErrorMessage(v, FALLBACK).length).toBeGreaterThan(0)
    }
  })
})
