/**
 * dm/initiativeApi.ts — typed data-access for the DM's private initiative
 * tracker (Phase 3.5). DM-only for every operation (migration 0022,
 * is_campaign_dm). Every call runs as the signed-in user; RLS is the real gate.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A combatant row in the initiative tracker. */
export type InitiativeEntry = Database['public']['Tables']['initiative_entries']['Row']

/**
 * Lists a campaign's initiative entries. Returned in `position` order (the
 * manual/tiebreak order); the panel does the initiative-value sort for display
 * so it can re-sort live as values are typed without a round-trip.
 *  - RLS: initiative_entries_select_dm.
 */
export async function listEntries(campaignId: string): Promise<InitiativeEntry[]> {
  const { data, error } = await supabase
    .from('initiative_entries')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Optional seed fields when creating a combatant (HP tracker + NPC link). */
export interface CreateEntryExtras {
  /** Current hit points to seed (from an NPC's stat block, say). */
  hp?: number | null
  /** Maximum hit points to seed. */
  max_hp?: number | null
  /** The roster NPC this combatant represents (for inline stat-block viewing). */
  npc_id?: string | null
}

/**
 * Creates a combatant. `name`/`initiative` optional so the DM can add a blank
 * row or seed a named one (from the party/NPC roster) in one call. `extras`
 * carries the HP tracker seed and an optional NPC link.
 * @param campaignId - The owning campaign.
 * @param position - Sort/tiebreak position (caller passes the current count).
 * @param name - Optional combatant name.
 * @param initiative - Optional rolled value.
 * @param extras - Optional HP seed + NPC link (see CreateEntryExtras).
 */
export async function createEntry(
  campaignId: string,
  position: number,
  name = '',
  initiative: number | null = null,
  extras: CreateEntryExtras = {},
): Promise<InitiativeEntry> {
  const { data, error } = await supabase
    .from('initiative_entries')
    .insert({ campaign_id: campaignId, position, name, initiative, ...extras })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a combatant's name/initiative/hp/notes/position (DM only). */
export async function updateEntry(
  id: string,
  patch: Partial<Pick<InitiativeEntry, 'name' | 'initiative' | 'hp' | 'max_hp' | 'notes' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('initiative_entries').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a combatant. */
export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('initiative_entries').delete().eq('id', id)
  if (error) throw error
}

/** Deletes every combatant in a campaign (the "Clear" button). DM only. */
export async function clearEntries(campaignId: string): Promise<void> {
  const { error } = await supabase.from('initiative_entries').delete().eq('campaign_id', campaignId)
  if (error) throw error
}

/**
 * Persists a manual ordering: writes each id's index to `position` (ascending),
 * so `listEntries` reproduces this order. Used both by drag-reorder and by the
 * "Sort by initiative" action (which passes the init-sorted id order).
 */
export async function reorderEntries(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateEntry(id, { position: i })))
}
