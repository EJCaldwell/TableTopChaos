/**
 * inventory/api.ts — typed data-access helpers for a character's inventory
 * (Phase 2.2). One flat list of items per character.
 *
 * Owns every Supabase call against `inventory_items`. Access is governed by the
 * migration 0012 RLS policies, which reuse the character predicates from 0010:
 * the owning player has full read/write, the campaign DM has read-only, other
 * players have none. All calls run as the signed-in user, so RLS is the real
 * guard; these helpers assume nothing more.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** An inventory item row as stored. */
export type InventoryItem = Database['public']['Tables']['inventory_items']['Row']

/**
 * Lists a character's inventory, ordered by `position` ascending (ties by
 * created_at). Supabase call: select from `inventory_items` by character.
 *  - RLS: inventory_items_select_readable (owner or campaign DM).
 * @param characterId - The owning character.
 * @returns Ordered inventory items.
 */
export async function listItems(characterId: string): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('character_id', characterId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Adds an item to a character's inventory at a given display position.
 * Supabase call: insert into `inventory_items` (RLS: owner-only insert). qty
 * defaults to 1 and notes to '' via DB defaults; only name/position are needed.
 * @param characterId - Owning character.
 * @param name - Item name (1–200 chars).
 * @param position - Display order (lowest first).
 * @returns The created item row.
 */
export async function createItem(
  characterId: string,
  name: string,
  position: number,
): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({ character_id: characterId, name, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates mutable fields on an item (name, qty, notes, equipped, position).
 * Supabase call: update `inventory_items` by id (RLS: owner-only update).
 * @param id - Item id.
 * @param patch - Partial of the editable columns.
 */
export async function updateItem(
  id: string,
  patch: Partial<Pick<InventoryItem, 'name' | 'qty' | 'notes' | 'equipped' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('inventory_items').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Deletes an item.
 * Supabase call: delete from `inventory_items` by id (RLS: owner-only delete).
 * @param id - Item id.
 */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a new ordering by writing each item's `position` to its index in the
 * given list. Supabase call: one update per item (RLS: owner-only).
 * @param orderedIds - Item ids in their new display order.
 */
export async function reorderItems(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateItem(id, { position: i })))
}
