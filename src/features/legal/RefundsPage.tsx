/**
 * RefundsPage — refund and cancellation policy (Phase 7.2.2).
 *
 * ACCURACY IS THE WHOLE POINT of this document: PLANNING's QA criterion for 7.2
 * is that it matches actual billing behaviour. Every claim below is traceable:
 *
 *   * 30-day free trial, one per card — TRIAL_PERIOD_DAYS and the
 *     card-fingerprint check in supabase/functions/_shared + stripe-webhook.
 *   * Cancel keeps access until period end — Stripe cancel_at_period_end.
 *   * past_due still counts as active — private.campaign_is_active() treats
 *     'trialing', 'active' and 'past_due' as active (migration 0005).
 *   * Read-only on lapse — the same function returning false freezes writes for
 *     EVERYONE in the campaign, players included.
 *
 * ONE CLAIM IS NOT YET TRUE: the 3-month deletion of read-only campaigns.
 *
 *   * The mechanism now EXISTS (2026-08-26) — migration 0036 holds the clock,
 *     `cleanup-campaigns` does the sweep, `railway/cleanup` schedules it, and
 *     LapseBanner is the "shown in the app" countdown.
 *   * It is NOT deployed, NOT armed (three independent switches, all off) and
 *     NOT tested (QA/7.2_tests/lapsed-campaign-cleanup.md is unrun).
 *   * Warning emails cannot reach anyone but the Resend account owner until a
 *     sending domain is verified.
 *
 * So this page still must NOT be published. The banner from legalConfig covers
 * the entity/contact gap; PRE_LAUNCH carries the arming sequence. Deleting
 * someone's campaign after a warning email that was never delivered would be the
 * worst possible way to discover the gap — which is why the sweep refuses to
 * delete anything whose final warning was not actually accepted for delivery.
 */
import { LegalLayout, LegalSection } from './LegalLayout'
import { ENTITY_DISPLAY } from './legalConfig'

export function RefundsPage() {
  return (
    <LegalLayout title="Refunds & Cancellation">
      <p>
        This page explains what happens to your money and your campaigns when you
        start, stop, or fail to renew a subscription. It describes how
        TableTopChaos actually behaves, not an aspiration.
      </p>

      <LegalSection heading="The free trial">
        <p>
          Every campaign can start a <strong>30-day free trial</strong> of the paid
          plan. The trial is the full product — it is limited only by how many
          players a campaign may have and how much image storage it may use, not
          by which features work.
        </p>
        <p>
          <strong>One trial per payment card.</strong> If you start a trial with a
          card that has already been used for one, the subscription is cancelled
          immediately and you are not charged. This is a fraud-prevention measure;
          it is why we retain a card fingerprint, which the Privacy Policy
          explains.
        </p>
      </LegalSection>

      <LegalSection heading="14-day money-back guarantee">
        <p>
          If you are unhappy with a charge, contact us within{' '}
          <strong>14 days of that charge</strong> and we will refund it in full.
          You do not have to give a reason.
        </p>
        <p>
          The refund applies to the charge you are asking about, not to the whole
          history of the subscription. Refunds are returned to the original
          payment method through Stripe and typically take 5–10 business days to
          appear, which is Stripe's timing rather than ours.
        </p>
        <p>
          This is offered in addition to, and does not limit, any statutory right
          to cancel or to a refund under the law where you live.
        </p>
      </LegalSection>

      <LegalSection heading="Cancelling">
        <p>
          You can cancel a subscription at any time from the campaign's billing
          settings. Cancelling stops future charges. You keep the paid plan{' '}
          <strong>until the end of the period you have already paid for</strong>,
          and the campaign becomes read-only after that.
        </p>
        <p>
          Cancelling is not the same as deleting. Your campaign and everything in
          it stays where it is; see below for what happens next.
        </p>
      </LegalSection>

      <LegalSection heading="Failed payments">
        <p>
          If a payment fails, Stripe retries it over roughly two to three weeks.
          Your campaign stays fully usable during that window — a failed payment
          does not lock anything immediately. If the retries are exhausted, the
          subscription ends and the campaign becomes read-only.
        </p>
      </LegalSection>

      <LegalSection heading="What read-only means">
        <p>
          When a campaign has no active subscription it is frozen:{' '}
          <strong>everyone can still read everything, and nobody can write</strong>.
          That includes players editing their own character sheets and journals,
          not just the DM. The whole campaign freezes together.
        </p>
        <p>
          Nothing is deleted at this point, and nothing is hidden. Subscribing
          again unlocks the campaign immediately, exactly as it was. You can also{' '}
          <strong>export the full campaign at any time</strong>, including while it
          is read-only.
        </p>
      </LegalSection>

      <LegalSection heading="Deletion of long-abandoned campaigns">
        <p>
          A campaign that has been read-only for <strong>three months</strong> is
          permanently deleted, along with its images. We email the campaign's owner{' '}
          <strong>30 days, 7 days and 1 day</strong> before that happens, and the
          countdown is shown in the app.
        </p>
        <p>
          You can always avoid deletion by subscribing again, or by exporting the
          campaign first. Once a campaign is deleted it cannot be recovered.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
          Deleting your account is separate and immediate — see the Privacy
          Policy.
        </p>
      </LegalSection>

      <LegalSection heading="Price changes">
        <p>
          If prices change, the new price applies from your next renewal, and you
          will be told before you are charged it. You can cancel before then if
          you do not want to continue.
        </p>
      </LegalSection>

      <LegalSection heading="How to ask for a refund">
        <p>
          Email us using the address at the foot of this page, from the address on
          your account, and say which charge you mean. {ENTITY_DISPLAY} will
          respond within a reasonable time.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
