/**
 * dm/questsApi.ts — typed data-access for the DM's quest / plot tracker (3.3).
 *
 * Access (migration 0021): campaign DM ONLY for every operation. Quests are part
 * of the DM's private workspace — players and non-members match no policy and see
 * nothing. Every call runs as the signed-in user; RLS is the real gate.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A quest row (title/status/description/plot_notes + manual position). */
export type Quest = Database['public']['Tables']['quests']['Row']

/** The board columns a quest can live in (matches the DB check constraint). */
export type QuestStatus = 'active' | 'completed'
export const QUEST_STATUSES: { value: QuestStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
]

/**
 * Lists a campaign's quests in board order: by `position` DESCENDING then
 * `created_at` DESCENDING (new quests sort to the top of their status group).
 * The panel groups the flat list by `status`.
 *  - RLS: quests_select_dm.
 */
export async function listQuests(campaignId: string): Promise<Quest[]> {
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Creates a new empty quest (status defaults to 'active') at a position. */
export async function createQuest(campaignId: string, position: number): Promise<Quest> {
  const { data, error } = await supabase
    .from('quests')
    .insert({ campaign_id: campaignId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a quest's title/status/description/plot_notes/position (DM only). */
export async function updateQuest(
  id: string,
  patch: Partial<Pick<Quest, 'title' | 'status' | 'description' | 'plot_notes' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('quests').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a quest (RLS: quests_delete_dm — campaign DM only). */
export async function deleteQuest(id: string): Promise<void> {
  const { error } = await supabase.from('quests').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual ordering. `orderedIds` is the TOP-TO-BOTTOM display order
 * (within a status group, or the whole list); because listQuests sorts by
 * `position` DESCENDING, we write descending positions so the topmost id gets
 * the highest position.
 */
export async function reorderQuests(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateQuest(id, { position: n - 1 - i })))
}
