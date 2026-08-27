/**
 * campaigns/api.ts — typed data-access helpers for the campaign domain.
 *
 * Owns: every Supabase call related to campaigns, membership, and invite codes,
 * wrapped in small documented functions so screens don't embed query strings.
 * Each function notes the table/RPC it hits and the RLS policy that governs it.
 *
 * All calls run as the signed-in user, so Row-Level Security (migrations 0003–
 * 0004) is the real access control; these helpers assume nothing more.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A campaign row as stored. */
export type Campaign = Database['public']['Tables']['campaigns']['Row']
/** A member's role within a campaign. */
export type CampaignRole = Database['public']['Enums']['campaign_role']
/** An invite-code row as stored. */
export type InviteCode = Database['public']['Tables']['invite_codes']['Row']

/**
 * How a campaign plays (migration 0028). The three modes are cumulative tiers:
 *   'notetaker' — notes, sheets and DM tools only (the original app).
 *   'playspace' — notetaker + a shared grid battlemap (Phase 9).
 *   'rpg'       — playspace + round-based combat (Phase 10).
 * Every campaign defaults to 'notetaker', so existing campaigns are unaffected.
 */
export type GameMode = Database['public']['Enums']['game_mode']

/**
 * Ordered list of modes with copy for the pickers (create form + Overview).
 * Kept here so the two surfaces can never drift in wording or ordering; the
 * order is also the tier order (simplest → richest), which the switch-confirm
 * copy uses to tell "switching up" from "switching down".
 */
export const GAME_MODES: ReadonlyArray<{
  value: GameMode
  label: string
  description: string
}> = [
  {
    value: 'notetaker',
    label: 'Note taker',
    description: 'Character sheets, journals and DM tools. No map or combat tracker.',
  },
  {
    value: 'playspace',
    label: 'Playspace',
    description: 'Everything in Note taker, plus a shared battlemap with tokens.',
  },
  {
    value: 'rpg',
    label: 'Full RPG',
    description: 'Everything in Playspace, plus round-based combat on the map.',
  },
]

/**
 * Tier rank of a mode (0 = simplest). Used only for UI copy — deciding whether
 * a pending switch is "up" (unlocks features) or "down" (hides them).
 * @param mode - The mode to rank.
 * @returns Its index in GAME_MODES, or 0 for an unknown value.
 */
export function gameModeRank(mode: GameMode): number {
  const i = GAME_MODES.findIndex((m) => m.value === mode)
  return i === -1 ? 0 : i
}

/** A campaign paired with the caller's own role in it (dashboard list item). */
export interface CampaignWithRole {
  campaign: Campaign
  role: CampaignRole
}

/** A roster entry: a membership joined with that user's public profile. */
export interface Member {
  userId: string
  role: CampaignRole
  displayName: string | null
}

/**
 * Lists the campaigns the current user belongs to, with their role in each.
 *
 * Supabase call: select from `campaign_members` (filtered to the caller) with
 * the related `campaigns` row embedded.
 *  - RLS: campaign_members_select_members returns the caller's rows; the
 *    embedded campaigns row is allowed by campaigns_select_members.
 * @returns Array of { campaign, role }, newest campaign first.
 */
export async function listMyCampaigns(userId: string): Promise<CampaignWithRole[]> {
  const { data, error } = await supabase
    .from('campaign_members')
    .select('role, campaign:campaigns(*)')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? [])
    .filter((row): row is typeof row & { campaign: Campaign } => row.campaign != null)
    .map((row) => ({ campaign: row.campaign, role: row.role }))
    .sort((a, b) => b.campaign.created_at.localeCompare(a.campaign.created_at))
}

/**
 * Creates a new campaign owned by the current user.
 *
 * Supabase call: insert into `campaigns` (name, owner_id) returning the row.
 *  - RLS: campaigns_insert_own requires owner_id = auth.uid().
 *  - Side effect: the add_owner_as_dm trigger enrolls the owner as a DM member.
 * @param ownerId - The creating user's id (must equal their auth uid).
 * @param name - Campaign name (1–120 chars; enforced by a DB check too).
 * @param gameMode - Which mode the campaign starts in (defaults to
 *        'notetaker', matching the column default in migration 0028). The DM can
 *        change it later at any time via setGameMode.
 * @returns The created campaign row.
 */
