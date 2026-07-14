/**
 * spells/api.ts — typed data-access for a character's spells (Phase 2.4).
 *
 * Access (migration 0016) reuses the 0010 character predicates: owner read/write,
 * campaign DM read-only, other players none. All calls run as the signed-in user.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A spell row as stored. */
export type Spell = Database['public']['Tables']['spells']['Row']

/** The valid spell levels: 0 (cantrip) through 9. */
export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** Human label for a spell level (0 renders as "Cantrip"). */
export function levelLabel(level: number): string {
  return level === 0 ? 'Cantrip' : `Level ${level}`
}

/**
 * Lists a character's spells, ordered for display: by level ascending, then by
 * manual position, then name. RLS: spells_select_readable (owner or campaign DM).
 * @param characterId - The owning character.
 */
export async function listSpells(characterId: string): Promise<Spell[]> {
  const { data, error } = await supabase
    .from('spells')
    .select('*')
    .eq('character_id', characterId)
    .order('level', { ascending: true })
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Adds a spell at a given level (name may be '' → placeholder). Other columns
 * default via the DB. RLS: spells_insert_owner (owner only).
 * @returns The created spell row.
 */
export async function createSpell(
  characterId: string,
  level: number,
  name: string,
  position = 0,
): Promise<Spell> {
  const { data, error } = await supabase
    .from('spells')
    .insert({ character_id: characterId, level, name, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a spell's name, level, prepared flag, and/or description (owner only).
 */
export async function updateSpell(
  id: string,
  patch: Partial<Pick<Spell, 'name' | 'level' | 'prepared' | 'description' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('spells').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a spell (owner only). */
export async function deleteSpell(id: string): Promise<void> {
  const { error } = await supabase.from('spells').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual ordering WITHIN a single level group by writing each spell's
 * `position` to its index in `orderedIds`. Because `listSpells` sorts by level
 * first and only then by position, positions are only meaningful relative to
 * other spells at the SAME level — so callers pass just that level's spells, and
 * reordering one level never disturbs another. RLS: owner-only update.
 * @param orderedIds - The spell ids of one level, in their new display order.
 */
export async function reorderSpells(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateSpell(id, { position: i })))
}
