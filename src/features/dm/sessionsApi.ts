/**
 * dm/sessionsApi.ts — typed data-access for the DM's session log / recaps (3.1).
 *
 * Access (migration 0017): campaign DM ONLY, for every operation — the session
 * log is the DM's private workspace and is invisible to players. RLS is the real
 * gate; a player calling these reads nothing and cannot write.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A session-log row as stored (title/date/recap/attendees + `position`). */
export type Session = Database['public']['Tables']['sessions']['Row']

/**
 * Lists a campaign's sessions in manual display order (position DESC, then
 * created_at DESC — a new session lands at the top).
 *  - RLS: sessions_select_dm.
 * @param campaignId - The campaign whose sessions to load.
 */
export async function listSessions(campaignId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Creates a new empty session at the given position.
 *  - RLS: sessions_insert_dm (campaign DM only).
 * @param campaignId - The owning campaign.
 * @param position - Sort position to assign (caller picks max+1 for "top").
 * @returns The created session row.
 */
export async function createSession(campaignId: string, position: number): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ campaign_id: campaignId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a session's title, date, recap, attendees, and/or position.
 *  - RLS: sessions_update_dm (campaign DM only).
 * `session_date` may be null to clear the date; `attendees` is the full new list.
 * @param id - The session id.
 * @param patch - The subset of editable columns to change.
 */
export async function updateSession(
  id: string,
  patch: Partial<Pick<Session, 'title' | 'session_date' | 'recap' | 'attendees' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('sessions').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a session (RLS: sessions_delete_dm — campaign DM only). */
export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual ordering. `orderedIds` is the TOP-TO-BOTTOM display order;
 * `listSessions` sorts by `position` DESCENDING, so we write descending
 * positions (topmost id gets the highest position) to reproduce this order.
 * @param orderedIds - Session ids in their new top-to-bottom display order.
 */
export async function reorderSessions(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateSession(id, { position: n - 1 - i })))
}
