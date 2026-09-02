/**
 * playspace/api.ts — data access for the battlemap (Phase 9.1.2).
 *
 * Owns every Supabase call for `playspace_maps` and `playspace_tokens`. Each
 * function names the policy that governs it; RLS (migrations 0048 + 0050) is the
 * real access control and this module never tries to second-guess it.
 *
 * The permission model in one line: **`owner_user_id` is the only authority**
 * (0048 decision 2). NULL means DM-controlled; `character_id`/`npc_id` are
 * display links that grant nothing. A player may move only a token they own —
 * enforced by `using` AND `with check`, so they can neither seize someone else's
 * token nor give their own away.
 *
 * Invariants enforced by the DATABASE, not here, so the UI need not police them
 * and cannot drift from them:
 *  - at most 5 maps per campaign (0050 trigger),
 *  - at most one active map per campaign — activating one deactivates the rest
 *    in the same update (0050 trigger), so the UI never deactivates first,
 *  - an NPC token may only be relinquished to an actual campaign member.
 */
import { supabase } from '../../lib/supabase'
import { findFreeCell, snapToken } from './grid'
import { signedUrlFor } from '../media/api'
import type { Database } from '../../lib/database.types'

/** A battlemap row as stored. */
export type PlayspaceMap = Database['public']['Tables']['playspace_maps']['Row']
/** A token row as stored. Position is in MAP PIXELS (0048 decision 1). */
export type PlayspaceToken = Database['public']['Tables']['playspace_tokens']['Row']
/** A wall row as stored. DM-only: a player's client never receives these. */
export type PlayspaceWall = Database['public']['Tables']['playspace_walls']['Row']
/** What tool drew a wall. Display/editing only — the sight maths reads points. */
export type WallKind = 'segment' | 'rect' | 'freehand'

/** The most maps a campaign may hold. Mirrors the 0050 trigger, for UI copy. */
export const MAX_MAPS = 5

/**
 * Lists every map in a campaign, newest last.
 *  - RLS: members read their campaign's maps; non-members get nothing.
 * @param campaignId - Campaign scope.
 * @returns All readable maps, oldest first so the picker order is stable.
 */
