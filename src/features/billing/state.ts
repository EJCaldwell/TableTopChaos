/**
 * billing/state.ts — the pure derivations behind the billing panel.
 *
 * Extracted from BillingPanel on 2026-09-01 so they can be tested. Both were
 * already pure; they were simply inline, where the only way to exercise them was
 * to own a Stripe subscription in each state.
 *
 * These two functions decide what a paying customer is TOLD about their own
 * account, which makes them worth more scrutiny than their size suggests.
 */
import type { CampaignSubscription } from './api'

/** Coarse billing state derived from the raw Stripe status. */
export type BillingState = 'none' | 'trialing' | 'active' | 'past_due' | 'lapsed' | 'pending'

/**
 * Maps the raw Stripe status (or no row at all) to our coarse state.
 *
 * THE DEFAULT BRANCH IS THE DANGEROUS ONE. `canceled`, `unpaid` and
 * `incomplete_expired` all mean "fully lapsed, read-only", and falling through
 * to that is correct for them — but it also catches any status Stripe adds
 * later, or any typo, and tells the customer their campaign is read-only. The
 * conservative direction here is arguable: a wrong 'lapsed' is visible and
 * complained about, whereas a wrong 'active' would silently give away the
 * product. Keeping the fallback strict is deliberate; the tests pin every known
 * status so a future Stripe value cannot quietly join the default branch
 * unnoticed.
 *
 * @param sub - The subscription row, or null when the campaign has none.
 * @returns The coarse state the panel renders from.
 */
export function deriveState(sub: CampaignSubscription | null): BillingState {
  if (!sub || !sub.status) return 'none'
  switch (sub.status) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'incomplete':
      return 'pending'
    // canceled | unpaid | incomplete_expired → fully lapsed (read-only).
    default:
      return 'lapsed'
  }
}

/**
 * Whole days from `now` until an ISO timestamp, floored at 0.
 *
 * CEILING, not floor: with 1.2 days left a customer should be told "2 days",
 * not "1" — rounding down would make the last day of a trial read as zero and
 * look like it had already ended.
 *
 * @param iso - The target instant, or null.
 * @param now - The current time in ms. Injectable so tests need not move the
 *        clock; defaults to Date.now().
 * @returns Whole days remaining, never negative.
 */
export function daysUntil(iso: string | null, now: number = Date.now()): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000))
}