export async function createCampaign(
  ownerId: string,
  name: string,
  gameMode: GameMode = 'notetaker',
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ owner_id: ownerId, name: name.trim(), game_mode: gameMode })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Permanently deletes a campaign and everything under it (DM/owner only).
 *
 * Edge Function: `delete-campaign`
 *  - Payload: `{ campaignId }`
 *  - Returns: `{ deleted: { campaignId, subscriptionsCanceled, mediaFiles } }`
 *  - Errors: 401 not signed in · 403 not the owner · 404 no such campaign ·
 *    **502 the Stripe cancellation failed and NOTHING was deleted** (retryable)
 *
 * WHY NOT A PLAIN DELETE ANY MORE. This used to be
 * `supabase.from('campaigns').delete()`, which tidied the database and **never
 * told Stripe** — so the card kept being charged for a campaign that no longer
 * existed, with no in-app trace, because campaign_subscriptions cascaded away
 * too. It also stranded the campaign's Storage files: the cascade removes
 * `media_assets` ROWS, not the objects themselves.
 *
 * Cancelling a subscription needs the Stripe secret key, so it can only happen
 * server-side. Migration 0034 removed the `campaigns_delete_owner` RLS policy so
 * a direct delete is no longer possible at all — the check is unchanged, but it
 * now lives in the one place that can also reach Stripe.
 *
 * @param campaignId - The campaign to delete.
 * @throws With the function's own message, which is written for the user and
 *         distinguishes "nothing was deleted, retry" from a partial failure.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-campaign', {
    body: { campaignId },
  })
  if (error) {
    // supabase-js wraps non-2xx responses; pull our JSON { error } out of the
    // raw Response so the user sees why, rather than a generic
    // "Edge Function returned a non-2xx status code".
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

/**
 * Renames a campaign. Enforced by RLS (campaigns_update_dm — DM only); a
 * non-DM's update matches no rows.
 * @param campaignId - The campaign to rename.
 * @param name - The new name (trimmed; caller validates non-empty).
 * @returns The updated campaign row.
 */
export async function renameCampaign(campaignId: string, name: string): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update({ name })
    .eq('id', campaignId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Switches a campaign's game mode (DM only).
 *
 * Supabase call: update `campaigns.game_mode` by id, returning the row.
 *  - RLS: campaigns_update_dm (DM only) — a player's update matches zero rows,
 *    which makes `.single()` throw, so the UI surfaces a failure rather than
 *    silently pretending the switch worked.
 *  - NON-DESTRUCTIVE: nothing is deleted when moving to a simpler mode. Higher-
 *    mode rows (playspace/combat) are merely not read while the campaign sits in
 *    a lower mode; switching back up restores them intact (see migration 0028).
 * @param campaignId - The campaign to change.
 * @param gameMode - The mode to switch to.
 * @returns The updated campaign row.
 */
export async function setGameMode(campaignId: string, gameMode: GameMode): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update({ game_mode: gameMode })
    .eq('id', campaignId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Joins a campaign by redeeming an invite code.
 *
 * Supabase call: RPC `redeem_invite_code(p_code)` (SECURITY DEFINER).
 *  - Validates expiry/uses/duplicate atomically server-side and enrolls the
 *    caller; throws with a human-readable message on any failure.
 * @param code - The invite code the user typed.
 * @returns The joined campaign's id (for navigation).
 */
export async function joinByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('redeem_invite_code', { p_code: code })
  // Supabase returns a PostgrestError (a plain object, NOT an Error instance), so
  // re-wrap it in a real Error to preserve the DB's human-readable message (e.g.
  // "This campaign's free trial is limited to N players…"). Without this the UI's
  // `err instanceof Error` check fails and it shows a generic fallback.
  if (error) throw new Error(error.message)
  return data
}

/**
 * Fetches a single campaign by id.
 * Supabase call: select from `campaigns` by id (RLS: members/owner only).
 */
export async function getCampaign(campaignId: string): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single()
  if (error) throw error
  return data
}

/**
 * Lists a campaign's roster with display names.
 *
 * Done as two queries because there is no direct FK from campaign_members to
 * profiles (both reference auth.users), so PostgREST can't embed them:
 *   1. membership rows (RLS: campaign_members_select_members),
 *   2. the matching profiles (RLS: profiles_select_comembers lets co-members
 *      read each other's display name).
 * @returns Roster entries with role + display name, the DM first.
 */
export async function listMembers(campaignId: string): Promise<Member[]> {
  const { data: members, error: mErr } = await supabase
    .from('campaign_members')
    .select('user_id, role')
    .eq('campaign_id', campaignId)
  if (mErr) throw mErr

  const ids = (members ?? []).map((m) => m.user_id)
  // Map user_id -> display_name. Empty roster short-circuits the profiles query.
  const names = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', ids)
    if (pErr) throw pErr
    for (const p of profiles ?? []) names.set(p.id, p.display_name)
  }

  return (members ?? [])
    .map((m) => ({
      userId: m.user_id,
      role: m.role,
      displayName: names.get(m.user_id) ?? null,
    }))
    // The DM first, then players by name, for a stable readable roster.
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'dm' ? -1 : 1
      return (a.displayName ?? '').localeCompare(b.displayName ?? '')
    })
}

/**
 * Lists a campaign's invite codes (DM only).
 * Supabase call: select from `invite_codes` by campaign (RLS: DM-only read).
 */
export async function listInviteCodes(campaignId: string): Promise<InviteCode[]> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Creates a new player invite code for a campaign (DM only).
 *
 * Supabase call: insert into `invite_codes`; `code` is auto-generated by the DB
 * default, so we only supply campaign_id and created_by.
 *  - RLS: invite_codes_insert_dm requires the caller be a DM of the campaign
 *    and created_by = auth.uid().
 *
 * The granted role is hard-coded to 'player' and is deliberately NOT a
 * parameter: a campaign has exactly one DM — the member the add_owner_as_dm
 * trigger enrolls at creation — so there is no supported way to invite someone
 * as a second DM.
 * @returns The created invite-code row (including the generated code).
 */
export async function createInviteCode(
  campaignId: string,
  createdBy: string,
): Promise<InviteCode> {
  const { data, error } = await supabase
    .from('invite_codes')
    .insert({ campaign_id: campaignId, created_by: createdBy, role: 'player' })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Revokes (deletes) an invite code (DM only).
 * Supabase call: delete from `invite_codes` by id (RLS: DM-only delete).
 */
export async function deleteInviteCode(codeId: string): Promise<void> {
  const { error } = await supabase.from('invite_codes').delete().eq('id', codeId)
  if (error) throw error
}
