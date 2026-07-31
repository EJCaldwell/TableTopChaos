/**
 * party/api.ts — read-only aggregation for the DM's Party view (Phase 3.4).
 *
 * The Party view lets the DM open any player's character sheet READ-ONLY. There
 * is no new backend for 3.4: the DM's read access already spans characters, the
 * flexible sheet (sections/fields), inventory, abilities, spells, and lore via
 * the migration-0010 predicates (`can_read_character` / `is_campaign_dm`). The
 * player's JOURNAL is deliberately excluded here — the DM only ever sees journal
 * entries a player explicitly shared, and the Party view surfaces none of it.
 *
 * This module just bundles the existing per-feature read functions into one
 * fetch and resolves the portrait's signed URL, so the panel can load a whole
 * sheet in a single call. Everything runs as the signed-in DM; RLS is the gate.
 */
import { supabase } from '../../lib/supabase'
import { signedUrlFor } from '../media/api'
import { getSheet, type Character, type SectionWithFields } from '../character/api'
import { listItems, type InventoryItem } from '../inventory/api'
import { listAbilities, type Ability } from '../abilities/api'
import { listSpells, type Spell } from '../spells/api'
import { getStatus, type CharacterStatus } from '../status/api'

/**
 * Everything the Party view renders for one character (read-only). Deliberately
 * has NO journal — that stays private to the player (see module comment).
 */
export interface PartySheet {
  /** The character's flexible sheet: ordered sections, each with ordered fields. */
  sections: SectionWithFields[]
  /** Inventory items in display order. */
  inventory: InventoryItem[]
  /** Abilities/feats in display order. */
  abilities: Ability[]
  /** Spells (each carries its level; the UI groups them). */
  spells: Spell[]
  /** Live HP/conditions status (null if the player hasn't set any yet). */
  status: CharacterStatus | null
  /** Resolved signed URL for the portrait, or null if none/unreadable. */
  portraitUrl: string | null
}

/**
 * Loads a character's full read-only sheet bundle in parallel.
 * @param character - The character row (already fetched via listCampaignCharacters).
 * @returns The bundled sheet/inventory/abilities/spells + portrait URL.
 */
export async function loadPartySheet(character: Character): Promise<PartySheet> {
  const [sections, inventory, abilities, spells, status, portraitUrl] = await Promise.all([
    getSheet(character.id),
    listItems(character.id),
    listAbilities(character.id),
    listSpells(character.id),
    getStatus(character.id),
    character.portrait_asset_id
      ? resolvePortraitUrl(character.portrait_asset_id)
      : Promise.resolve(null),
  ])
  return { sections, inventory, abilities, spells, status, portraitUrl }
}

/**
 * Resolves a signed thumbnail/full URL for a portrait media asset (private
 * bucket). Mirrors the resolver in CharacterPanel: the character row stores only
 * the asset id, so we fetch its path and sign it. Returns null if the asset is
 * gone or not readable (e.g. moderated), so a missing portrait degrades to "no
 * image" rather than a broken one.
 * @param assetId - media_assets id from characters.portrait_asset_id.
 */
export async function resolvePortraitUrl(assetId: string): Promise<string | null> {
  const { data } = await supabase
    .from('media_assets')
    .select('storage_path, thumb_path')
    .eq('id', assetId)
    .maybeSingle()
  if (!data) return null
  return signedUrlFor(data.thumb_path ?? data.storage_path)
}
