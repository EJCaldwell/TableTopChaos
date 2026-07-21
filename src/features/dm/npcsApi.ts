/**
 * dm/npcsApi.ts — typed data-access for the DM's campaign NPC roster and each
 * NPC's configurable stat block (Phase 3.2 / 3.3).
 *
 * An NPC has a name, optional portrait, and description, plus a stat block built
 * exactly like the player character sheet: ordered SECTIONS, each with ordered
 * label/value FIELDS (npc_stat_sections / npc_stat_fields). Access (migration
 * 0020): campaign DM ONLY for every operation; child tables resolve the campaign
 * through is_npc_dm / is_npc_section_dm. Every call runs as the signed-in user;
 * RLS is the real gate.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** An NPC roster row. */
export type Npc = Database['public']['Tables']['npcs']['Row']
/** A stat-block section on an NPC. */
export type NpcStatSection = Database['public']['Tables']['npc_stat_sections']['Row']
/** A label/value stat within a section. */
export type NpcStatField = Database['public']['Tables']['npc_stat_fields']['Row']

/** A section with its ordered fields, for rendering a full stat block. */
export interface NpcSectionWithFields extends NpcStatSection {
  fields: NpcStatField[]
}

// ---------------------------------------------------------------------------
// NPC roster
// ---------------------------------------------------------------------------

