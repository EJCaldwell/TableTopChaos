/**
 * profile/accountApi.ts — account-level destructive operations (Phase 7.1).
 *
 * Owns the two calls behind "delete my account": the read-only preview of what
 * would be destroyed, and the deletion itself. Kept separate from the profile
 * read/update code in ProfilePage because these are the only calls in the app
 * that cannot be undone, and they should be easy to find and audit.
 *
 * Nothing here decides *whether* deletion is allowed — the Edge Function
 * re-derives the caller from their JWT and re-checks the typed confirmation
 * server-side. The UI's confirmation step is a guard against mistakes, not a
 * security boundary.
 */
import { supabase } from '../../lib/supabase'

/** A campaign that will be destroyed outright, with its blast radius. */
export interface DeletionCampaign {
  id: string
  name: string
  /** Members who lose access when this campaign goes, including the owner. */
  member_count: number
}

/**
 * What deleting the signed-in user's account would remove.
 * Mirrors public.account_deletion_preview() in migration 0030.
 */
export interface DeletionPreview {
  /** Campaigns the user DMs. These are DELETED, for every member. */
  dm_campaigns: DeletionCampaign[]
  /** Campaigns where they are only a player — those campaigns survive. */
  player_campaign_count: number
  character_count: number
  /** The user's own uploads, across every campaign. */
  media_file_count: number
  media_byte_count: number
  /** Live Stripe subscriptions that will be cancelled. */
  active_subscription_count: number
}

/**
 * Fetches the deletion preview for the CALLING user.
 *
 * Supabase call: `.rpc('account_deletion_preview')` — no arguments by design.
 * The RPC reads `auth.uid()` itself, so there is no parameter that could be
 * pointed at somebody else's account. SECURITY DEFINER, granted to
 * `authenticated` only.
 *
 * @returns The preview, for rendering the confirmation screen.
 * @throws If the RPC errors (e.g. the session expired).
 */
export async function getDeletionPreview(): Promise<DeletionPreview> {
  const { data, error } = await supabase.rpc('account_deletion_preview')
  if (error) throw new Error(error.message)
  return data as unknown as DeletionPreview
}

/**
 * Permanently deletes the signed-in user's account. **Irreversible.**
 *
 * Edge Function: `delete-account`
 *  - Payload: `{ confirmation }` — must equal the caller's own email address.
 *    The function re-checks this server-side, so a stray or replayed request
 *    cannot destroy an account.
 *  - Returns: `{ deleted: { userId, subscriptionsCanceled, mediaFiles } }`
 *  - Errors: 400 confirmation mismatch · 401 not signed in · **502 a Stripe
 *    cancellation failed and NOTHING was deleted** (safe to retry) · 500 other.
 *
 * On success the account no longer exists, so the caller should sign out
 * immediately — the local session refers to a deleted user and every subsequent
 * request will fail.
 *
 * @param confirmation - The email address the user typed, verbatim.
 * @throws With the function's own message, which is written to be shown to the
 *         user (it distinguishes "nothing was deleted, retry" from a partial
 *         failure — a distinction that matters a great deal here).
 */
export async function deleteMyAccount(confirmation: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', {
    body: { confirmation },
  })
  if (error) {
    // supabase-js wraps non-2xx responses; pull our JSON { error } out of the
    // raw Response so the user sees the specific reason rather than a generic
    // "Edge Function returned a non-2xx status code". Which message they get
    // decides whether they should retry, so it must not be swallowed.
    let message = error.message
    try {
      const body = await (error as unknown as { context?: Response }).context?.json?.()
      if (body && typeof body.error === 'string') message = body.error
    } catch {
      /* fall back to error.message */
    }
    throw new Error(message)
  }
}
