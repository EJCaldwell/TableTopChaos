/**
 * Tests for hit-point and death-save arithmetic.
 *
 * This is the most consequential arithmetic in the app: get it wrong and a
 * character dies who should not have, or survives a hit that should have
 * dropped them. It also encodes two 5e rules that are easy to implement subtly
 * wrong — temp HP absorbing damage first, and healing capping at max.
 */
import { describe, expect, it } from 'vitest'
import { applyHpDelta, clampDeathSaves, type HpSnapshot } from './hp'

/** Builds a snapshot, defaulting the fields a given test does not care about. */
function snap(over: Partial<HpSnapshot> = {}): HpSnapshot {
  return { current_hp: 20, max_hp: 30, temp_hp: 0, ...over }
}

describe('applyHpDelta — healing', () => {
  it('adds to current HP', () => {
    expect(applyHpDelta(snap({ current_hp: 10 }), 1, 5)).toEqual({ current_hp: 15 })
  })

  it('caps at max', () => {
    expect(applyHpDelta(snap({ current_hp: 28, max_hp: 30 }), 1, 10)).toEqual({ current_hp: 30 })
  })

  it('heals exactly to max without overshooting', () => {
    expect(applyHpDelta(snap({ current_hp: 25, max_hp: 30 }), 1, 5)).toEqual({ current_hp: 30 })
  })

  it('is unbounded when no max is set', () => {
    // Capping at an invented number would be worse than not capping: the player
    // never entered a maximum, so there is nothing to cap to.
    expect(applyHpDelta(snap({ current_hp: 10, max_hp: null }), 1, 999)).toEqual({
      current_hp: 1009,
    })
  })

  it('treats a null current HP as zero', () => {
    expect(applyHpDelta(snap({ current_hp: null, max_hp: 30 }), 1, 5)).toEqual({ current_hp: 5 })
  })

  it('does NOT restore temp HP', () => {
    // Temp HP is spent, not damaged. Healing must not top it back up.
    const patch = applyHpDelta(snap({ current_hp: 10, temp_hp: 0 }), 1, 5)
    expect(patch.temp_hp).toBeUndefined()
  })
})

describe('applyHpDelta — damage', () => {
  it('subtracts from current HP when there is no temp HP', () => {
    expect(applyHpDelta(snap({ current_hp: 20, temp_hp: 0 }), -1, 8)).toEqual({
      current_hp: 12,
      temp_hp: 0,
    })
  })

  it('eats temp HP FIRST', () => {
    // 5 damage against 5 temp: current HP untouched.
    expect(applyHpDelta(snap({ current_hp: 20, temp_hp: 5 }), -1, 5)).toEqual({
      current_hp: 20,
      temp_hp: 0,
    })
  })

  it('spills the remainder into current HP once temp is exhausted', () => {
    // 8 damage against 5 temp: 5 absorbed, 3 through.
    expect(applyHpDelta(snap({ current_hp: 20, temp_hp: 5 }), -1, 8)).toEqual({
      current_hp: 17,
      temp_hp: 0,
    })
  })

  it('leaves the unspent part of temp HP intact', () => {
    expect(applyHpDelta(snap({ current_hp: 20, temp_hp: 10 }), -1, 4)).toEqual({
      current_hp: 20,
      temp_hp: 6,
    })
  })

  it('allows current HP to go NEGATIVE', () => {
    // Deliberately not floored at zero: negative HP is how death saves begin,
    // and clamping would erase information the DM is using.
    expect(applyHpDelta(snap({ current_hp: 3, temp_hp: 0 }), -1, 10)).toEqual({
      current_hp: -7,
      temp_hp: 0,
    })
  })

  it('never drives temp HP negative', () => {
    const patch = applyHpDelta(snap({ current_hp: 20, temp_hp: 2 }), -1, 50)
    expect(patch.temp_hp).toBe(0)
    expect(patch.current_hp).toBe(20 - 48)
  })
})

describe('applyHpDelta — input handling', () => {
  it('ignores the sign of the amount, using the direction argument', () => {
    // The UI passes a magnitude and a direction; a negative typed into the box
    // must not silently invert the button that was pressed.
    expect(applyHpDelta(snap({ current_hp: 10 }), 1, -5)).toEqual({ current_hp: 15 })
  })

  it('truncates fractional input', () => {
    expect(applyHpDelta(snap({ current_hp: 10 }), 1, 5.9)).toEqual({ current_hp: 15 })
  })

  it('is a no-op for zero', () => {
    expect(applyHpDelta(snap(), 1, 0)).toEqual({})
  })

  it('is a no-op for junk input', () => {
    expect(applyHpDelta(snap(), -1, Number.NaN)).toEqual({})
  })

  it('is a no-op for an amount that truncates to zero', () => {
    expect(applyHpDelta(snap(), -1, 0.4)).toEqual({})
  })

  it('does not mutate the snapshot it was given', () => {
    const s = snap({ current_hp: 20, temp_hp: 5 })
    applyHpDelta(s, -1, 8)
    expect(s).toEqual({ current_hp: 20, max_hp: 30, temp_hp: 5 })
  })
})

describe('clampDeathSaves', () => {
  it.each([
    [0, 0],
    [1, 1],
    [3, 3],
    [-1, 0],
    [4, 3],
    [99, 3],
  ])('clamps %i to %i', (input, expected) => {
    expect(clampDeathSaves(input)).toBe(expected)
  })

  it('truncates a fractional tally', () => {
    expect(clampDeathSaves(2.7)).toBe(2)
  })

  it('treats junk as zero rather than NaN', () => {
    // A NaN written to the DB would render as an empty tally and be impossible
    // to clear from the UI.
    expect(clampDeathSaves(Number.NaN)).toBe(0)
  })
})