/** Lists a campaign's NPCs in manual order (position desc, then created desc). */
export async function listNpcs(campaignId: string): Promise<Npc[]> {
  const { data, error } = await supabase
    .from('npcs')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Creates a new empty NPC at the given position. */
export async function createNpc(campaignId: string, position: number): Promise<Npc> {
  const { data, error } = await supabase
    .from('npcs')
    .insert({ campaign_id: campaignId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates an NPC's name/description/portrait/position (DM only). */
export async function updateNpc(
  id: string,
  patch: Partial<Pick<Npc, 'name' | 'description' | 'portrait_asset_id' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('npcs').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes an NPC (its stat sections/fields + encounter links cascade). */
export async function deleteNpc(id: string): Promise<void> {
  const { error } = await supabase.from('npcs').delete().eq('id', id)
  if (error) throw error
}

/**
 * Persists a manual roster ordering. `orderedIds` is top-to-bottom; because
 * listNpcs sorts by position DESC, we write descending positions.
 */
export async function reorderNpcs(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateNpc(id, { position: n - 1 - i })))
}

/**
 * Deep-copies an NPC into a NEW roster NPC — its name (suffixed " (copy)"),
 * description, portrait, and its entire stat block (sections + fields, order
 * preserved). Use to spin up several NPCs that share a stat template (e.g. four
 * goblins) without re-entering everything.
 *
 * The portrait is SHARED by reference (both NPCs point at the same media asset —
 * fine, it's read-only). Sections/fields are cloned as brand-new rows.
 * @param source - The NPC to copy (already loaded in the roster).
 * @param position - The roster position for the new NPC (caller picks max+1).
 * @returns The created copy's NPC row (with the copied name/description/portrait).
 */
export async function duplicateNpc(source: Npc, position: number): Promise<Npc> {
  // Snapshot the source's stat block before creating anything.
  const sheet = await getNpcSheet(source.id)

  // Create the shell, then copy the scalar fields onto it.
  const copy = await createNpc(source.campaign_id, position)
  const name = source.name.trim() ? `${source.name} (copy)` : ''
  await updateNpc(copy.id, {
    name,
    description: source.description,
    portrait_asset_id: source.portrait_asset_id,
  })

  // Clone the stat block: each section, then its fields (positions preserved).
  for (const section of sheet) {
    const newSection = await createStatSection(copy.id, section.title, section.position)
    for (const field of section.fields) {
      await createStatField(newSection.id, field.label, field.value, field.position)
    }
  }

  return { ...copy, name, description: source.description, portrait_asset_id: source.portrait_asset_id }
}

// ---------------------------------------------------------------------------
// NPC stat block (sections + fields)
// ---------------------------------------------------------------------------

/**
 * Loads an NPC's full stat block: sections (ascending position) each with their
 * fields (ascending position). Two queries + an in-memory join.
 * @param npcId - The NPC whose stat block to load.
 */
export async function getNpcSheet(npcId: string): Promise<NpcSectionWithFields[]> {
  const { data: sections, error: sErr } = await supabase
    .from('npc_stat_sections')
    .select('*')
    .eq('npc_id', npcId)
    .order('position', { ascending: true })
  if (sErr) throw sErr
  if (!sections || sections.length === 0) return []

  const { data: fields, error: fErr } = await supabase
    .from('npc_stat_fields')
    .select('*')
    .in(
      'section_id',
      sections.map((s) => s.id),
    )
    .order('position', { ascending: true })
  if (fErr) throw fErr

  const bySection = new Map<string, NpcStatField[]>()
  for (const f of fields ?? []) {
    const arr = bySection.get(f.section_id) ?? []
    arr.push(f)
    bySection.set(f.section_id, arr)
  }
  return sections.map((s) => ({ ...s, fields: bySection.get(s.id) ?? [] }))
}

/**
 * Scans an NPC's stat block for a hit-points field and extracts a numeric HP
 * value to seed the combat tracker's HP box. Matches any field whose label
 * looks like HP ("HP", "Hit Points", "Health", "HP Max", …), then pulls the
 * first integer out of its value. Handles common shapes:
 *   "27", "27/27", "27 (5d8)", "hp 27"  → 27
 * Returns { hp, max_hp } — if the value looks like "cur/max" both are captured;
 * otherwise the single number seeds both. Returns null when no HP field / number
 * is found (the DM just tracks HP manually then).
 * @param npcId - The NPC whose stat block to scan.
 */
export async function extractNpcHp(
  npcId: string,
): Promise<{ hp: number; max_hp: number } | null> {
  const sheet = await getNpcSheet(npcId)
  // Field labels that indicate hit points (word-boundary so "shipment" etc.
  // don't match); scan sections/fields in order and take the first hit.
  const hpLabel = /\b(hp|hit\s*points?|health)\b/i
  for (const section of sheet) {
    for (const field of section.fields) {
      if (!hpLabel.test(field.label)) continue
      // Pull up to two integers: "27/30" → [27, 30]; "27 (5d8)" → [27] (paren
      // groups are dice, not a max, so only "a/b" counts as current/max).
      const slash = field.value.match(/(\d+)\s*\/\s*(\d+)/)
      if (slash) {
        const cur = parseInt(slash[1], 10)
        const max = parseInt(slash[2], 10)
        return { hp: cur, max_hp: max }
      }
      const single = field.value.match(/\d+/)
      if (single) {
        const n = parseInt(single[0], 10)
        return { hp: n, max_hp: n }
      }
    }
  }
  return null
}

/** Creates a stat section at a position. */
export async function createStatSection(
  npcId: string,
  title: string,
  position: number,
): Promise<NpcStatSection> {
  const { data, error } = await supabase
    .from('npc_stat_sections')
    .insert({ npc_id: npcId, title, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a stat section's title/position. */
export async function updateStatSection(
  id: string,
  patch: Partial<Pick<NpcStatSection, 'title' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('npc_stat_sections').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a stat section (its fields cascade). */
export async function deleteStatSection(id: string): Promise<void> {
  const { error } = await supabase.from('npc_stat_sections').delete().eq('id', id)
  if (error) throw error
}

/** Persists section order (ascending positions from the given order). */
export async function reorderStatSections(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateStatSection(id, { position: i })))
}

/** Creates a label/value field in a section. */
export async function createStatField(
  sectionId: string,
  label: string,
  value: string,
  position: number,
): Promise<NpcStatField> {
  const { data, error } = await supabase
    .from('npc_stat_fields')
    .insert({ section_id: sectionId, label, value, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a field's label/value/position. */
export async function updateStatField(
  id: string,
  patch: Partial<Pick<NpcStatField, 'label' | 'value' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('npc_stat_fields').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes a field. */
export async function deleteStatField(id: string): Promise<void> {
  const { error } = await supabase.from('npc_stat_fields').delete().eq('id', id)
  if (error) throw error
}

/** Persists field order within a section (ascending positions). */
export async function reorderStatFields(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateStatField(id, { position: i })))
}
