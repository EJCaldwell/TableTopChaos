/**
 * cleanup-campaigns — the scheduled sweep that makes the Refunds page true.
 *
 * Contract (called by the Railway `cleanup` cron service, never by a browser):
 *   POST { dryRun?: boolean }
 *   header  x-cleanup-key: <CLEANUP_SECRET>
 *   → 200 { deleteEnabled, refreshed:{started,cleared}, onClock, dueForDelete,
 *            warned[], deleted[], skipped[], errors[] }
 *   → 401 { error } — missing/wrong cleanup key
 *   → 405 { error } — not a POST
 *   → 500 { error } — the sweep itself failed
 *
 * WHY THIS EXISTS. The Refunds page states that a campaign read-only for three
 * months is permanently deleted, with warning emails 30, 7 and 1 days before.
 * Until this function existed that sentence described nothing. Publishing it
 * would have been a false statement in a legal document — and the failure mode
 * of getting it wrong is destroying somebody's campaign after a warning they
 * never received, which is worse than not having the policy at all.
 *
 * AUTHENTICATION IS A SHARED SECRET, NOT A JWT. There is no user here: the
 * caller is a cron container. `x-cleanup-key` is compared against CLEANUP_SECRET
 * in constant time. The function is in the router's allow-list, so it is
 * reachable from the internet, and it deletes campaigns — an unauthenticated
 * route would be a remote mass-delete button.
 *
 * FIVE THINGS MUST ALL BE TRUE BEFORE ANY CAMPAIGN IS DELETED:
 *   1. private.billing_config.enforce_active   — else nothing is read-only.
 *   2. private.billing_config.lapse_delete_enabled — the second switch.
 *   3. CLEANUP_DELETE_ENABLED=true in this function's env — the third, and the
 *      one an operator can flip without database access, in a hurry.
 *   4. The grace window has expired (checked in SQL).
 *   5. The FINAL warning was sent successfully at least a day earlier
 *      (also SQL — `lapse_warned_days` is written only after Resend accepts).
 * Three of those are switches rather than one because the cost of this running
 * early is unrecoverable and the cost of it running late is zero.
 *
 * EMAIL DELIVERY IS PART OF THE SAFETY MODEL, NOT A NICETY. A warning is
 * recorded only after the provider accepts it. If Resend is unconfigured or
 * failing, `lapse_warned_days` stays null, interlock 5 never opens, and the
 * sweep warns forever without ever deleting anything. That is the intended
 * behaviour of a broken mailer — see PRE_LAUNCH: until a sending domain is
 * verified, Resend delivers only to the account owner's own address.
 *
 * ORDERING, per campaign, mirrors delete-campaign: cancel Stripe → remove
 * Storage files → delete the row. A failure at any step aborts THAT campaign
 * and is reported in `errors`; the sweep continues with the rest. One bad
 * campaign must not stop the other 200 from being processed.
 */
import { jsonResponse } from '../_shared/cors.ts'
import { serviceClient, stripe } from '../_shared/clients.ts'
import { APP_URL } from '../_shared/config.ts'

/** The `media` bucket holds every uploaded asset (original + thumbnail). */
const MEDIA_BUCKET = 'media'

/** Third kill-switch — env-level, flippable without database access. */
const DELETE_ENABLED = Deno.env.get('CLEANUP_DELETE_ENABLED') === 'true'

/** Resend credentials. Absent = warnings cannot be sent, so nothing is deleted. */
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? ''

/** One row of public.lapse_sweep_targets(). Mirrors the SQL return type. */
interface SweepTarget {
  campaign_id: string
  campaign_name: string | null
  owner_id: string
  owner_email: string | null
  read_only_since: string
  delete_after: string
  days_remaining: number
  warned_days: number | null
  warn_days: number | null
  due_for_delete: boolean
}

/**
 * Constant-time string comparison, used for the cleanup key.
 *
 * A plain `===` on a secret leaks its length and prefix through timing. The
 * exposure is small over the internet, but the mitigation is four lines and
 * this endpoint deletes campaigns.
 * @param a - Candidate value from the request header.
 * @param b - The configured secret.
 * @returns True when the two are byte-identical.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Builds the warning email for one campaign.
 *
 * Deliberately plain and specific: it names the campaign, says exactly what will
 * be destroyed and when, and gives the two ways out (resubscribe, or export).
 * A vague "action required" mail is indistinguishable from spam, and this is the
 * only notice a user gets before their data is gone.
 * @param t - The sweep target being warned.
 * @param days - The warning threshold being sent (30, 7 or 1).
 */
