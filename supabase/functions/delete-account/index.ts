/**
 * delete-account — permanently deletes the CALLING user's account (Phase 7.1).
 *
 * Contract:
 *   POST { confirmation: string }   — must equal the caller's own email
 *   → 200 { deleted: { campaigns, characters, mediaFiles, subscriptionsCanceled } }
 *   → 400 { error } — confirmation missing or mismatched
 *   → 401 { error } — not signed in
 *   → 502 { error } — a Stripe cancellation failed; NOTHING was deleted
 *   → 500 { error } — anything else; see the ordering note below for what may
 *                     already have happened
 *
 * This is the GDPR/CCPA right-to-erasure path, and it is deliberately immediate
 * and unrecoverable: no soft-delete flag, no grace period, no scheduler. That
 * choice keeps a `deleted_at` predicate out of the RLS policies on all 29 tables,
 * where one missed clause would leak a "deleted" user's content.
 *
 * WHY AN EDGE FUNCTION AND NOT AN RPC: two of the three jobs are outside
 * Postgres. Stripe subscriptions must be cancelled over the API, and Storage
 * objects must be deleted through storage-api. A SQL-only implementation would
 * remove the rows and leave a live subscription billing a person who no longer
 * has an account.
 *
 * ORDER IS THE WHOLE DESIGN — each step is placed so that a failure leaves the
 * least-bad state:
 *
 *   1. Identify the caller from their JWT. Never from the request body.
 *   2. Require an explicit typed confirmation matching their email. The UI also
 *      asks, but a server-side check means no accidental invocation — including
 *      by a stray fetch or a replayed request — can destroy an account.
 *   3. Read the out-of-Postgres targets (Stripe subscription ids, Storage paths)
 *      while the rows still exist. After step 6 this information is gone.
 *   4. Cancel Stripe subscriptions. If ANY cancellation fails, ABORT before
 *      deleting anything. A user with no account but a live subscription keeps
 *      being charged with no way to stop it — strictly worse than a failed
 *      deletion they can retry.
 *   5. Delete their own Storage objects and media_assets rows, while
 *      `uploaded_by` still points at them (it is ON DELETE SET NULL, so after
 *      step 6 their uploads become unattributable and unfindable).
 *   6. Delete the auth.users row. 35 foreign keys cascade from here: campaigns
 *      they DM (with all content, for every member), their characters in other
 *      people's campaigns, memberships, invites, RSVPs, and their profile.
 *
 * Steps 5 and 6 are not atomic across systems and cannot be. If 6 fails after 5,
 * the account survives having lost its uploads — recoverable by retrying, and
 * far better than the reverse (files orphaned in a bucket with nothing pointing
 * at them, i.e. an erasure that silently did not erase).
 *
 * `trial_redemptions` deliberately SURVIVES this (its campaign_id is
 * ON DELETE SET NULL). The one-trial-per-card control has to outlive the account
 * or deleting your account resets it. See 0030 and PLANNING 7.2 — the privacy
 * policy must disclose that retention.
 */
import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, stripe, userClient } from '../_shared/clients.ts'

/** The `media` bucket holds every uploaded asset (original + thumbnail). */
const MEDIA_BUCKET = 'media'

/**
 * The out-of-Postgres work, gathered with the service role.
 *
 * Read via two direct table queries rather than an RPC. 0030 originally added a
 * `public.account_deletion_targets(uuid)` helper for this and 0031 dropped it:
 * Postgres grants EXECUTE on a new function to PUBLIC by default, and this
 * stack's default privileges additionally grant it to `authenticated` by name,
 * so the RPC was callable by any signed-in user with somebody else's user id —
 * returning their Storage paths. The service role bypasses RLS anyway, so a
 * privileged RPC bought nothing and cost a leak. See migration 0031.
 */
interface DeletionTargets {
  media: { asset_id: string; storage_path: string | null; thumb_path: string | null }[]
  subscriptions: { stripe_subscription_id: string }[]
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    // --- 1. Identify the caller from the JWT, never from the body ----------
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Not signed in.' }, 401)
    const {
      data: { user },
      error: userErr,
    } = await userClient(authHeader).auth.getUser()
    if (userErr || !user) return jsonResponse({ error: 'Not signed in.' }, 401)

    // --- 2. Require a typed confirmation ----------------------------------
    // Matched against the email rather than the display name: display_name is
    // nullable and non-unique, so it cannot be a reliable confirmation token.
    const { confirmation } = await req.json().catch(() => ({}))
    const expected = (user.email ?? '').trim().toLowerCase()
    if (
      typeof confirmation !== 'string' ||
      !expected ||
      confirmation.trim().toLowerCase() !== expected
    ) {
      return jsonResponse(
        { error: 'Type your email address exactly to confirm deletion.' },
        400,
      )
    }

