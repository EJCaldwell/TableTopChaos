/**
 * stripe-webhook — the authoritative sync from Stripe → our database.
 *
 * Stripe calls this endpoint (server-to-server, no user JWT) whenever a
 * subscription's lifecycle changes. We verify the signature, then upsert the
 * matching public.campaign_subscriptions row so the app's entitlement helpers
 * (campaign_is_active / player_cap / storage_cap) always reflect reality.
 *
 * Events handled:
 *   - checkout.session.completed        — first activation after Checkout
 *   - customer.subscription.created     — subscription (incl. trialing) created
 *   - customer.subscription.updated     — status/interval/period changes, dunning
 *   - customer.subscription.deleted     — fully canceled → read-only
 *
 * Anti-abuse (one trial per card): when a subscription is `trialing` and we can
 * read its card fingerprint, we check trial_redemptions. A fingerprint already
 * used by a DIFFERENT campaign → the trial is CANCELLED (no charge) and the row
 * flagged so the UI can explain it; a new fingerprint is recorded so it can't
 * farm another trial later.
 *
 * IMPORTANT: this function must run with verify_jwt = false (configured in
 * supabase/config.toml) because Stripe cannot present a Supabase JWT. Its
 * authenticity comes from the Stripe signature check instead. All DB writes use
 * the service role (bypassing RLS), which is why campaign_subscriptions has no
 * client-facing write policy.
 */
import Stripe from 'npm:stripe@17.7.0'
import { cryptoProvider, serviceClient, stripe } from '../_shared/clients.ts'
import { INTERVAL_BY_PRICE, requireEnv } from '../_shared/config.ts'

/** Converts a Stripe unix-seconds timestamp to ISO, or null. */
function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null
}

/**
 * Reads the card fingerprint/brand/last4 for a subscription.
 *
 * Two-step design, and BOTH steps matter:
 *
 *   A. Resolve a payment-method *id* from the best available source:
 *      1. subscription.default_payment_method (what Checkout sets for our trials),
 *      2. else the customer's invoice-settings default,
 *      3. else the first card attached to the customer.
 *      Each campaign gets its own dedicated Stripe customer, so these all point
 *      at the one trial card.
 *
 *   B. RETRIEVE that payment method fresh by id. This is the non-obvious part:
 *      when a subscription is retrieved with `expand: ['default_payment_method']`,
 *      Stripe returns the PaymentMethod object WITHOUT its `card` sub-hash
 *      populated (brand/last4/fingerprint are absent). Reading `.card` straight
 *      off the expanded object therefore yields null — which is exactly the bug
 *      that silently disabled the one-trial-per-card rule (the fingerprint was
 *      never captured). A standalone paymentMethods.retrieve() returns the full
 *      object including `card`, so we always re-fetch by id here.
 *
 * @param sub - The Stripe Subscription (retrieved with default_payment_method expanded).
 * @returns { fingerprint, brand, last4 } — any field may be null if no card is on file.
 */
async function readCard(sub: Stripe.Subscription) {
  /** Pulls a PM id out of a value that may be an id string, an object, or null. */
  const pmId = (v: Stripe.PaymentMethod | string | null | undefined): string | null =>
    typeof v === 'string' ? v : (v?.id ?? null)

  // --- A. Resolve the payment-method id (first hit wins). ---
  // 1. The subscription's own default payment method.
  let id = pmId(sub.default_payment_method as Stripe.PaymentMethod | string | null)

  // 2. The customer's invoice-settings default.
  if (!id) {
    const customer = await stripe.customers.retrieve(sub.customer as string, {
      expand: ['invoice_settings.default_payment_method'],
    })
    // A deleted customer comes back as { deleted: true } with no settings.
    if (customer && !(customer as Stripe.DeletedCustomer).deleted) {
      id = pmId(
        (customer as Stripe.Customer).invoice_settings?.default_payment_method as
          | Stripe.PaymentMethod
          | string
          | null,
      )
    }
  }

  // 3. The first card attached to the customer.
  if (!id) {
    const cards = await stripe.paymentMethods.list({
      customer: sub.customer as string,
      type: 'card',
      limit: 1,
    })
    id = cards.data[0]?.id ?? null
  }

  // No payment method anywhere — nothing to fingerprint (shouldn't happen for a
  // trial started via our Checkout, which requires a card).
  if (!id) {
    console.error('stripe-webhook: no payment method for subscription', sub.id)
    return { fingerprint: null, brand: null, last4: null }
  }

  // --- B. Retrieve the PM fresh so the `card` hash is guaranteed populated. ---
  const pm = await stripe.paymentMethods.retrieve(id)
  const card = pm.card
  return {
    fingerprint: card?.fingerprint ?? null,
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
  }
}

