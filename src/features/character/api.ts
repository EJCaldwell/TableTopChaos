/**
 * character/api.ts — typed data-access helpers for the player character
 * workspace (Phase 2.1: the flexible, player-defined character sheet).
 *
 * Owns: every Supabase call for `characters`, `sheet_sections`, and
 * `sheet_fields`, wrapped in small documented functions so the panel never
 * embeds query strings. Each function notes the table it hits and the RLS policy
 * (migration 0010) that governs it. All calls run as the signed-in user, so RLS
 * is the real access control:
 *   - owner: full read/write over their character + sheet,
 *   - campaign DM: read-only,
 *   - other players: no access.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A character row as stored. */
export type Character = Database['public']['Tables']['characters']['Row']
/** A sheet section row as stored. */
export type SheetSection = Database['public']['Tables']['sheet_sections']['Row']
/** A sheet field row as stored. */
export type SheetField = Database['public']['Tables']['sheet_fields']['Row']

/**
 * A section together with its fields, ordered — the shape the panel renders.
 * `fields` is ordered by `position` ascending (ties by created_at).
 */
export interface SectionWithFields extends SheetSection {
  fields: SheetField[]
}

/**
 * Fetches the caller's character for a campaign, or null if they have none yet.
 *
 * Supabase call: select from `characters` filtered by campaign + owner, earliest
 * first (the "My character" tab is single-character per campaign; if more than
 * one ever exists we deterministically use the oldest).
 *  - RLS: characters_select_owner_or_dm — owner sees their own rows.
 * @param campaignId - Campaign scope.
 * @param ownerId - The calling player's user id (must equal their auth uid).
 * @returns The character row, or null when the player hasn't created one.
 */
