/**
 * abilities/api.ts — typed data-access for a character's features & feats (2.4).
 *
 * Access (migration 0016) reuses the 0010 character predicates: owner read/write,
 * campaign DM read-only, other players none. All calls run as the signed-in user,
 * so RLS is the real guard.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** An ability (feature/feat) row as stored. */
export type Ability = Database['public']['Tables']['abilities']['Row']

/** Lists a character's abilities, ordered by `position` then created_at. */
export async function listAbilities(characterId: string): Promise<Ability[]> {
  const { data, error } = await supabase
    .from('abilities')
    .select('*')
    .eq('character_id', characterId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Adds an ability at a given display position (name may be '' → placeholder). */
export async function createAbility(
  characterId: string,
  name: string,
  position: number,
): Promise<Ability> {
  const { data, error } = await supabase
    .from('abilities')
    .insert({ character_id: characterId, name, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates an ability's name, description, uses, and/or position (owner only). */
export async function updateAbility(
  id: string,
  patch: Partial<Pick<Ability, 'name' | 'description' | 'uses' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('abilities').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes an ability (owner only). */
export async function deleteAbility(id: string): Promise<void> {
  const { error } = await supabase.from('abilities').delete().eq('id', id)
  if (error) throw error
}

/** Persists a new ordering by writing each ability's `position` to its index. */
export async function reorderAbilities(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateAbility(id, { position: i })))
}
