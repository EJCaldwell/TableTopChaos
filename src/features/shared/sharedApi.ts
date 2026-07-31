/**
 * shared/sharedApi.ts — typed data-access for the DM→player "shared items"
 * channel (Phase 4.1). A shared item is a NOTE (title + markdown body) or an
 * IMAGE (title/caption + a media_assets reference) that the DM has deliberately
 * pushed into the campaign for every player to see.
 *
 * Access (migration 0024): campaign MEMBERS read (is_campaign_member); only the
 * campaign DM writes (is_campaign_dm). Every call runs as the signed-in user;
 * RLS is the real gate — a player calling shareNote/unshareItem simply gets a
 * 403 from PostgREST. Image items reuse the 1.6 media pipeline; display URLs are
 * short-lived signed URLs resolved here.
 */
import { supabase } from '../../lib/supabase'
import { signedUrlFor } from '../media/api'
import type { Database } from '../../lib/database.types'

/** A shared item row (note or image). */
export type SharedItem = Database['public']['Tables']['shared_items']['Row']

/**
 * A shared item enriched for display. For image items, `fullUrl`/`thumbUrl` are
 * freshly-signed Storage URLs (null when the asset is missing or not approved);
 * note items leave these null.
 */
export interface ResolvedSharedItem extends SharedItem {
  /** Signed URL to the full image (image items only; null if unavailable). */
  fullUrl: string | null
  /** Signed URL to the thumbnail, falling back to the full image. */
  thumbUrl: string | null
  /** The linked asset's moderation status, if any (for a placeholder message). */
  moderationStatus: string | null
}

/**
 * Lists a campaign's shared items, newest share first, with image assets joined
 * and their display URLs resolved. Works for both the DM (manage) and players
 * (read) — RLS returns the same rows to every member.
 * @param campaignId - The campaign whose shared items to load.
 */
export async function listSharedItems(campaignId: string): Promise<ResolvedSharedItem[]> {
  const { data, error } = await supabase
    .from('shared_items')
    .select('*, asset:media_assets(storage_path, thumb_path, moderation_status)')
    .eq('campaign_id', campaignId)
    .order('shared_at', { ascending: false })
  if (error) throw error

  // Resolve signed URLs for image items in parallel; note items pass through.
  return Promise.all(
    (data ?? []).map(async (row) => {
      // The embedded asset from the join (typed loosely; strip before returning).
      const asset = (row as unknown as {
        asset: { storage_path: string; thumb_path: string | null; moderation_status: string } | null
      }).asset
      // Drop the joined `asset` key so the returned object matches SharedItem.
      const { asset: _asset, ...base } = row as SharedItem & { asset?: unknown }
      void _asset

      if (row.type !== 'image' || !asset || asset.moderation_status !== 'approved') {
        return {
          ...(base as SharedItem),
          fullUrl: null,
          thumbUrl: null,
          moderationStatus: asset?.moderation_status ?? null,
        }
      }
      const [fullUrl, thumbUrl] = await Promise.all([
        signedUrlFor(asset.storage_path),
        asset.thumb_path ? signedUrlFor(asset.thumb_path) : Promise.resolve(null),
      ])
      return {
        ...(base as SharedItem),
        fullUrl,
        thumbUrl: thumbUrl ?? fullUrl,
        moderationStatus: asset.moderation_status,
      }
    }),
  )
}

/**
 * Resolves ONE shared_item row into a display item (used by Realtime merges,
 * where the pushed row is the raw DB row without a joined asset / signed URL).
 * For an image, fetches the asset path and signs it; for a note, passes through.
 * @param row - The raw shared_items row from a Realtime event (or elsewhere).
 */
export async function resolveSharedItem(row: SharedItem): Promise<ResolvedSharedItem> {
  if (row.type !== 'image' || !row.asset_id) {
    return { ...row, fullUrl: null, thumbUrl: null, moderationStatus: null }
  }
  const { data: asset } = await supabase
    .from('media_assets')
    .select('storage_path, thumb_path, moderation_status')
    .eq('id', row.asset_id)
    .maybeSingle()
  if (!asset || asset.moderation_status !== 'approved') {
    return { ...row, fullUrl: null, thumbUrl: null, moderationStatus: asset?.moderation_status ?? null }
  }
  const [fullUrl, thumbUrl] = await Promise.all([
    signedUrlFor(asset.storage_path),
    asset.thumb_path ? signedUrlFor(asset.thumb_path) : Promise.resolve(null),
  ])
  return { ...row, fullUrl, thumbUrl: thumbUrl ?? fullUrl, moderationStatus: asset.moderation_status }
}

/**
 * Shares a NOTE to the party (DM only). Creates a shared_item of type 'note'.
 * @param campaignId - The owning campaign.
 * @param title - Optional heading shown to players.
 * @param body - Markdown body (rendered XSS-safe on the client).
 */
export async function shareNote(campaignId: string, title: string, body: string): Promise<SharedItem> {
  const { data, error } = await supabase
    .from('shared_items')
    .insert({ campaign_id: campaignId, type: 'note', title, body })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Shares an already-uploaded IMAGE asset to the party (DM only). The asset must
 * be an approved media_assets row in the same campaign (the upload pipeline
 * handles that); this only records the share.
 * @param campaignId - The owning campaign.
 * @param assetId - The media asset to share.
 * @param title - Optional caption shown to players.
 */
export async function shareImage(campaignId: string, assetId: string, title: string): Promise<SharedItem> {
  const { data, error } = await supabase
    .from('shared_items')
    .insert({ campaign_id: campaignId, type: 'image', asset_id: assetId, title })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates a shared item's title/body (DM only). */
export async function updateSharedItem(
  id: string,
  patch: Partial<Pick<SharedItem, 'title' | 'body'>>,
): Promise<void> {
  const { error } = await supabase.from('shared_items').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Un-shares an item (DM only): deletes the shared_item row, which removes it
 * from every player's view. The underlying media asset is left intact.
 */
export async function unshareItem(id: string): Promise<void> {
  const { error } = await supabase.from('shared_items').delete().eq('id', id)
  if (error) throw error
}
