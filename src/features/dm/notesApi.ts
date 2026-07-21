/**
 * dm/notesApi.ts — typed data-access for the DM's private campaign notes (3.1).
 *
 * Access (migration 0017): campaign DM ONLY, for every operation. These are the
 * DM's private workspace — players and non-members match no policy and see
 * nothing. Every call here runs as the signed-in user; RLS is the real gate, so
 * a player calling these gets empty reads and blocked writes regardless.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A DM note row as stored (title/body/tags + manual `position`). */
export type DmNote = Database['public']['Tables']['dm_notes']['Row']

/**
 * Lists a campaign's DM notes in manual display order. `listNotes` sorts by
 * `position` DESCENDING then `created_at` DESCENDING, so a freshly added note
 * (highest position) lands at the top.
 *  - RLS: dm_notes_select_dm.
 * @param campaignId - The campaign whose notes to load.
 */
export async function listNotes(campaignId: string): Promise<DmNote[]> {
  const { data, error } = await supabase
    .from('dm_notes')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Creates a new empty note at the given position.
 *  - RLS: dm_notes_insert_dm (campaign DM only).
 * @param campaignId - The owning campaign.
 * @param position - The sort position to assign (caller picks max+1 for "top").
 * @returns The created note row.
 */
export async function createNote(campaignId: string, position: number): Promise<DmNote> {
  const { data, error } = await supabase
    .from('dm_notes')
    .insert({ campaign_id: campaignId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a note's title, body, tags, and/or position.
 *  - RLS: dm_notes_update_dm (campaign DM only).
 * @param id - The note id.
 * @param patch - The subset of editable columns to change.
 */
export async function updateNote(
  id: string,
  patch: Partial<Pick<DmNote, 'title' | 'body' | 'tags' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('dm_notes').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a note (RLS: dm_notes_delete_dm — campaign DM only). */
export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('dm_notes').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual ordering. `orderedIds` is the TOP-TO-BOTTOM display order;
 * because `listNotes` sorts by `position` DESCENDING, we write descending
 * positions (the topmost id gets the highest position) so the next load
 * reproduces exactly this order.
 * @param orderedIds - Note ids in their new top-to-bottom display order.
 */
export async function reorderNotes(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateNote(id, { position: n - 1 - i })))
}
