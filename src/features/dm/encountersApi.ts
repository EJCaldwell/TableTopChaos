/**
 * dm/encountersApi.ts — typed data-access for the DM's encounters, their images,
 * and their linked roster NPCs (Phase 3.2, migration 0020).
 *
 * Access: campaign DM ONLY for every operation. `encounters` gates on
 * is_campaign_dm(campaign_id); the child tables (images, npc links) resolve the
 * campaign through is_encounter_dm(encounter_id). Every call runs as the
 * signed-in user; RLS is the real gate.
 */
import { supabase } from '../../lib/supabase'
import { signedUrlFor } from '../media/api'
import type { Database } from '../../lib/database.types'

/** An encounter row (name/description/hidden_notes + manual position). */
export type Encounter = Database['public']['Tables']['encounters']['Row']
/** An encounter_images row. */
export type EncounterImage = Database['public']['Tables']['encounter_images']['Row']
/** An encounter_npcs link row. */
export type EncounterNpc = Database['public']['Tables']['encounter_npcs']['Row']

/** An image joined with the asset paths + resolved signed URLs for display. */
export interface ResolvedEncounterImage extends EncounterImage {
  fullUrl: string | null
  thumbUrl: string | null
  moderationStatus: string | null
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

/** Lists a campaign's encounters, newest-first (position desc, created desc). */
export async function listEncounters(campaignId: string): Promise<Encounter[]> {
  const { data, error } = await supabase
    .from('encounters')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Creates a new empty encounter at the given position. */
export async function createEncounter(campaignId: string, position: number): Promise<Encounter> {
  const { data, error } = await supabase
    .from('encounters')
    .insert({ campaign_id: campaignId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates an encounter's name/description/hidden_notes/position (DM only). */
export async function updateEncounter(
  id: string,
  patch: Partial<Pick<Encounter, 'name' | 'description' | 'hidden_notes' | 'position'>>,
): Promise<void> {
  const { error } = await supabase.from('encounters').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes an encounter (its images + npc links cascade; assets untouched). */
export async function deleteEncounter(id: string): Promise<void> {
  const { error } = await supabase.from('encounters').delete().eq('id', id)
  if (error) throw error
}

/** Persists a manual ordering (top-to-bottom → descending positions). */
export async function reorderEncounters(orderedIds: string[]): Promise<void> {
  const n = orderedIds.length
  await Promise.all(orderedIds.map((id, i) => updateEncounter(id, { position: n - 1 - i })))
}

// ---------------------------------------------------------------------------
// Encounter images
// ---------------------------------------------------------------------------

/** The row shape returned by the images join (asset paths embedded). */
interface ImageJoinRow extends EncounterImage {
  asset: { storage_path: string; thumb_path: string | null; moderation_status: string } | null
}

/**
 * Lists an encounter's images (position asc) joined with asset paths, and
 * resolves short-lived signed URLs for display. Non-approved/missing assets come
 * back with null URLs so the UI can show an "unavailable" placeholder.
 */
export async function listImages(encounterId: string): Promise<ResolvedEncounterImage[]> {
  const { data, error } = await supabase
    .from('encounter_images')
    .select('*, asset:media_assets(storage_path, thumb_path, moderation_status)')
    .eq('encounter_id', encounterId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as ImageJoinRow[]
  return Promise.all(
    rows.map(async (img) => {
      const asset = img.asset
      if (!asset || asset.moderation_status !== 'approved') {
        return { ...img, fullUrl: null, thumbUrl: null, moderationStatus: asset?.moderation_status ?? null }
      }
      const [fullUrl, thumbUrl] = await Promise.all([
        signedUrlFor(asset.storage_path),
        asset.thumb_path ? signedUrlFor(asset.thumb_path) : Promise.resolve(null),
      ])
      return { ...img, fullUrl, thumbUrl: thumbUrl ?? fullUrl, moderationStatus: asset.moderation_status }
    }),
  )
}

/** Attaches an already-uploaded media asset to an encounter (append). */
export async function addImage(encounterId: string, assetId: string, position: number): Promise<EncounterImage> {
  const { data, error } = await supabase
    .from('encounter_images')
    .insert({ encounter_id: encounterId, asset_id: assetId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates an image caption. */
export async function updateImageCaption(id: string, caption: string): Promise<void> {
  const { error } = await supabase.from('encounter_images').update({ caption }).eq('id', id)
  if (error) throw error
}

/** Removes an image ATTACHMENT (the shared media asset itself is left in place). */
export async function removeImage(id: string): Promise<void> {
  const { error } = await supabase.from('encounter_images').delete().eq('id', id)
  if (error) throw error
}

/** Persists image order (left-to-right → ascending positions). */
export async function reorderImages(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) => supabase.from('encounter_images').update({ position: i }).eq('id', id)),
  )
}

// ---------------------------------------------------------------------------
// Encounter <-> NPC links
// ---------------------------------------------------------------------------

/**
 * Lists the NPC ids linked to an encounter, in order. The panel already has the
 * full roster loaded, so we return just the link rows and let it join by id.
 */
export async function listEncounterNpcs(encounterId: string): Promise<EncounterNpc[]> {
  const { data, error } = await supabase
    .from('encounter_npcs')
    .select('*')
    .eq('encounter_id', encounterId)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Links a roster NPC to an encounter at the given position (append). */
export async function addEncounterNpc(encounterId: string, npcId: string, position: number): Promise<EncounterNpc> {
  const { data, error } = await supabase
    .from('encounter_npcs')
    .insert({ encounter_id: encounterId, npc_id: npcId, position })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Unlinks an NPC from an encounter (removes the link row only, not the NPC). */
export async function removeEncounterNpc(id: string): Promise<void> {
  const { error } = await supabase.from('encounter_npcs').delete().eq('id', id)
  if (error) throw error
}