function warningEmail(t: SweepTarget, days: number): { subject: string; text: string } {
  const name = t.campaign_name?.trim() || 'your campaign'
  const when = days === 1 ? 'tomorrow' : `in ${days} days`
  const date = new Date(t.delete_after).toUTCString()
  return {
    subject:
      days === 1
        ? `Last notice: "${name}" is deleted tomorrow`
        : `"${name}" will be deleted in ${days} days`,
    text: [
      `Your TableTopChaos campaign "${name}" has been read-only since`,
      `${new Date(t.read_only_since).toUTCString()} because it has no active`,
      `subscription.`,
      ``,
      `It will be permanently deleted ${when} — ${date}.`,
      `That includes every character, note, quest and uploaded image in it.`,
      `Deletion cannot be undone.`,
      ``,
      `Two ways to keep it:`,
      `  * Subscribe again — the campaign unlocks immediately, exactly as it was.`,
      `  * Export it first — available at any time, including while read-only.`,
      ``,
      `Open the campaign: ${APP_URL}`,
      ``,
      `If you meant to let it go, you do not need to do anything.`,
    ].join('\n'),
  }
}

/**
 * Sends one warning email through Resend.
 *
 * Returns false rather than throwing on ANY failure — an unsendable warning must
 * degrade into "not warned yet" (so the deletion interlock stays shut), never
 * into an exception that aborts the sweep or, worse, a recorded warning that
 * unlocks deletion for mail nobody received.
 * @param to - Recipient address (the campaign owner's account email).
 * @param subject - Message subject.
 * @param text - Plain-text body.
 * @returns True only when Resend accepted the message.
 */
async function sendWarning(to: string, subject: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    console.error('cleanup-campaigns: RESEND_API_KEY/RESEND_FROM unset — cannot warn')
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
    })
    if (!res.ok) {
      // Body is logged because Resend's rejection reason (unverified domain,
      // suppressed recipient) is the actual diagnosis and is not inferable from
      // the status code alone.
      console.error(`cleanup-campaigns: Resend ${res.status}: ${await res.text()}`)
      return false
    }
    return true
  } catch (err) {
    console.error('cleanup-campaigns: Resend request failed', err)
    return false
  }
}

/**
 * Deletes one campaign: Stripe → Storage → row.
 *
 * Same order and the same reasoning as delete-campaign: a campaign deleted with
 * a live subscription keeps charging a card for something that no longer exists,
 * and deleting media_assets rows without their objects strands files in the
 * bucket forever (storage.objects is the index, not the bytes).
 * @param admin - Service-role Supabase client.
 * @param campaignId - The campaign to destroy.
 * @returns Files removed, or throws with a message naming the failed step.
 */
async function deleteCampaign(
  admin: ReturnType<typeof serviceClient>,
  campaignId: string,
): Promise<{ mediaFiles: number; subscriptionsCanceled: number }> {
  // --- Stripe first; abort this campaign if it fails ---------------------
  // A lapsed campaign's subscription is normally already canceled, so this is
  // usually a no-op. "Usually" is not "always": past_due counts as active, and
  // a campaign can reach the clock through a route that left a live sub behind.
  const { data: subs, error: subErr } = await admin
    .from('campaign_subscriptions')
    .select('stripe_subscription_id')
    .eq('campaign_id', campaignId)
    .neq('status', 'canceled')
    .not('stripe_subscription_id', 'is', null)
  if (subErr) throw new Error(`subscription lookup failed: ${subErr.message}`)

  let subscriptionsCanceled = 0
  for (const sub of subs ?? []) {
    try {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id as string)
      subscriptionsCanceled++
    } catch (err) {
      // Already gone at Stripe's end is success, not an obstacle.
      if ((err as { code?: string })?.code === 'resource_missing') {
        subscriptionsCanceled++
        continue
      }
      throw new Error(`Stripe cancel failed for ${sub.stripe_subscription_id}`)
    }
  }

  // --- Storage files -----------------------------------------------------
  const { data: assets, error: assetErr } = await admin
    .from('media_assets')
    .select('storage_path, thumb_path')
    .eq('campaign_id', campaignId)
  if (assetErr) throw new Error(`media lookup failed: ${assetErr.message}`)

  const paths = (assets ?? [])
    .flatMap((a: { storage_path: string | null; thumb_path: string | null }) => [
      a.storage_path,
      a.thumb_path,
    ])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)

  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(MEDIA_BUCKET).remove(paths)
    if (rmErr) throw new Error(`storage removal failed: ${rmErr.message}`)
  }

  // --- The row; FKs cascade ---------------------------------------------
  const { error: delErr } = await admin.from('campaigns').delete().eq('id', campaignId)
  if (delErr) throw new Error(`campaign delete failed: ${delErr.message}`)

  return { mediaFiles: paths.length, subscriptionsCanceled }
}

