/**
 * create-billing-portal-session — opens the Stripe billing portal so a
 * campaign's owning DM can manage their subscription (update card, cancel,
 * switch interval).
 *
 * Contract:
 *   POST { campaignId: string }
 *   → 200 { url: string }   — redirect the browser here
 *   → 4xx { error: string } — not signed in / not owner / no customer yet
 *
 * Authorization mirrors create-checkout-session: only the campaign OWNER may
 * open the portal, enforced server-side from the caller's JWT.
 */
import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, stripe, userClient } from '../_shared/clients.ts'
import { APP_URL } from '../_shared/config.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    // Identify the caller.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Not signed in.' }, 401)
    const {
      data: { user },
      error: userErr,
    } = await userClient(authHeader).auth.getUser()
    if (userErr || !user) return jsonResponse({ error: 'Not signed in.' }, 401)

    const { campaignId } = await req.json().catch(() => ({}))
    if (typeof campaignId !== 'string') {
      return jsonResponse({ error: 'campaignId is required.' }, 400)
    }

    const admin = serviceClient()

    // Authorize: caller must own the campaign.
    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .single()
    if (campErr || !campaign) return jsonResponse({ error: 'Campaign not found.' }, 404)
    if (campaign.owner_id !== user.id) {
      return jsonResponse({ error: 'Only the campaign owner can manage billing.' }, 403)
    }

    // Need an existing Stripe customer (created during first checkout).
    const { data: sub } = await admin
      .from('campaign_subscriptions')
      .select('stripe_customer_id')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    if (!sub?.stripe_customer_id) {
      return jsonResponse({ error: 'No billing account yet. Start a subscription first.' }, 400)
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_URL}/campaigns/${campaignId}`,
    })

    return jsonResponse({ url: portal.url })
  } catch (err) {
    console.error('create-billing-portal-session error:', err)
    return jsonResponse({ error: 'Could not open billing portal.' }, 500)
  }
})
