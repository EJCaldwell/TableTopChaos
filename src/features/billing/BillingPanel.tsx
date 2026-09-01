/**
 * BillingPanel — the DM-only plan & billing controls (Phase 1.5.2).
 *
 * As of Phase 5.2 this is a **section of the Settings tab**, not a tab of its
 * own: billing is campaign administration, visited rarely, and it belongs with
 * the other rarely-visited administration in Settings rather than taking a slot
 * in the day-to-day rail. Nothing about its behavior changed with the move.
 *
 * Owns: showing the campaign's current billing state (not started / trialing /
 * active / past-due / lapsed) and the matching action — start a trial, subscribe
 * immediately, or open the Stripe billing portal to manage/cancel. The interval
 * selector (monthly / semi-annual / annual) is shown when the DM needs to choose
 * a plan.
 *
 * This panel is only reachable inside the DM-gated Settings tab, and the
 * underlying subscription row is DM-only at the RLS layer, so a player can never
 * load it.
 *
 * Note: while private.billing_config.enforce_active is false (pre-launch), the
 * app does not actually gate features on any of this — starting a subscription
 * is functional, but nothing is frozen when there is no subscription. The
 * screen is built now so it is ready when enforcement is switched on.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, FormError, FormNotice } from '../../components/ui'
import {
  getSubscription,
  openBillingPortal,
  PLAN_PRICING,
  startCheckout,
  type BillingInterval,
  type CampaignSubscription,
} from './api'
// Pure derivations, extracted 2026-09-01 so they can be unit-tested; see state.ts.
import { daysUntil, deriveState, type BillingState } from './state'

/**
 * @param campaignId - The campaign whose billing this manages.
 */
export function BillingPanel({ campaignId }: { campaignId: string }) {
  const [searchParams] = useSearchParams()
  const [sub, setSub] = useState<CampaignSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // Selected interval for a new subscription (defaults to the best-value plan).
  const [interval, setInterval] = useState<BillingInterval>('annual')

  // Post-checkout return flag (?billing=success|cancelled), set by the Edge
  // Function's success/cancel URLs.
  const billingReturn = searchParams.get('billing')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSub(await getSubscription(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing.')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const state = deriveState(sub)
  // A trial is only offerable on a brand-new campaign (no subscription row yet);
  // once a campaign has any subscription history it is subscribe-only.
  const canStartTrial = state === 'none'
  // Set by the webhook when a trial was auto-cancelled because the card had
  // already trialed elsewhere (no charge) — drives the explanatory copy.
  const trialBlocked = sub?.trial_blocked_reused_card ?? false

  /**
   * Start Stripe Checkout for the selected interval, then redirect the browser.
   * @param startTrial - true for the 30-day free trial, false to pay immediately.
   */
  async function handleCheckout(startTrial: boolean) {
    setWorking(true)
    setError(null)
    try {
      const url = await startCheckout(campaignId, interval, startTrial)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.')
      setWorking(false)
    }
  }

  /** Open the Stripe billing portal, then redirect the browser. */
  async function handlePortal() {
    setWorking(true)
    setError(null)
    try {
      const url = await openBillingPortal(campaignId)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.')
      setWorking(false)
    }
  }

  if (loading) {
    return <p style={{ marginTop: 'var(--space-6)', color: 'var(--color-text-muted)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)', display: 'grid', gap: 'var(--space-6)' }}>
      {/* Return-from-checkout notices. */}
      {billingReturn === 'success' && (
        <FormNotice message="Payment received — activating your plan. This can take a few seconds to reflect." />
      )}
      {billingReturn === 'cancelled' && (
        <FormNotice message="Checkout was cancelled. No changes were made." />
      )}
      {error && <FormError message={error} />}

      {/* Current status card. */}
      <StatusCard state={state} sub={sub} trialBlocked={trialBlocked} />

      {/* Actions per state. */}
      {(state === 'none' || state === 'lapsed') && (
        <section>
          <h3 style={{ fontSize: '1rem' }}>
            {state === 'lapsed' ? 'Reactivate this campaign' : 'Choose a plan'}
          </h3>
          {/*
            Trial eligibility is campaign-level: only a brand-new campaign with no
            subscription row ('none') can start a trial. A lapsed campaign already
            used one, so we show subscribe-only — a DM can't accidentally re-trigger
            a trial or expect one and get billed. `trialBlocked` is the special case
            where a trial WAS attempted but the card had already trialed elsewhere,
            so the webhook cancelled it (no charge); we explain that here.
          */}
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
            {trialBlocked
              ? 'That card has already used its free trial elsewhere, so the trial could not start and you were not charged. Subscribe below to continue — you will be billed today.'
              : canStartTrial
                ? 'Choose a plan, then start a 30-day free trial (card required, $0 today) or subscribe right away.'
                : 'Subscribe to unlock writes again. Your data was preserved.'}
          </p>
          <IntervalSelector value={interval} onChange={setInterval} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            {/* Trial button only when the campaign is actually eligible. */}
            {canStartTrial && (
              <Button style={{ width: 'auto' }} busy={working} onClick={() => handleCheckout(true)}>
                Start 30-day free trial
              </Button>
            )}
            {/* Immediate-billing path is always available in these states. */}
            <Button
              variant={canStartTrial ? 'secondary' : 'primary'}
              style={{ width: 'auto' }}
              busy={working}
              onClick={() => handleCheckout(false)}
            >
              {canStartTrial ? 'Subscribe now (billed today)' : 'Subscribe now'}
            </Button>
          </div>
        </section>
      )}

      {(state === 'trialing' || state === 'active' || state === 'past_due' || state === 'pending') && (
        <section>
          <Button variant="secondary" style={{ width: 'auto' }} busy={working} onClick={handlePortal}>
            Manage billing
          </Button>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: 'var(--space-2)' }}>
            Update your card, switch plans, or cancel in the Stripe portal.
          </p>
        </section>
      )}
    </div>
  )
}

