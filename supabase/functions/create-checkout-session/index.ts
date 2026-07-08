/**
 * create-checkout-session — starts a Stripe Checkout session so a campaign's
 * owning DM can begin a Pro trial (or subscribe with immediate billing).
 *
 * Contract (called by the web app):
 *   POST { campaignId: string, interval: 'monthly'|'semiannual'|'annual',
 *          startTrial?: boolean }
 *   → 200 { url: string }   — redirect the browser here to complete Checkout
 *   → 4xx { error: string } — not signed in / not the owner / bad input
 *
 * Auth & authorization:
 *   - The caller's JWT (Authorization header) identifies the user; we never
 *     trust a client-supplied user id.
 *   - Only the campaign OWNER (the buying DM) may start Checkout. Enforced here
 *     server-side; the UI also hides the action.
 *
 * Trial vs. immediate billing:
 *   - The caller chooses EXPLICITLY via `startTrial` (the UI shows a "Start free
 *     trial" and a separate "Subscribe now" button). A trial is applied only
 *     when `startTrial === true` AND the campaign is eligible (never had a
 *     subscription). Any other combination — startTrial omitted/false, or a
 *     campaign that already used its trial — is immediate billing, so a DM can
 *     never accidentally re-trigger a trial (or get billed expecting one).
 *   - The definitive "one trial per CARD" anti-abuse check needs the card
 *     fingerprint, which only exists after the card is entered — so it is
 *     enforced in the stripe-webhook function, which now CANCELS (no charge) a
 *     trial started on a fingerprint already recorded in trial_redemptions.
 *
 * PCI: card data is entered on Stripe's hosted Checkout page, never here.
 */
import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, stripe, userClient } from '../_shared/clients.ts'
import {
  APP_URL,
  isBillingInterval,
  PRICE_BY_INTERVAL,
  TRIAL_PERIOD_DAYS,
} from '../_shared/config.ts'

Deno.serve(async (req) => {
  // Answer the browser's CORS preflight.
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    // --- Identify the caller from their JWT. ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Not signed in.' }, 401)
    const {
      data: { user },
      error: userErr,
    } = await userClient(authHeader).auth.getUser()
    if (userErr || !user) return jsonResponse({ error: 'Not signed in.' }, 401)

    // --- Validate input. ---
    // startTrial is an explicit opt-in from the UI's "Start free trial" button;
    // "Subscribe now" omits it (or sends false) for immediate billing.
    const { campaignId, interval, startTrial } = await req.json().catch(() => ({}))
    if (typeof campaignId !== 'string' || !isBillingInterval(interval)) {
      return jsonResponse({ error: 'campaignId and a valid interval are required.' }, 400)
    }
    const priceId = PRICE_BY_INTERVAL[interval]

    const admin = serviceClient()

    // --- Authorize: caller must OWN the campaign. ---
    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('id, name, owner_id')
      .eq('id', campaignId)
      .single()
    if (campErr || !campaign) return jsonResponse({ error: 'Campaign not found.' }, 404)
    if (campaign.owner_id !== user.id) {
      return jsonResponse({ error: 'Only the campaign owner can manage billing.' }, 403)
    }

    // --- Reuse or create the Stripe customer for this campaign. ---
    const { data: existing } = await admin
      .from('campaign_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    let customerId = existing?.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        // Metadata lets the webhook map Stripe objects back to our campaign.
        metadata: { campaign_id: campaignId, supabase_user_id: user.id },
      })
      customerId = customer.id
      // Persist the customer id immediately so retries reuse it (webhook fills
      // the rest). upsert on the unique campaign_id.
      await admin
        .from('campaign_subscriptions')
        .upsert(
          { campaign_id: campaignId, stripe_customer_id: customerId },
          { onConflict: 'campaign_id' },
        )
    }

    // A trial requires BOTH: the DM explicitly asked for one (startTrial) AND the
    // campaign is eligible (never had a subscription). This campaign-level gate is
    // also mirrored in the UI, which hides the trial button once ineligible.
    // (Cross-account same-card abuse is caught later in the webhook, which cancels
    // — not bills — a reused-card trial.)
    const eligibleForTrial = !existing?.stripe_subscription_id
    const applyTrial = startTrial === true && eligibleForTrial

    // --- Create the Checkout session. ---
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: campaignId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Card-only on purpose. The anti-abuse rule keys on a card FINGERPRINT
      // (one free trial per physical card). If Checkout is allowed to use its
      // automatic payment methods it offers Stripe Link, whose saved payment
      // method is type `link` with NO `card` hash — so the webhook can read no
      // fingerprint and the one-trial-per-card rule silently does nothing. Pinning
      // payment_method_types to ['card'] guarantees every trial saves a real card
      // we can fingerprint. Revisit if we ever add non-card billing.
      payment_method_types: ['card'],
      // Require a card even during the trial ($0 charged now); the trial ends
      // by cancelling if no usable payment method is on file.
      payment_method_collection: 'always',
      subscription_data: {
        metadata: { campaign_id: campaignId },
        ...(applyTrial
          ? {
              trial_period_days: TRIAL_PERIOD_DAYS,
              trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            }
          : {}),
      },
      // Stripe Tax: off for now (flip to true once registered — see plan's
      // Compliance & Operations note).
      automatic_tax: { enabled: false },
      success_url: `${APP_URL}/campaigns/${campaignId}?billing=success`,
      cancel_url: `${APP_URL}/campaigns/${campaignId}?billing=cancelled`,
    })

    return jsonResponse({ url: session.url })
  } catch (err) {
    console.error('create-checkout-session error:', err)
    return jsonResponse({ error: 'Could not start checkout.' }, 500)
  }
})
