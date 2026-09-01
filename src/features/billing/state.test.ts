/**
 * Tests for the billing panel's derivations (Phase 1.5, tested 2026-09-01).
 *
 * These decide what a paying customer is told about their own account, and the
 * only other way to exercise them is to own a Stripe subscription in each state
 * — which is why they had never been exercised at all.
 */
import { describe, expect, it } from 'vitest'
import { daysUntil, deriveState } from './state'
import type { CampaignSubscription } from './api'

/** A subscription row with only the field under test filled in. */
const sub = (status: string | null) => ({ status }) as unknown as CampaignSubscription

describe('deriveState', () => {
  it('maps every status Stripe can currently send', () => {
    // Pinned exhaustively so a future Stripe status cannot quietly join the
    // default branch and be reported to the customer as "lapsed".
    expect(deriveState(sub('trialing'))).toBe('trialing')
    expect(deriveState(sub('active'))).toBe('active')
    expect(deriveState(sub('past_due'))).toBe('past_due')
    expect(deriveState(sub('incomplete'))).toBe('pending')
    expect(deriveState(sub('canceled'))).toBe('lapsed')
    expect(deriveState(sub('unpaid'))).toBe('lapsed')
    expect(deriveState(sub('incomplete_expired'))).toBe('lapsed')
  })

  it('treats no row and a null status as "none", not as lapsed', () => {
    // A campaign that has never been subscribed must not be told it has expired.
    expect(deriveState(null)).toBe('none')
    expect(deriveState(sub(null))).toBe('none')
  })

  it('falls back to lapsed for an unrecognised status', () => {
    // Deliberate and conservative: a wrong "lapsed" is visible and complained
    // about, a wrong "active" silently gives the product away.
    expect(deriveState(sub('something_new_from_stripe'))).toBe('lapsed')
  })

  it('does NOT treat past_due as lapsed', () => {
    // past_due still has access — this is the retry window, not the end. Folding
    // it into 'lapsed' would lock out a customer whose card just needs updating.
    expect(deriveState(sub('past_due'))).not.toBe('lapsed')
  })
})

describe('daysUntil', () => {
  const now = Date.parse('2026-09-01T12:00:00Z')

  it('rounds UP, so the last day of a trial never reads as zero', () => {
    // 1.2 days left must say 2, not 1.
    expect(daysUntil('2026-09-02T16:48:00Z', now)).toBe(2)
    expect(daysUntil('2026-09-02T12:00:01Z', now)).toBe(2)
  })

  it('is exact on a whole number of days', () => {
    expect(daysUntil('2026-09-08T12:00:00Z', now)).toBe(7)
  })

  it('never goes negative for a date already past', () => {
    // An expired trial says 0 days, not -3.
    expect(daysUntil('2026-08-29T12:00:00Z', now)).toBe(0)
  })

  it('returns 0 for no date', () => {
    expect(daysUntil(null, now)).toBe(0)
  })

  it('reports a moment seconds away as 1 day, not 0', () => {
    // "0 days left" on a live trial reads as already-ended.
    expect(daysUntil('2026-09-01T12:00:30Z', now)).toBe(1)
  })
})
