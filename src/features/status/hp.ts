/**
 * status/hp.ts — hit-point and death-save arithmetic (extracted in Phase 8.1).
 *
 * This lived inside HpConditionsPanel.tsx as `applyDelta`/`clampSave`, tangled
 * with component state and a save call. It is the most consequential arithmetic
 * in the app — get it wrong and a character dies who should not have — and it
 * was completely untestable in that form.
 *
 * Extracted as pure functions over a plain snapshot. Behaviour unchanged.
 */

/** The mutable part of a character's status, as the panel holds it. */
export interface HpSnapshot {
  /** Current hit points. Null means "not tracked yet". */
  current_hp: number | null
  /** Maximum hit points, or null when the player has not set one. */
  max_hp: number | null
  /** Temporary hit points. Never negative. */
  temp_hp: number
}

/** The subset of fields a change produces. */
export interface HpPatch {
  current_hp?: number
  temp_hp?: number
}

/**
 * Applies damage or healing.
 *
 * Two rules, both from 5e and both easy to get subtly wrong:
 *  - **Damage eats temporary HP first**, and only the remainder reaches current
 *    HP. Temp HP is not a buffer that regenerates; what is spent is gone.
 *  - **Healing cannot exceed max**, when a max is known. With no max set,
 *    healing is unbounded — the alternative would be silently capping at a
 *    number the player never entered.
 *
 * Damage is deliberately NOT floored at zero: negative current HP is meaningful
 * at the table (it is how death saves get started), and clamping it would erase
 * information the DM is using.
 *
 * @param snapshot - Current values.
 * @param sign - `1` to heal, `-1` to damage.
 * @param amount - Magnitude; sign and fractional parts are ignored.
 * @returns The fields that changed. Empty when `amount` rounds to zero.
 */
export function applyHpDelta(snapshot: HpSnapshot, sign: 1 | -1, amount: number): HpPatch {
  const amt = Math.abs(Math.trunc(Number(amount) || 0))
  if (amt === 0) return {}

  const cur = snapshot.current_hp ?? 0

  if (sign === 1) {
    const next = snapshot.max_hp != null ? Math.min(cur + amt, snapshot.max_hp) : cur + amt
    return { current_hp: next }
  }

  let remaining = amt
  let temp = snapshot.temp_hp
  if (temp > 0) {
    const fromTemp = Math.min(temp, remaining)
    temp -= fromTemp
    remaining -= fromTemp
  }
  return { temp_hp: temp, current_hp: cur - remaining }
}

/**
 * Clamps a death-save tally to the legal 0..3.
 *
 * Three successes stabilise and three failures kill, so a value outside that
 * range is not just cosmetic — it is a state the rules have no answer for.
 *
 * @param n - Proposed tally.
 */
export function clampDeathSaves(n: number): number {
  return Math.max(0, Math.min(3, Math.trunc(Number(n) || 0)))
}
