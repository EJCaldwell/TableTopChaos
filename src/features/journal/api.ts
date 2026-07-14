/**
 * journal/api.ts — typed data-access for a character's PRIVATE journal (2.4).
 *
 * Access (migration 0015): owner read/write only; the campaign DM can read an
 * entry ONLY when `shared = true`; other players never. So the DM does not see a
 * player's journal unless the player explicitly shares an entry. All calls run as
 * the signed-in user — RLS enforces the above regardless of what we request here.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A journal entry row as stored. */
export type JournalEntry = Database['public']['Tables']['journal_entries']['Row']

/**
 * Lists a character's journal entries, newest first (by position desc then
 * created_at desc — new entries get the highest position).
 *  - RLS: journal_entries_select_owner_or_shared_dm.
 * @param characterId - The owning character.
 */
export async function listEntries(characterId: string): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('character_id', characterId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Creates a new (private) entry at a given position.
 *  - RLS: journal_entries_insert_owner (owner only). `shared` defaults false.
 * @returns The created entry row.
 */
export async function createEntry(
  characterId: string,
  position: number,
): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({ character_id: characterId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates an entry's title, body, and/or shared flag.
 *  - RLS: journal_entries_update_owner (owner only — the DM can never write).
 */
export async function updateEntry(
  id: string,
  patch: Partial<Pick<JournalEntry, 'title' | 'body' | 'shared' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('journal_entries').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes an entry (RLS: journal_entries_delete_owner — owner only). */
export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('journal_entries').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual ordering. `orderedIds` is the TOP-TO-BOTTOM display order;
 * because `listEntries` sorts by `position` DESCENDING, we write descending
 * positions (the first/topmost id gets the highest position) so the next load
 * reproduces exactly this order. RLS: owner-only update.
 * @param orderedIds - Entry ids in their new top-to-bottom display order.
 */
export async function reorderEntries(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateEntry(id, { position: n - 1 - i })))
}
