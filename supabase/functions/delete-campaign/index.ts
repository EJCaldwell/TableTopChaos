/**
 * delete-campaign — deletes a campaign after cancelling its Stripe subscription
 * and removing its Storage files.
 *
 * Contract:
 *   POST { campaignId: string }
 *   → 200 { deleted: { campaignId, subscriptionsCanceled, mediaFiles } }
 *   → 400 { error } — campaignId missing
 *   → 401 { error } — not signed in
 *   → 403 { error } — not the owning DM
 *   → 404 { error } — no such campaign
 *   → 502 { error } — Stripe cancellation failed; NOTHING was deleted
 *
 * WHY THIS EXISTS. `deleteCampaign` used to be a plain client-side
 * `delete from campaigns`. The FK cascade removed the campaign_subscriptions
 * row, but nothing told Stripe — so **the card kept being charged indefinitely
 * while the customer had nothing to show for it**, and because the row was gone
 * there was no in-app trace at all. Not even support could see it. The same
 * class of bug 7.1 fixed for account deletion; this is the campaign-level twin.
 *
 * It also removes the campaign's Storage FILES. The cascade only removes
 * `media_assets` ROWS; the objects themselves survive, invisible to the app but
 * still occupying the bucket and counting toward storage caps. Every one of the
 * 46 orphans found in Phase 6 came from a campaign deleted this way.
 *
 * ORDER — each step placed so a failure leaves the least-bad state:
 *   1. Identify the caller from their JWT. Never from the body.
 *   2. Authorize: only the OWNER may delete, matching the old
 *      campaigns_delete_owner policy that migration 0034 removes.
 *   3. Cancel Stripe. **Abort the whole operation if this fails** — a campaign
 *      deleted with a live subscription is exactly the bug being fixed, and is
 *      strictly worse than a failed delete the user can retry.
 *   4. Delete Storage files.
 *   5. Delete the campaign row; FK cascades remove everything under it.
 *
 * Steps 4 and 5 are not atomic and cannot be. If 5 fails after 4 the campaign
 * survives having lost its images — visible, and retryable — which is better
 * than the reverse (files stranded in the bucket with nothing referencing them).
 */
import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, stripe, userClient } from '../_shared/clients.ts'

/** The `media` bucket holds every uploaded asset (original + thumbnail). */
const MEDIA_BUCKET = 'media'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    // --- 1. Identify the caller ------------------------------------------
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

    // --- 2. Authorize: owner only ----------------------------------------
    // Re-derived server-side from the JWT. This replaces the RLS policy dropped
    // in 0034 — the check has not been weakened, only moved to the one path that
    // can also reach Stripe.
    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .maybeSingle()
    if (campErr) {
      console.error('delete-campaign: lookup failed', campErr)
      return jsonResponse({ error: 'Could not delete the campaign.' }, 500)
    }
    if (!campaign) return jsonResponse({ error: 'Campaign not found.' }, 404)
    if (campaign.owner_id !== user.id) {
      return jsonResponse({ error: 'Only the campaign owner can delete it.' }, 403)
    }

    // --- 3. Cancel Stripe FIRST; abort on failure ------------------------
    const { data: subs, error: subErr } = await admin
      .from('campaign_subscriptions')
      .select('stripe_subscription_id, status')
      .eq('campaign_id', campaignId)
      .neq('status', 'canceled')
      .not('stripe_subscription_id', 'is', null)
    if (subErr) {
      console.error('delete-campaign: subscription lookup failed', subErr)
      return jsonResponse({ error: 'Could not delete the campaign.' }, 500)
    }

    let subscriptionsCanceled = 0
    for (const sub of subs ?? []) {
      try {
        // Immediate, not at period end: the campaign is about to stop existing,
        // so there is no remaining period to serve.
        await stripe.subscriptions.cancel(sub.stripe_subscription_id as string)
        subscriptionsCanceled++
      } catch (err) {
        // Already gone at Stripe's end — treat as success rather than blocking
        // deletion forever on a stale id.
        if ((err as { code?: string })?.code === 'resource_missing') {
          subscriptionsCanceled++
          continue
        }
        console.error('delete-campaign: FAILED to cancel', sub.stripe_subscription_id, err)
        return jsonResponse(
          {
            error:
              'Could not cancel this campaign’s subscription, so nothing was ' +
              'deleted. Please try again — if it keeps failing, cancel from the ' +
              'billing portal first so you are not charged for a deleted campaign.',
          },
          502,
        )
      }
    }

    // --- 4. Delete Storage files -----------------------------------------
    // Both paths per asset: original and thumbnail are separate objects, and
    // removing only the original leaves a visible thumbnail behind.
    const { data: assets, error: assetErr } = await admin
      .from('media_assets')
      .select('storage_path, thumb_path')
      .eq('campaign_id', campaignId)
    if (assetErr) {
      console.error('delete-campaign: media lookup failed', assetErr)
      return jsonResponse({ error: 'Could not delete the campaign.' }, 500)
    }

    const paths = (assets ?? [])
      .flatMap((a) => [a.storage_path, a.thumb_path])
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    let mediaFiles = 0
    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from(MEDIA_BUCKET).remove(paths)
      if (rmErr) {
        // Deliberately fatal. Continuing would delete the rows and strand the
        // files — unreachable through the API, since storage.objects is the
        // index rather than the bytes. Better to stop with everything intact.
        console.error('delete-campaign: storage removal failed', rmErr)
        return jsonResponse(
          { error: 'Could not remove this campaign’s images. Nothing was deleted.' },
          500,
        )
      }
      mediaFiles = paths.length
    }

    // --- 5. Delete the campaign; FKs cascade ------------------------------
    const { error: delErr } = await admin.from('campaigns').delete().eq('id', campaignId)
    if (delErr) {
      console.error('delete-campaign: delete failed', delErr)
      return jsonResponse(
        {
          error:
            'The subscription was cancelled and images removed, but the campaign ' +
            'itself could not be deleted. Please try again.',
        },
        500,
      )
    }

    console.log(
      `delete-campaign: ${campaignId} deleted by ${user.id} — ` +
        `${subscriptionsCanceled} subs cancelled, ${mediaFiles} files removed`,
    )

    return jsonResponse({
      deleted: { campaignId, subscriptionsCanceled, mediaFiles },
    })
  } catch (err) {
    console.error('delete-campaign error:', err)
    return jsonResponse({ error: 'Could not delete the campaign.' }, 500)
  }
})
