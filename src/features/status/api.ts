/**
 * status/api.ts — data access for a character's live "HP & conditions" state
 * (character_status, migration 0025). One row per character; owner writes, DM
 * reads (RLS). The row is created lazily on first edit via upsert.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A character's live status row (HP / temp HP / death saves / conditions). */
export type CharacterStatus = Database['public']['Tables']['character_status']['Row']

/** Fields a client may write on a status row. */
export type StatusPatch = Partial<
  Pick<
    CharacterStatus,
    'current_hp' | 'max_hp' | 'temp_hp' | 'death_save_successes' | 'death_save_failures' | 'conditions'
  >
>

/**
 * Loads a character's status row, or null if none exists yet.
 * @param characterId - The character whose status to load.
 */
export async function getStatus(characterId: string): Promise<CharacterStatus | null> {
  const { data, error } = await supabase
    .from('character_status')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Creates-or-updates the character's status row (upsert on character_id) with
 * the given patch. Returns the saved row.
 * @param characterId - The owning character.
 * @param patch - Fields to set.
 */
export async function saveStatus(characterId: string, patch: StatusPatch): Promise<CharacterStatus> {
  const { data, error } = await supabase
    .from('character_status')
    .upsert({ character_id: characterId, ...patch }, { onConflict: 'character_id' })
    .select()
    .single()
  if (error) throw error
  return data
}