    const admin = serviceClient()

    // --- 3. Read the out-of-Postgres targets, while the rows still exist ---
    // Two service-role queries. Both must succeed before anything is destroyed:
    // acting on a partial picture is how you cancel one subscription of two, or
    // delete a user whose files are still in the bucket.

    // Their own uploads, across every campaign — including campaigns belonging
    // to other people, where `uploaded_by` would otherwise be SET NULL and the
    // files left behind unattributable.
    const { data: mediaRows, error: mediaErr } = await admin
      .from('media_assets')
      .select('id, storage_path, thumb_path')
      .eq('uploaded_by', user.id)
    if (mediaErr) {
      console.error('delete-account: could not read media:', mediaErr)
      return jsonResponse({ error: 'Could not prepare deletion. Nothing was deleted.' }, 500)
    }

    // Live subscriptions on campaigns they own. Two steps rather than a join so
    // a PostgREST embedding change cannot silently return the wrong set — the
    // consequence of missing one here is a deleted user who keeps being billed.
    const { data: ownedCampaigns, error: campErr } = await admin
      .from('campaigns')
      .select('id')
      .eq('owner_id', user.id)
    if (campErr) {
      console.error('delete-account: could not read campaigns:', campErr)
      return jsonResponse({ error: 'Could not prepare deletion. Nothing was deleted.' }, 500)
    }

    let subscriptions: { stripe_subscription_id: string }[] = []
    if ((ownedCampaigns ?? []).length > 0) {
      const { data: subRows, error: subErr } = await admin
        .from('campaign_subscriptions')
        .select('stripe_subscription_id, status')
        .in('campaign_id', (ownedCampaigns ?? []).map((c) => c.id))
        // Anything not already cancelled is a live Stripe object: active,
        // trialing, past_due, unpaid and incomplete all still bill or can resume.
        .neq('status', 'canceled')
        .not('stripe_subscription_id', 'is', null)
      if (subErr) {
        console.error('delete-account: could not read subscriptions:', subErr)
        return jsonResponse({ error: 'Could not prepare deletion. Nothing was deleted.' }, 500)
      }
      subscriptions = (subRows ?? []) as { stripe_subscription_id: string }[]
    }

    const targets: DeletionTargets = {
      media: (mediaRows ?? []).map((m) => ({
        asset_id: m.id,
        storage_path: m.storage_path,
        thumb_path: m.thumb_path,
      })),
      subscriptions,
    }

    // --- 4. Cancel Stripe subscriptions — abort the whole thing on failure -
    // Sequential, not Promise.all: on a partial failure we must know exactly
    // which ones were cancelled, and cancelling is not free of side effects.
    let subscriptionsCanceled = 0
    for (const sub of targets.subscriptions ?? []) {
      try {
        // Immediate cancellation, not at period end: the campaign is about to
        // cease existing, so there is no remaining period to serve.
        await stripe.subscriptions.cancel(sub.stripe_subscription_id)
        subscriptionsCanceled++
      } catch (err) {
        // `resource_missing` means Stripe has no such subscription — already
        // gone, so treat it as success rather than blocking deletion forever on
        // a stale row.
        const code = (err as { code?: string })?.code
        if (code === 'resource_missing') {
          subscriptionsCanceled++
          continue
        }
        console.error(
          `delete-account: FAILED to cancel ${sub.stripe_subscription_id}:`,
          err,
        )
        return jsonResponse(
          {
            error:
              'Could not cancel an active subscription, so nothing was deleted. ' +
              'Please try again — if it keeps failing, cancel from the billing ' +
              'portal first so you are not charged.',
          },
          502,
        )
      }
    }