/**
 * Upserts the campaign_subscriptions row for a subscription and applies the
 * trial anti-abuse rule. Idempotent: safe to call for every related event.
 * @param sub - The Stripe Subscription (freshly retrieved with expansions).
 */
async function syncSubscription(sub: Stripe.Subscription) {
  const admin = serviceClient()

  // Resolve which campaign this belongs to: prefer subscription metadata, else
  // fall back to the customer id we stored at checkout-session creation.
  let campaignId = (sub.metadata?.campaign_id as string | undefined) ?? null
  if (!campaignId) {
    const { data } = await admin
      .from('campaign_subscriptions')
      .select('campaign_id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()
    campaignId = data?.campaign_id ?? null
  }
  if (!campaignId) {
    console.error('stripe-webhook: no campaign_id for subscription', sub.id)
    return
  }

  const priceId = sub.items.data[0]?.price?.id ?? ''
  const interval = INTERVAL_BY_PRICE[priceId] ?? null
  // In the 2025 API the current period bounds live on the subscription item.
  // deno-lint-ignore no-explicit-any
  const item = sub.items.data[0] as any
  const currentPeriodEnd = toIso(item?.current_period_end ?? (sub as any).current_period_end)

  const card = await readCard(sub)

  // --- Anti-abuse: one trial per card fingerprint. ---
  // Set true when we cancel a reused-card trial, so the mirror upsert below can
  // flag the row for the billing UI ("this card already used its free trial").
  let trialBlockedReusedCard = false
  if (sub.status === 'trialing' && card.fingerprint) {
    const { data: prior } = await admin
      .from('trial_redemptions')
      .select('campaign_id')
      .eq('card_fingerprint', card.fingerprint)
      .maybeSingle()

    if (prior && prior.campaign_id !== campaignId) {
      // This card already used a trial elsewhere → CANCEL this trial now (no
      // charge). We deliberately do not bill: the DM should choose to subscribe
      // without a trial rather than be surprised by a charge. Cancelling a
      // $0 trialing subscription creates no invoice. The cancel fires a
      // customer.subscription.deleted event that re-syncs status to 'canceled';
      // the flag below is written into this same upsert (and omitted by that
      // later event) so it survives as a sticky marker. No redemption is recorded.
      await stripe.subscriptions.cancel(sub.id)
      trialBlockedReusedCard = true
    } else if (!prior) {
      // First use of this card for a trial — record it so it can't farm another.
      await admin.from('trial_redemptions').insert({
        card_fingerprint: card.fingerprint,
        campaign_id: campaignId,
      })
    }
  }

  // --- Upsert the mirror row. ---
  // trial_blocked_reused_card is included ONLY when we just set it true, so the
  // flag is sticky: later re-syncs (e.g. the cancel's deleted event) omit the
  // column and therefore never reset it.
  const { error } = await admin.from('campaign_subscriptions').upsert(
    {
      campaign_id: campaignId,
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      plan: 'pro',
      interval,
      status: sub.status,
      card_fingerprint: card.fingerprint,
      card_brand: card.brand,
      card_last4: card.last4,
      trial_end: toIso(sub.trial_end),
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      ...(trialBlockedReusedCard ? { trial_blocked_reused_card: true } : {}),
    },
    { onConflict: 'campaign_id' },
  )
  if (error) console.error('stripe-webhook: upsert failed', error)
}

Deno.serve(async (req) => {
  // Verify the Stripe signature over the RAW body — this is the endpoint's only
  // authentication, so a failure must reject the request.
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature.', { status: 400 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requireEnv('STRIPE_WEBHOOK_SIGNING_SECRET'),
      undefined,
      cryptoProvider,
    )
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err)
    return new Response('Invalid signature.', { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          // Retrieve with the payment method + price expanded so readCard works.
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
            { expand: ['default_payment_method'] },
          )
          await syncSubscription(sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = await stripe.subscriptions.retrieve(
          (event.data.object as Stripe.Subscription).id,
          { expand: ['default_payment_method'] },
        )
        await syncSubscription(sub)
        break
      }
      default:
        // Unhandled event types are acknowledged (200) so Stripe stops retrying.
        break
    }
  } catch (err) {
    // Return 500 so Stripe retries transient failures.
    console.error('stripe-webhook: handler error', err)
    return new Response('Handler error.', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