export async function listMaps(campaignId: string): Promise<PlayspaceMap[]> {
  const { data, error } = await supabase
    .from('playspace_maps')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Lists the tokens on one map.
 *  - RLS: any member may READ every token (you must see the DM's monsters to
 *    play); writing is the restricted half.
 * @param mapId - The map whose tokens to load.
 */
export async function listTokens(mapId: string): Promise<PlayspaceToken[]> {
  const { data, error } = await supabase
    .from('playspace_tokens')
    .select('*')
    .eq('map_id', mapId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Creates a map. DM only.
 *
 * Dimensions are explicit (0048 decision 3 — the server never decodes the
 * image), so the caller passes what it measured from the uploaded picture.
 *
 * @param campaignId - Campaign to create it in.
 * @param fields - Name, background asset, size and grid. All optional; the
 *        column defaults are sensible (1400x900, 70px grid).
 * @returns The created row.
 * @throws If the campaign already has {@link MAX_MAPS} maps — the 0050 trigger
 *         raises, and the message is surfaced to the DM as-is.
 */
export async function createMap(
  campaignId: string,
  fields: Partial<Pick<PlayspaceMap, 'name' | 'background_asset_id' | 'width_px' | 'height_px' | 'grid_size' | 'is_active'>> = {},
): Promise<PlayspaceMap> {
  const { data, error } = await supabase
    .from('playspace_maps')
    .insert({ campaign_id: campaignId, ...fields })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Updates a map (grid size, name, dimensions, or which one is live). DM only.
 *
 * Setting `is_active: true` is a ONE-update switch: the 0050 trigger clears the
 * flag on the campaign's other maps. Do not deactivate the old one first — that
 * would briefly leave the campaign with no live map for everyone watching.
 *
 * @param mapId - Map to update.
 * @param patch - Columns to change.
 * @returns The updated row.
 */
export async function updateMap(
  mapId: string,
  patch: Database['public']['Tables']['playspace_maps']['Update'],
): Promise<PlayspaceMap> {
  const { data, error } = await supabase
    .from('playspace_maps')
    .update(patch)
    .eq('id', mapId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Deletes a map and, by cascade, its tokens. DM only.
 * @param mapId - Map to delete.
 */
export async function deleteMap(mapId: string): Promise<void> {
  const { error } = await supabase.from('playspace_maps').delete().eq('id', mapId)
  if (error) throw error
}

/**
 * Adds a token to a map. DM only.
 * @param mapId - Map to place it on.
 * @param fields - Label, colour, size, position and the optional owner /
 *        character / NPC links. Omitting `owner_user_id` leaves it NULL, i.e.
 *        DM-controlled, which is the default for monsters and props.
 * @returns The created row.
 */
export async function createToken(
  mapId: string,
  fields: Omit<Database['public']['Tables']['playspace_tokens']['Insert'], 'map_id'>,
): Promise<PlayspaceToken> {
  const { data, error } = await supabase
    .from('playspace_tokens')
    .insert({ map_id: mapId, ...fields })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Moves a token.
 *
 * The one call a PLAYER makes. RLS decides whether it lands: a player moving
 * someone else's token matches zero rows and this resolves with no row, which
 * the caller must treat as a refusal rather than a success — hence the explicit
 * null return rather than a silent no-op.
 *
 * @param tokenId - Token to move.
 * @param x - New x in MAP PIXELS.
 * @param y - New y in MAP PIXELS.
 * @returns The updated row, or null if the write matched nothing (not permitted,
 *          or the campaign is read-only after lapsing).
 */
export async function moveToken(tokenId: string, x: number, y: number): Promise<PlayspaceToken | null> {
  const { data, error } = await supabase
    .from('playspace_tokens')
    .update({ x, y })
    .eq('id', tokenId)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Edits a token's non-positional fields, or hands it to a player. DM only.
 *
 * Setting `owner_user_id` is the "relinquish" path from 0050: the database
 * checks the recipient is actually a member of the campaign, so a token cannot
 * be handed to a stranger. Setting it back to NULL reclaims it and is never
 * blocked.
 *
 * @param tokenId - Token to update.
 * @param patch - Columns to change.
 * @returns The updated row.
 */
export async function updateToken(
  tokenId: string,
  patch: Database['public']['Tables']['playspace_tokens']['Update'],
): Promise<PlayspaceToken> {
  const { data, error } = await supabase
    .from('playspace_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Removes a token. DM only.
 * @param tokenId - Token to delete.
 */
export async function deleteToken(tokenId: string): Promise<void> {
  const { error } = await supabase.from('playspace_tokens').delete().eq('id', tokenId)
  if (error) throw error
}

/**
 * Picks the position for a NEW token: the nearest free square to the centre.
 *
 * A thin wrapper over {@link findFreeCell} so callers pass rows rather than
 * geometry, and so the "where do new tokens go?" rule has one home. Stacking
 * every new token on the exact centre would make three added monsters look
 * like one.
 *
 * @param map - The map being placed on.
 * @param tokens - What is already on it.
 * @returns Integer map-pixel coordinates.
 */
export function findFreeCellFor(map: PlayspaceMap, tokens: PlayspaceToken[]): { x: number; y: number } {
  const at = findFreeCell(map, tokens.map((t) => ({ x: t.x, y: t.y })))
  return { x: Math.round(at.x), y: Math.round(at.y) }
}

/**
 * The ring settings a DM may choose per token. Mirrors the 0059 CHECK.
 *
 * 'auto' is the default and preserves the 0058 behaviour — ring only when the
 * token has no artwork. The overrides exist because a ring on an illustrated
 * token can mark a side or a condition, and a plain marker used as scenery is
 * better without one.
 */
export const TOKEN_RINGS = [
  { value: 'auto', label: 'Auto (only without art)' },
  { value: 'on', label: 'Always' },
  { value: 'off', label: 'Never' },
] as const

/** The token sizes the UI offers, in grid squares. Mirrors the 0056 CHECK. */
export const TOKEN_SIZES = [
  { value: 0.5, label: 'Half a square' },
  { value: 1, label: '1 square' },
  { value: 2, label: '2 squares' },
  { value: 3, label: '3 squares' },
  { value: 4, label: '4 squares' },
] as const

/**
 * Re-snaps every token on a map to the CURRENT grid.
 *
 * Called after the DM finishes changing a map's grid size or offset. Without it,
 * re-gridding leaves tokens sitting between the new squares — they keep the
 * right SIZE automatically (size is stored in squares, 0056) but their positions
 * are absolute (0048 decision 1) and do not follow.
 *
 * Deliberately NOT called on every slider event: that would be one write per
 * token per pixel of slider travel, and everyone else's map would stutter as the
 * realtime events arrived. It runs once, when the adjustment is finished.
 *
 * Tokens already on their correct square are skipped, so a re-snap after a
 * no-op change writes nothing at all.
 *
 * @param map - The map, with its new grid.
 * @param tokens - Its current tokens.
 * @returns How many tokens actually moved.
 */
export async function resnapTokens(map: PlayspaceMap, tokens: PlayspaceToken[]): Promise<number> {
  const moves = tokens
    .map((t) => {
      const p = snapToken({ x: t.x, y: t.y }, map, t.size_cells)
      return { id: t.id, x: Math.round(p.x), y: Math.round(p.y), was: t }
    })
    .filter((m) => m.x !== m.was.x || m.y !== m.was.y)

  // Sequential rather than Promise.all: a map with several dozen tokens would
  // otherwise open several dozen simultaneous requests, and this is a background
  // tidy-up, not something anyone is waiting on.
  for (const m of moves) {
    const { error } = await supabase.from('playspace_tokens').update({ x: m.x, y: m.y }).eq('id', m.id)
    // One failure must not abandon the rest: a partially re-snapped map is
    // better than a map where the first refusal stopped everything.
    if (error) console.error('resnap: could not move token', m.id, error.message)
  }
  return moves.length
}

/** An NPC as offered in the DM's "which creature is this?" picker. */
export interface CreatureChoice {
  id: string
  name: string
  portrait_asset_id: string | null
}

/**
 * Lists the campaign's NPCs, for the DM to pick which creature a token is.
 *
 * DM-only in practice: `npcs` is DM-read by RLS (Phase 3.2), so a player calling
 * this simply gets an empty list rather than an error. That is deliberate — the
 * picker is DM-only UI, and the data layer agreeing costs nothing.
 *
 * @param campaignId - Campaign scope.
 */
export async function listCreatures(campaignId: string): Promise<CreatureChoice[]> {
  const { data, error } = await supabase
    .from('npcs')
    .select('id, name, portrait_asset_id')
    .eq('campaign_id', campaignId)
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Resolves signed URLs for a set of media assets in one pass.
 *
 * Batched because a busy map is a dozen tokens, and a request per token per
 * render would be both slow and pointless — most tokens share the handful of
 * portraits in play. Assets that cannot be read (moderated away, or deleted)
 * are simply absent from the map, and the caller falls back to a plain circle.
 *
 * @param assetIds - Asset ids to resolve; duplicates and nulls are fine.
 * @returns asset id → signed URL, for those that resolved.
 */
export async function signedUrlsForAssets(
  assetIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(assetIds.filter((id): id is string => !!id))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from('media_assets')
    .select('id, storage_path, thumb_path')
    .in('id', ids)
  if (error || !data) return out

  await Promise.all(
    data.map(async (a) => {
      // Prefer the thumbnail: a token is at most a few hundred pixels across,
      // and pulling full-size art for each one would be wasteful on a map with
      // a dozen creatures.
      const path = a.thumb_path ?? a.storage_path
      if (!path) return
      const url = await signedUrlFor(path)
      if (url) out.set(a.id, url)
    }),
  )
  return out
}

/**
 * Lists a map's walls.
 *
 * A DM gets every wall; a player gets only those the DM marked
 * `visible_to_players` (0061 + 0066). Neither needs a role check here — RLS
 * returns the right rows to each, so the wall layer renders whatever it is
 * given and cannot accidentally draw a secret wall for the wrong person.
 *
 * @param mapId - The map whose walls to load.
 */
export async function listWalls(mapId: string): Promise<PlayspaceWall[]> {
  const { data, error } = await supabase
    .from('playspace_walls')
    .select('*')
    .eq('map_id', mapId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Saves a new wall. DM only.
 *
 * @param mapId - Map to draw on.
 * @param kind - Which tool drew it (editing hint only).
 * @param points - Ordered [x, y] pairs in MAP PIXELS. Must already be
 *        simplified — the database refuses more than 2000 points, and
 *        `simplifyStroke` is what guarantees that.
 * @param closed - Whether the last point joins back to the first.
 * @param visibleToPlayers - Whether players may see this wall (0066). Defaults
 *        to false, matching the column: a wall is secret unless said otherwise.
 * @returns The created row.
 */
export async function createWall(
  mapId: string,
  kind: WallKind,
  points: [number, number][],
  closed = false,
  visibleToPlayers = false,
): Promise<PlayspaceWall> {
  const { data, error } = await supabase
    .from('playspace_walls')
    .insert({ map_id: mapId, kind, points, closed, visible_to_players: visibleToPlayers })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Deletes one wall. DM only.
 * @param wallId - The wall to remove.
 */
export async function deleteWall(wallId: string): Promise<void> {
  const { error } = await supabase.from('playspace_walls').delete().eq('id', wallId)
  if (error) throw error
}

/**
 * Deletes every wall on a map. DM only.
 *
 * Separate from deleteWall rather than a loop of it: clearing a map of fifty
 * walls should be one statement and one realtime burst, not fifty of each.
 *
 * @param mapId - The map to clear.
 * @returns Nothing; RLS silently matches zero rows for a non-DM.
 */
export async function clearWalls(mapId: string): Promise<void> {
  const { error } = await supabase.from('playspace_walls').delete().eq('map_id', mapId)
  if (error) throw error
}

/** What the `vision` Edge Function returns. Polygons only — never walls. */
export type VisionResult =
  | { visionEnabled: false }
  | { visionEnabled: true; isDm: true }
  | {
      visionEnabled: true
      isDm: false
      /** What may be SEEN: sight range and walls. Drives the fog. */
      polygons: [number, number][][]
      /** Where a token may MOVE: walls only. Stops a drag at a wall. */
      movePolygons: [number, number][][]
    }

/**
 * Asks the server what this player may see on a map.
 *
 * Edge Function: `vision`, POST { mapId }, caller's JWT in the Authorization
 * header (supabase-js attaches it).
 *  - 200 with one of the three shapes above.
 *  - 403 if the caller is not a member; 401 if not signed in.
 *
 * WHY A ROUND TRIP RATHER THAN LOCAL MATHS: walls are DM-only (migration 0061),
 * so the browser has nothing to compute from. The function returns the polygon
 * and never the geometry that produced it — see supabase/functions/vision.
 *
 * A failure returns `{ visionEnabled: true, isDm: false, polygons: [] }` — fog
 * everything — rather than throwing. **Failing CLOSED is deliberate**: the
 * alternative, treating an error as "no fog", would reveal the whole map the
 * moment the network hiccuped, which is the one outcome the feature exists to
 * prevent. A player seeing too little is a complaint; a player seeing too much
 * is the bug.
 *
 * @param mapId - The map to compute for.
 */
export async function fetchVision(mapId: string): Promise<VisionResult> {
  const { data, error } = await supabase.functions.invoke<VisionResult>('vision', {
    body: { mapId },
  })
  if (error || !data) {
    console.error('vision: falling back to fully fogged', error)
    return { visionEnabled: true, isDm: false, polygons: [], movePolygons: [] }
  }
  return data
}
