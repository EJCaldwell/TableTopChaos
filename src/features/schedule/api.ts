/**
 * schedule/api.ts — data access for shared session scheduling (migration 0026):
 * `schedule_sessions` (DM-proposed play dates) and `schedule_rsvps` (each
 * member's yes/maybe/no). RLS: members read both; DM writes sessions; a member
 * writes only their own rsvp.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A proposed/confirmed play session. */
export type ScheduleSession = Database['public']['Tables']['schedule_sessions']['Row']
/** One member's availability for a session. */
export type ScheduleRsvp = Database['public']['Tables']['schedule_rsvps']['Row']
/** The three availability states. */
export type RsvpStatus = 'yes' | 'maybe' | 'no'

/** An rsvp joined with the responder's display name (for the tally list). */
export interface RsvpWithName extends ScheduleRsvp {
  display_name: string | null
}

/**
 * Lists a campaign's proposed sessions, soonest dated first (undated last).
 * @param campaignId - The campaign whose sessions to load.
 */
export async function listSessions(campaignId: string): Promise<ScheduleSession[]> {
  const { data, error } = await supabase
    .from('schedule_sessions')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('proposed_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Creates a proposed session (DM only). */
export async function createSession(
  campaignId: string,
  patch: Pick<ScheduleSession, 'title' | 'proposed_at' | 'notes'>,
  position: number,
): Promise<ScheduleSession> {
  const { data, error } = await supabase
    .from('schedule_sessions')
    .insert({ campaign_id: campaignId, position, ...patch })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a session's title/time/notes (DM only). */
export async function updateSession(
  id: string,
  patch: Partial<Pick<ScheduleSession, 'title' | 'proposed_at' | 'notes'>>,
): Promise<void> {
  const { error } = await supabase.from('schedule_sessions').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a session (its rsvps cascade). DM only. */
export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('schedule_sessions').delete().eq('id', id)
  if (error) throw error
}

/**
 * Lists every rsvp for the given sessions, with responder display names, so the
 * UI can show the full tally. Empty-safe.
 * @param sessionIds - The sessions whose rsvps to fetch.
 */
export async function listRsvps(sessionIds: string[]): Promise<RsvpWithName[]> {
  if (sessionIds.length === 0) return []
  // NOTE: we can't use a PostgREST embed (profiles(display_name)) here because
  // schedule_rsvps.user_id references auth.users, not profiles — there's no FK
  // relationship for PostgREST to resolve, so an embed errors. Instead fetch the
  // rsvps, then resolve display names from profiles in a second query.
  const { data, error } = await supabase
    .from('schedule_rsvps')
    .select('*')
    .in('session_id', sessionIds)
  if (error) throw error
  const rows = data ?? []

  const userIds = [...new Set(rows.map((r) => r.user_id))]
  const names = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds)
    for (const p of profiles ?? []) names.set(p.id, p.display_name)
  }
  return rows.map((r) => ({ ...r, display_name: names.get(r.user_id) ?? null }))
}

/**
 * Sets the caller's rsvp for a session (upsert on the unique session+user).
 * @param sessionId - The session being answered.
 * @param userId - The caller (must equal auth.uid(); RLS enforces).
 * @param status - yes / maybe / no.
 */
export async function setRsvp(sessionId: string, userId: string, status: RsvpStatus): Promise<void> {
  const { error } = await supabase
    .from('schedule_rsvps')
    .upsert({ session_id: sessionId, user_id: userId, status }, { onConflict: 'session_id,user_id' })
  if (error) throw error
}