Deno.serve(async (req) => {
  // No CORS preflight handling on purpose: no browser ever calls this, and
  // answering preflights would advertise it to one.
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const secret = Deno.env.get('CLEANUP_SECRET') ?? ''
  const presented = req.headers.get('x-cleanup-key') ?? ''
  // An unset secret denies everything rather than allowing everything. A
  // misconfigured deploy must fail closed on a mass-delete endpoint.
  if (!secret || !safeEqual(presented, secret)) {
    return jsonResponse({ error: 'Unauthorized.' }, 401)
  }

  const { dryRun } = await req.json().catch(() => ({ dryRun: false }))
  const admin = serviceClient()

  const warned: unknown[] = []
  const deleted: unknown[] = []
  const skipped: unknown[] = []
  const errors: string[] = []

  try {
    // --- 1. Reconcile every clock -----------------------------------------
    // Runs even in dry-run: starting and clearing clocks is not destructive,
    // and a dry run against stale state tells you nothing useful.
    const { data: refreshRows, error: refreshErr } = await admin.rpc('refresh_lapse_state')
    if (refreshErr) throw new Error(`refresh_lapse_state failed: ${refreshErr.message}`)
    const refreshed = Array.isArray(refreshRows)
      ? refreshRows[0]
      : { started: 0, cleared: 0 }

    // --- 2. The work list --------------------------------------------------
    const { data: targets, error: targetErr } = await admin.rpc('lapse_sweep_targets')
    if (targetErr) throw new Error(`lapse_sweep_targets failed: ${targetErr.message}`)
    const rows = (targets ?? []) as SweepTarget[]

    // The two DB switches are already folded into due_for_delete by the SQL.
    // Reporting the env switch separately is what makes a run that deliberately
    // did nothing legible: "0 deleted" and "0 deleted because deletion is off"
    // look identical otherwise.
    const dueForDelete = rows.filter((r) => r.due_for_delete).length

    for (const t of rows) {
      // --- 3. Warnings ----------------------------------------------------
      if (t.warn_days !== null) {
        if (!t.owner_email) {
          // No address to warn: the interlock keeps this campaign alive
          // indefinitely, which is the correct outcome, but it needs saying.
          skipped.push({ campaign: t.campaign_id, reason: 'owner has no email' })
        } else if (dryRun) {
          warned.push({ campaign: t.campaign_id, days: t.warn_days, dryRun: true })
        } else {
          const { subject, text } = warningEmail(t, t.warn_days)
          const ok = await sendWarning(t.owner_email, subject, text)
          if (ok) {
            // Recorded ONLY after acceptance — this write is what opens the
            // deletion interlock, so it must never run for unsent mail.
            const { error: recErr } = await admin.rpc('record_lapse_warning', {
              p_campaign_id: t.campaign_id,
              p_days: t.warn_days,
            })
            if (recErr) errors.push(`record_lapse_warning ${t.campaign_id}: ${recErr.message}`)
            else warned.push({ campaign: t.campaign_id, days: t.warn_days })
          } else {
            errors.push(`warning email failed for ${t.campaign_id} — not recorded`)
          }
        }
      }

      // --- 4. Deletion ------------------------------------------------------
      if (!t.due_for_delete) continue
      if (!DELETE_ENABLED) {
        skipped.push({ campaign: t.campaign_id, reason: 'CLEANUP_DELETE_ENABLED is not true' })
        continue
      }
      if (dryRun) {
        deleted.push({ campaign: t.campaign_id, dryRun: true })
        continue
      }
      try {
        const result = await deleteCampaign(admin, t.campaign_id)
        // Logged individually and loudly: this is the irreversible line, and
        // after the fact the log is the only record that the campaign existed.
        console.log(
          `cleanup-campaigns: DELETED ${t.campaign_id} ("${t.campaign_name}") ` +
            `owner=${t.owner_id} read_only_since=${t.read_only_since} ` +
            `files=${result.mediaFiles} subs=${result.subscriptionsCanceled}`,
        )
        deleted.push({ campaign: t.campaign_id, ...result })
      } catch (err) {
        errors.push(`delete ${t.campaign_id}: ${(err as Error).message}`)
      }
    }

    console.log(
      `cleanup-campaigns: dryRun=${!!dryRun} deleteEnabled=${DELETE_ENABLED} ` +
        `started=${refreshed?.started} cleared=${refreshed?.cleared} ` +
        `onClock=${rows.length} due=${dueForDelete} warned=${warned.length} ` +
        `deleted=${deleted.length} ` +
        `skipped=${skipped.length} errors=${errors.length}`,
    )

    return jsonResponse({
      dryRun: !!dryRun,
      deleteEnabled: DELETE_ENABLED,
      refreshed,
      onClock: rows.length,
      dueForDelete,
      warned,
      deleted,
      skipped,
      errors,
    })
  } catch (err) {
    console.error('cleanup-campaigns error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
