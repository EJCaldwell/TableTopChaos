/**
 * Tests for dice-notation parsing and rolling.
 *
 * Randomness is injected, so these assert EXACT totals rather than ranges. That
 * distinction is the reason the module was extracted: a range assertion
 * ("between 2 and 12") passes just as happily when the arithmetic drops a
 * modifier or mis-signs a term.
 */
import { describe, expect, it } from 'vitest'
import { rollNotation, type RollResult } from './dice'

/**
 * A deterministic stand-in for Math.random.
 *
 * Values are what `random()` returns, in order, cycling if exhausted. Remember
 * the roller computes `1 + floor(random() * sides)`, so 0 is the lowest face and
 * 0.999 is the highest.
 */
function seeded(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

/** Narrows to a successful roll, failing the test with the error text if not. */
function ok(result: RollResult | string): RollResult {
  if (typeof result === 'string') throw new Error(`expected a roll, got error: ${result}`)
  return result
}

describe('rollNotation — valid expressions', () => {
  it('rolls a single implicit die (d20)', () => {
    // 0.5 * 20 = 10, floor 10, +1 = 11
    expect(ok(rollNotation('d20', seeded(0.5))).total).toBe(11)
  })

  it('rolls the lowest and highest faces at the extremes of the random range', () => {
    expect(ok(rollNotation('d20', seeded(0))).total).toBe(1)
    expect(ok(rollNotation('d20', seeded(0.9999))).total).toBe(20)
  })

  it('sums multiple dice of the same term', () => {
    // 3d6 with faces 1, 4, 6
    const r = ok(rollNotation('3d6', seeded(0, 0.5, 0.999)))
    expect(r.total).toBe(1 + 4 + 6)
  })

  it('adds a flat modifier', () => {
    expect(ok(rollNotation('2d6+3', seeded(0.5))).total).toBe(4 + 4 + 3)
  })

  it('subtracts a flat modifier', () => {
    expect(ok(rollNotation('2d6-3', seeded(0.5))).total).toBe(4 + 4 - 3)
  })

  it('handles several dice terms in one expression', () => {
    // 1d8 -> 5, 1d4 -> 3, +2
    expect(ok(rollNotation('1d8+1d4+2', seeded(0.5))).total).toBe(5 + 3 + 2)
  })

  it('subtracts a whole dice term, not just its first die', () => {
    // 4d6 at 0.5 -> 4 each = 16; minus 2d6 at 0.5 -> 4 each = 8
    expect(ok(rollNotation('4d6-2d6', seeded(0.5))).total).toBe(16 - 8)
  })

  it('ignores whitespace and case', () => {
    expect(ok(rollNotation('  2 D 6 + 3 ', seeded(0.5))).total).toBe(11)
  })

  it('accepts a bare number', () => {
    expect(ok(rollNotation('7', seeded(0.5))).total).toBe(7)
  })

  it('accepts a leading minus', () => {
    expect(ok(rollNotation('-1d6', seeded(0.5))).total).toBe(-4)
  })

  it('reports the individual faces in the breakdown', () => {
    expect(ok(rollNotation('2d6+3', seeded(0, 0.999))).detail).toBe('2d6 [1, 6] + 3 = 10')
  })

  it('preserves the notation as typed, not as normalised', () => {
    expect(ok(rollNotation('  2d6 + 3 ', seeded(0.5))).notation).toBe('2d6 + 3')
  })
})

describe('rollNotation — rejections', () => {
  it('rejects empty input with a prompt rather than a complaint', () => {
    expect(rollNotation('', seeded(0.5))).toBe('Enter dice notation, e.g. 2d6+3.')
  })

  it('rejects whitespace-only input the same way', () => {
    expect(rollNotation('   ', seeded(0.5))).toBe('Enter dice notation, e.g. 2d6+3.')
  })

  it.each(['abc', '2x6', 'd', '2d', '2d6+', '+', '2d6++3', '2..6'])(
    'rejects malformed notation: %s',
    (input) => {
      const r = rollNotation(input, seeded(0.5))
      expect(typeof r).toBe('string')
      expect(r).toContain("isn't valid notation")
    },
  )

  it('quotes the ORIGINAL input in the error, not the normalised form', () => {
    expect(rollNotation('2 X 6', seeded(0.5))).toContain('"2 X 6"')
  })

  it('rejects too many dice — a typo must not lock the tab', () => {
    expect(rollNotation('101d6', seeded(0.5))).toContain('Out of range')
  })

  it('rejects too many sides', () => {
    expect(rollNotation('1d1001', seeded(0.5))).toContain('Out of range')
  })

  it('allows exactly the documented maximums', () => {
    expect(typeof rollNotation('100d1000', seeded(0.5))).toBe('object')
  })

  it('rejects a zero-sided die', () => {
    // d0 would make `1 + floor(random() * 0)` always 1 — a silently wrong roll
    // rather than an obvious one, which is why this is checked.
    expect(rollNotation('1d0', seeded(0.5))).toContain('Out of range')
  })
})