export async function getMyCharacter(
  campaignId: string,
  ownerId: string,
): Promise<Character | null> {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Creates a new character owned by the current user in a campaign.
 *
 * Supabase call: insert into `characters` (campaign_id, owner_id, name).
 *  - RLS: characters_insert_own requires owner_id = auth.uid() AND the caller is
 *    a member of the campaign.
 * @param campaignId - Campaign the character belongs to.
 * @param ownerId - Creating player's id (must equal their auth uid).
 * @param name - Character name (1–120 chars; DB check enforces too).
 * @returns The created character row.
 */
export async function createCharacter(
  campaignId: string,
  ownerId: string,
  name: string,
): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .insert({ campaign_id: campaignId, owner_id: ownerId, name: name.trim() })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates mutable fields on a character (name and/or portrait pointer).
 *
 * Supabase call: update `characters` by id.
 *  - RLS: characters_update_owner — only the owner may update.
 * @param id - Character id.
 * @param patch - Partial of { name, portrait_asset_id }.
 * @returns The updated character row.
 */
export async function updateCharacter(
  id: string,
  patch: Partial<
    Pick<Character, 'name' | 'portrait_asset_id' | 'backstory' | 'appearance' | 'personality'>
  >,
): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Deletes a character and (via ON DELETE CASCADE) all its sections and fields.
 * Supabase call: delete from `characters` by id (RLS: owner-only delete).
 * @param id - Character id.
 */
export async function deleteCharacter(id: string): Promise<void> {
  const { error } = await supabase.from('characters').delete().eq('id', id)
  if (error) throw error
}

/**
 * Loads the full sheet for a character: sections with their fields, both ordered
 * by `position` ascending.
 *
 * Supabase call: select from `sheet_sections` with the related `sheet_fields`
 * embedded (FK relationship), ordered on both levels.
 *  - RLS: sheet_sections_select_readable / sheet_fields_select_readable — owner
 *    or campaign DM may read.
 * @param characterId - The character whose sheet to load.
 * @returns Sections (ordered) each carrying their ordered fields.
 */
export async function getSheet(characterId: string): Promise<SectionWithFields[]> {
  const { data, error } = await supabase
    .from('sheet_sections')
    .select('*, sheet_fields(*)')
    .eq('character_id', characterId)
    .order('position', { ascending: true })
    .order('position', { ascending: true, referencedTable: 'sheet_fields' })
  if (error) throw error
  // Normalize the embedded relation name to `fields` for the panel.
  return (data ?? []).map((s) => {
    const { sheet_fields, ...section } = s as SheetSection & { sheet_fields: SheetField[] }
    return { ...section, fields: sheet_fields ?? [] }
  })
}

/**
 * Adds a section to a character at a given display position.
 * Supabase call: insert into `sheet_sections` (RLS: owner-only insert).
 * @param characterId - Owning character.
 * @param title - Section title (1–120 chars).
 * @param position - Display order (lowest first).
 * @returns The created section row.
 */
export async function createSection(
  characterId: string,
  title: string,
  position: number,
): Promise<SheetSection> {
  const { data, error } = await supabase
    .from('sheet_sections')
    .insert({ character_id: characterId, title, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a section's title and/or position.
 * Supabase call: update `sheet_sections` by id (RLS: owner-only update).
 * @param id - Section id.
 * @param patch - Partial of { title, position }.
 */
export async function updateSection(
  id: string,
  patch: Partial<Pick<SheetSection, 'title' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('sheet_sections').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Deletes a section and (via cascade) its fields.
 * Supabase call: delete from `sheet_sections` by id (RLS: owner-only delete).
 * @param id - Section id.
 */
export async function deleteSection(id: string): Promise<void> {
  const { error } = await supabase.from('sheet_sections').delete().eq('id', id)
  if (error) throw error
}

/**
 * Adds a field to a section at a given display position.
 * Supabase call: insert into `sheet_fields` (RLS: owner-only insert).
 * @param sectionId - Owning section.
 * @param label - Field label (1–120 chars).
 * @param value - Field value (free text; may be empty).
 * @param position - Display order within the section.
 * @returns The created field row.
 */
export async function createField(
  sectionId: string,
  label: string,
  value: string,
  position: number,
): Promise<SheetField> {
  const { data, error } = await supabase
    .from('sheet_fields')
    .insert({ section_id: sectionId, label, value, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a field's label, value, and/or position.
 * Supabase call: update `sheet_fields` by id (RLS: owner-only update).
 * @param id - Field id.
 * @param patch - Partial of { label, value, position }.
 */
export async function updateField(
  id: string,
  patch: Partial<Pick<SheetField, 'label' | 'value' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('sheet_fields').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Deletes a field.
 * Supabase call: delete from `sheet_fields` by id (RLS: owner-only delete).
 * @param id - Field id.
 */
export async function deleteField(id: string): Promise<void> {
  const { error } = await supabase.from('sheet_fields').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a new ordering for a character's sections by writing each section's
 * `position` to its index in the given list.
 *
 * Supabase call: one update per section (RLS: owner-only). Kept as small
 * parallel updates rather than an upsert so we never need to send non-position
 * columns (title) back to the server.
 * @param orderedIds - Section ids in their new display order.
 */
export async function reorderSections(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateSection(id, { position: i })))
}

/**
 * Persists a new ordering for the fields within one section.
 * Supabase call: one update per field (RLS: owner-only).
 * @param orderedIds - Field ids in their new display order.
 */
export async function reorderFields(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateField(id, { position: i })))
}

/**
 * The "starter layout" — common D&D sections/fields pre-filled as a convenience
 * (2.1.2). NOT enforced structure: the player can rename, reorder, or delete any
 * of it afterward. Values are left blank for the player to fill in.
 */
export const STARTER_LAYOUT: { title: string; fields: string[] }[] = [
  {
    title: 'Basics',
    fields: ['Class & level', 'Race', 'Background', 'Alignment'],
  },
  {
    title: 'Abilities',
    fields: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'],
  },
  {
    title: 'Combat',
    fields: ['Armor Class', 'Initiative', 'Speed', 'Hit Points', 'Hit Dice'],
  },
]

/**
 * Applies the starter layout to a character by creating its sections and fields
 * (blank values). Sections are appended after `startPosition` so an existing
 * (empty) sheet isn't clobbered.
 *
 * Sections are created sequentially (each field batch needs its section id), but
 * a section's fields are inserted in one call. Returns nothing; the caller
 * reloads the sheet afterward.
 * @param characterId - Owning character.
 * @param startPosition - Position to begin appending sections at (usually the
 *   current section count).
 */
export async function applyStarterLayout(
  characterId: string,
  startPosition: number,
): Promise<void> {
  for (let i = 0; i < STARTER_LAYOUT.length; i++) {
    const spec = STARTER_LAYOUT[i]
    const section = await createSection(characterId, spec.title, startPosition + i)
    if (spec.fields.length > 0) {
      const rows = spec.fields.map((label, j) => ({
        section_id: section.id,
        label,
        value: '',
        position: j,
      }))
      const { error } = await supabase.from('sheet_fields').insert(rows)
      if (error) throw error
    }
  }
}