/**
 * The status summary card at the top of the panel.
 * @param trialBlocked - when true (reused-card auto-cancel), overrides the
 *   'lapsed' copy so we don't imply the campaign lost access it never had.
 */
function StatusCard({
  state,
  sub,
  trialBlocked,
}: {
  state: BillingState
  sub: CampaignSubscription | null
  trialBlocked: boolean
}) {
  const trialDays = daysUntil(sub?.trial_end ?? null)
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString()
    : null

  // A reused-card cancel leaves status 'canceled' (→ 'lapsed'); show a neutral
  // "trial unavailable" card instead of the read-only-lock warning.
  if (trialBlocked && state === 'lapsed') {
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          background: 'var(--color-surface)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Free trial unavailable</h2>
        <p style={{ color: 'var(--color-text-muted)', margin: 'var(--space-2) 0 0' }}>
          This card has already used its free trial, so no trial was started and you were
          not charged. Subscribe below to activate the campaign.
        </p>
      </div>
    )
  }

  const copy: Record<BillingState, { title: string; body: string; tone: 'ok' | 'warn' | 'muted' }> = {
    none: {
      title: 'No active plan',
      body: 'This campaign has not started a trial or subscription yet.',
      tone: 'muted',
    },
    trialing: {
      title: `Free trial — ${trialDays} day${trialDays === 1 ? '' : 's'} left`,
      body: `Your trial ends ${sub?.trial_end ? new Date(sub.trial_end).toLocaleDateString() : 'soon'}. Subscribe any time to keep going after it.`,
      tone: 'ok',
    },
    active: {
      title: 'Pro — active',
      body: sub?.cancel_at_period_end
        ? `Set to cancel at period end${periodEnd ? ` (${periodEnd})` : ''}.`
        : periodEnd
          ? `Renews ${periodEnd}.`
          : 'Your subscription is active.',
      tone: 'ok',
    },
    past_due: {
      title: 'Payment issue',
      body: 'We couldn’t process your latest payment. Stripe is retrying; update your card to avoid interruption. Your campaign stays usable during this window.',
      tone: 'warn',
    },
    pending: {
      title: 'Finishing setup',
      body: 'Your subscription is being set up. This should resolve shortly.',
      tone: 'muted',
    },
    lapsed: {
      title: 'Read-only — subscription lapsed',
      body: 'Writes are paused for everyone in this campaign, but all content is preserved and viewable. Subscribe to unlock editing again.',
      tone: 'warn',
    },
  }

  const { title, body, tone } = copy[state]
  const border =
    tone === 'ok' ? 'var(--color-accent)' : tone === 'warn' ? 'var(--color-danger)' : 'var(--color-border)'

  return (
    <div
      style={{
        padding: 'var(--space-6)',
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius)',
        background: 'var(--color-surface)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
      <p style={{ color: 'var(--color-text-muted)', margin: 'var(--space-2) 0 0' }}>{body}</p>
      {sub?.card_last4 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: 'var(--space-3)' }}>
          Card on file: {sub.card_brand ?? 'card'} •••• {sub.card_last4}
        </p>
      )}
    </div>
  )
}

/** Radio-style selector for the three billing intervals. */
function IntervalSelector({
  value,
  onChange,
}: {
  value: BillingInterval
  onChange: (i: BillingInterval) => void
}) {
  const intervals: BillingInterval[] = ['monthly', 'semiannual', 'annual']
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
      }}
    >
      {intervals.map((i) => {
        const p = PLAN_PRICING[i]
        const selected = i === value
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius)',
              background: 'var(--color-bg)',
              border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
            }}
          >
            <div style={{ fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{p.price}</div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{p.cadence}</div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{p.effective}</div>
            {p.save && (
              <div style={{ color: 'var(--color-accent)', fontSize: '0.8rem', marginTop: '2px' }}>{p.save}</div>
            )}
          </button>
        )
      })}
    </div>
  )
}