    // --- 5. Delete their own uploads (files first, then rows) -------------
    // Both paths per asset: original and thumbnail are separate objects, and
    // removing only the original leaves a visible thumbnail behind.
    const paths = (targets.media ?? [])
      .flatMap((m) => [m.storage_path, m.thumb_path])
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    let mediaFiles = 0
    if (paths.length > 0) {
      // storage-api takes a batch; a missing object is not an error here, which
      // matters because a previous partial run may already have removed some.
      const { error: rmErr } = await admin.storage.from(MEDIA_BUCKET).remove(paths)
      if (rmErr) {
        console.error('delete-account: storage removal failed:', rmErr)
        return jsonResponse(
          { error: 'Could not remove your uploaded files. Nothing was deleted.' },
          500,
        )
      }
      mediaFiles = paths.length

      // Then the rows, so nothing points at objects that no longer exist. Rows
      // in campaigns the user DMs would cascade at step 6 anyway; this also
      // catches uploads they made into OTHER people's campaigns, which would
      // otherwise survive with uploaded_by set to null.
      const assetIds = (targets.media ?? []).map((m) => m.asset_id)
      const { error: rowErr } = await admin
        .from('media_assets')
        .delete()
        .in('id', assetIds)
      if (rowErr) {
        // The files are already gone, so failing here leaves rows pointing at
        // nothing — broken images rather than leaked ones. Logged and continued
        // deliberately: stopping now would leave a WORSE state (an account that
        // still exists but whose images are all broken).
        console.error('delete-account: media_assets cleanup failed:', rowErr)
      }
    }

    // --- 5b. Tombstone, BEFORE the user row goes --------------------------
    // Why this exists: backups are a pg_dump of the whole database, auth.users
    // included, so restoring one taken before this moment brings the person back
    // — password hash and all — silently undoing a right-to-erasure request.
    // Nothing else would record that the deletion happened, leaving no way to
    // know afterwards whose data should not be there.
    //
    // Written BEFORE step 6 and treated as fatal: erasing someone without a
    // record that they were erased is the failure this whole table exists to
    // prevent, so proceeding on error would defeat the point. Retrying is safe
    // (user_id is the primary key, and the upsert is a no-op second time).
    //
    // WHY NOT EARLIER — this is load-bearing. It would be tidier to write the
    // tombstone first and abort before destroying anything, but a tombstone for
    // an account that still exists is ACTIVELY DANGEROUS: the re-application
    // sweep (railway/scripts/91_reapply_deletions.sql) deletes any auth.users row
    // named in this table, on every migrate deploy. So a tombstone written before
    // a deletion that then failed would silently destroy a live account at the
    // next deploy. It must therefore be written as late as possible while still
    // preceding the deletion — here, once cancellation and file removal have
    // already succeeded and step 6 is the only thing left.
    //
    // The hash is SHA-256 of the lowercased email so a later support question
    // can be answered without storing addresses. Computed here with Web Crypto
    // rather than in SQL to avoid depending on the pgcrypto extension.
    const emailBytes = new TextEncoder().encode(expected)
    const digest = await crypto.subtle.digest('SHA-256', emailBytes)
    const emailSha256 = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const { error: tombErr } = await admin.from('deleted_accounts').upsert(
      {
        user_id: user.id,
        email_sha256: emailSha256,
        campaigns_deleted: (ownedCampaigns ?? []).length,
        // `mediaFiles`, not `targets.media.length` — the column says FILES and
        // each asset is two Storage objects (original + thumbnail), so counting
        // assets here would record half the true figure. It is a compliance
        // record: in a year, "how much was removed?" has to have one answer, and
        // it must agree with the number returned to the caller below.
        media_files_deleted: mediaFiles,
        subscriptions_canceled: subscriptionsCanceled,
      },
      { onConflict: 'user_id' },
    )
    if (tombErr) {
      console.error('delete-account: tombstone write failed:', tombErr)
      return jsonResponse(
        {
          // Honest about the partial state: subscriptions are cancelled and
          // uploaded files are already gone at this point. Saying "nothing was
          // deleted" would be a lie, and the user needs to know a retry finishes
          // the job rather than starting it over.
          error:
            'Your subscriptions were cancelled and uploads removed, but the ' +
            'deletion could not be recorded, so the account still exists. ' +
            'Please try again to finish deleting it.',
        },
        500,
      )
    }

    // --- 6. Delete the user; 35 foreign keys cascade from here ------------
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) {
      console.error('delete-account: auth user deletion failed:', delErr)
      return jsonResponse(
        {
          error:
            'Your subscriptions were cancelled and uploads removed, but the ' +
            'account itself could not be deleted. Please try again.',
        },
        500,
      )
    }

    // Counted from the preview's perspective for the confirmation message. The
    // cascade makes exact post-hoc counts impossible to read back — the rows are
    // already gone — so these are what we acted on, not a re-query.
    console.log(
      `delete-account: deleted ${user.id} — ${subscriptionsCanceled} subs cancelled, ` +
        `${mediaFiles} files removed`,
    )

    return jsonResponse({
      deleted: {
        userId: user.id,
        subscriptionsCanceled,
        mediaFiles,
      },
    })
  } catch (err) {
    console.error('delete-account error:', err)
    return jsonResponse({ error: 'Could not delete your account.' }, 500)
  }
})
