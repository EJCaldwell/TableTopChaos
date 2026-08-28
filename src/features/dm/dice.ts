/**
 * dm/dice.ts — dice-notation parsing and rolling (extracted in Phase 8.1).
 *
 * This lived inside CombatPanel.tsx, where it could not be tested without
 * mounting a React component. It is pure apart from the randomness, and the
 * randomness is now INJECTED — which is the whole point of the extraction: a
 * roller that calls Math.random directly can only be tested by asserting that
 * results fall in a range, which passes just as happily when the arithmetic is
 * wrong.
 *
 * Behaviour is unchanged from the original; only the seam is new.
 */

/** One parsed-and-rolled expression. */
export interface RollResult {
  /** The notation that was rolled (e.g. "2d6+3"). */
  notation: string
  /** The final total. */
  total: number
  /** Human-readable breakdown, e.g. "2d6 [4, 2] + 3 = 9". */
  detail: string
}

/** Sane caps so a typo like "999d999" can't lock the tab. */
export const MAX_DICE = 100
export const MAX_SIDES = 1000

/**
 * A source of randomness. Returns a float in [0, 1), like `Math.random`.
 *
 * Injected so tests can supply a deterministic sequence. Production callers
 * omit it and get `Math.random`.
 */
export type RandomFn = () => number

/**
 * Parses and rolls standard dice notation like `2d6+3`, `d20`, `1d8+1d4+2`
 * (whitespace ignored, case-insensitive).
 *
 * @param input - The raw notation string.
 * @param random - Randomness source; defaults to `Math.random`.
 * @returns A {@link RollResult}, or a human-readable error STRING when the
 *   notation is invalid or out of bounds. A string return is the error channel —
 *   deliberately, so the caller renders the message directly rather than mapping
 *   an error type onto copy.
 */
export function rollNotation(input: string, random: RandomFn = Math.random): RollResult | string {
  const expr = input.replace(/\s+/g, '').toLowerCase()
  if (!expr) return 'Enter dice notation, e.g. 2d6+3.'
  // Whole-string shape: a term, then any number of +/- terms.
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(expr)) {
    return `"${input}" isn't valid notation. Try e.g. 2d6+3.`
  }
  // Split into signed terms (each token keeps its leading sign).
  const tokens = expr.match(/[+-]?[^+-]+/g) ?? []
  let total = 0
  const parts: string[] = []
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1
    const body = token.replace(/^[+-]/, '')
    if (body.includes('d')) {
      const [countStr, sidesStr] = body.split('d')
      const count = countStr === '' ? 1 : parseInt(countStr, 10)
      const sides = parseInt(sidesStr, 10)
      if (count > MAX_DICE || sides > MAX_SIDES || sides < 1) {
        return `Out of range (max ${MAX_DICE} dice, d${MAX_SIDES}).`
      }
      const rolls: number[] = []
      for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(random() * sides))
      const sum = rolls.reduce((a, b) => a + b, 0)
      total += sign * sum
      parts.push(`${sign < 0 ? '- ' : parts.length ? '+ ' : ''}${count}d${sides} [${rolls.join(', ')}]`)
    } else {
      const n = parseInt(body, 10)
      total += sign * n
      parts.push(`${sign < 0 ? '- ' : parts.length ? '+ ' : ''}${n}`)
    }
  }
  return { notation: input.trim(), total, detail: `${parts.join(' ')} = ${total}` }
}
