/**
 * Tests for the client-side username rules.
 *
 * These rules are a MIRROR of migration 0039's `private.is_valid_username`, and
 * the drift that matters is one-directional: if this file is looser than the
 * database, the server still refuses and the user sees a slightly later error.
 * If it is STRICTER, it silently forbids names the database would have allowed —
 * a bug nobody can diagnose from the outside, because the rule being enforced
 * exists only in the browser.
 *
 * So the allow-cases below are the important half.
 */
import { describe, expect, it } from 'vitest'
import {
  USERNAME_MAX,
  USERNAME_TAKEN_MESSAGE,
  isUsernameTakenError,
  validateUsername,
} from './username'

describe('validateUsername — accepts', () => {
  it.each([
    ['abc', 'the minimum length'],
    ['Thorin_Oak', 'letters with an underscore'],
    ['a1b2c3', 'digits after the first character'],
    ['9lives', 'a leading digit'],
    ['A'.repeat(USERNAME_MAX), 'exactly the maximum length'],
    ['EJ', 'the owner short-name exception (migration 0042)'],
    ['ej', 'the same exception in another case'],
    ['QA', 'the QA fixture exception (migration 0043)'],
  ])('accepts %j — %s', (name) => {
    expect(validateUsername(name)).toBeNull()
  })

  it('trims surrounding whitespace before judging', () => {
    expect(validateUsername('  Thorin  ')).toBeNull()
  })
})

describe('validateUsername — rejects, naming the rule broken', () => {
  it('rejects empty input', () => {
    expect(validateUsername('')).toBe('Choose a username.')
  })

  it('rejects whitespace-only input as empty, not as too short', () => {
    expect(validateUsername('   ')).toBe('Choose a username.')
  })

  it('rejects a name under the minimum, saying so', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/)
  })

  it('rejects a name over the maximum, saying so', () => {
    expect(validateUsername('A'.repeat(USERNAME_MAX + 1))).toMatch(/at most 20/)
  })

  it('names the CHARACTER rule for an illegal character', () => {
    // "alex.c" is the classic near-miss impersonation shape, and a generic
    // "invalid username" would leave the user guessing which part was wrong.
    expect(validateUsername('alex.c')).toMatch(/letters, numbers and underscores/)
  })

  it.each(['alex-c', 'alex c', 'alex!', 'émile'])('rejects %j', (name) => {
    expect(validateUsername(name)).not.toBeNull()
  })

  it('names the LEADING-CHARACTER rule separately', () => {
    expect(validateUsername('_lead')).toMatch(/start with a letter or number/)
  })

  it.each(['admin', 'Admin', 'ADMIN', 'support', 'deleted', 'settings'])(
    'rejects the reserved name %j, case-insensitively, and says it is reserved',
    (name) => {
      expect(validateUsername(name)).toMatch(/reserved/)
    },
  )

  it.each(['dm', 'gm', 'me', 'www'])(
    'rejects the short reserved name %j (the LENGTH rule fires first)',
    (name) => {
      // `dm` is both too short and reserved. Which message wins is arbitrary and
      // both are true, so this asserts only that it is refused — pinning the
      // wording here would make the test fail on a harmless reordering.
      expect(validateUsername(name)).not.toBeNull()
    },
  )

  it('rejects a reserved word even though it is on the short-name list length-wise', () => {
    // The exception list buys a pass on LENGTH only — never on reserved words.
    expect(validateUsername('me')).not.toBeNull()
  })
})

describe('isUsernameTakenError', () => {
  it('recognises a unique-violation', () => {
    expect(isUsernameTakenError({ code: '23505' })).toBe(true)
  })

  it('does not treat a CHECK violation as "taken"', () => {
    // 23514 is the format/reserved/language rule. Calling that "already taken"
    // would send the user off trying variations of a name that will never be
    // accepted for a completely different reason.
    expect(isUsernameTakenError({ code: '23514' })).toBe(false)
  })

  it.each([null, undefined, 'boom', {}, { code: undefined }, new Error('x')])(
    'returns false for %j',
    (err) => {
      expect(isUsernameTakenError(err)).toBe(false)
    },
  )

  it('has a message that does not suggest changing capitalisation', () => {
    // Uniqueness is enforced on lower(username), so "try Alex instead of alex"
    // is advice that cannot work.
    expect(USERNAME_TAKEN_MESSAGE).toMatch(/different capitalisation/i)
  })
})
