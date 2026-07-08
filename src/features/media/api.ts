/**
 * media/api.ts — client access for the Phase 1.6 shared media pipeline.
 *
 * Owns: invoking the `upload-media` Edge Function, resolving signed URLs for
 * stored assets (private bucket — no public URLs), and the report/moderation
 * RPCs. Image bytes only ever leave the browser through `uploadMedia`; the
 * Edge Function is the sole writer of Storage + media_assets.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A media_assets row (mirrors the DB). */
export type MediaAsset = Database['public']['Tables']['media_assets']['Row']

/** The subset of a media asset the upload endpoint returns, plus signed URLs. */
export interface UploadResult {
  asset: Pick<
    MediaAsset,
    | 'id'
    | 'campaign_id'
    | 'storage_path'
    | 'thumb_path'
    | 'mime'
    | 'byte_size'
    | 'width'
    | 'height'
    | 'moderation_status'
  >
  /** Short-lived signed URL for the full image (private bucket). */
  originalUrl: string | null
  /** Short-lived signed URL for the thumbnail. */
  thumbUrl: string | null
}

/**
 * The image types the pipeline accepts. Mirrors the Edge Function's magic-byte
 * allowlist and the bucket's allowed_mime_types — used for client-side
 * pre-validation only (the server re-checks by magic bytes, authoritatively).
 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
/** Per-file size cap (10 MB) — mirrors the server cap for a fast client reject. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/**
 * Longest-side box the client downscales to before uploading. MUST stay ≤ the
 * Edge Function's MAX_DIM / MAX_PIXELS: ImageMagick-WASM in the Edge worker OOMs
 * decoding images much above ~4.5 MP (2048² = 4.19 MP is the safe max), so the
 * server rejects sources over that. Downscaling here — using the browser's
 * native decoder, which has no such limit — is what lets a 12 MP+ phone photo be
 * uploaded successfully. (See QA/1.6_tests/processing-and-variants.md.)
 */
export const MAX_IMAGE_DIM = 2048

/**
 * Downscales an image to fit within MAX_IMAGE_DIM (longest side), preserving
 * aspect ratio, using the browser's native decode + a canvas. Returns the
 * ORIGINAL file untouched when it's already within bounds or can't be decoded
 * here (in which case the Edge Function validates/rejects it authoritatively).
 *
 * Why client-side: the Edge worker can't decode large rasters (memory limit), so
 * shrinking here is required for big photos to go through at all. Re-drawing
 * through a canvas also drops EXIF/GPS as a side effect (the server strips again
 * regardless). Animated GIFs collapse to their first frame — matching the
 * server, which also flattens them.
 * @param file - The user-selected image File.
 * @returns A downscaled WebP File, or the original File if no resize is needed.
 */
export async function downscaleIfNeeded(file: File): Promise<File> {
  // Use the browser's native decoder (fast, no WASM memory limit). If it can't
  // decode (e.g. an exotic/malformed file), defer to the server for validation.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const { width, height } = bitmap
  const longest = Math.max(width, height)
  if (longest <= MAX_IMAGE_DIM) {
    bitmap.close()
    return file
  }
  // Compute the fitted target size and draw the scaled image.
  const scale = MAX_IMAGE_DIM / longest
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  // WebP keeps size down and preserves alpha; the server re-encodes to WebP too.
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
  )
  if (!blob) return file
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
  return new File([blob], name, { type: 'image/webp' })
}

/**
 * Uploads one image for a campaign through the `upload-media` Edge Function.
 *
 * Edge Function: `upload-media` (POST multipart { campaignId, file }).
 *  - The function validates (type/size/cap/read-only), strips EXIF, re-encodes,
 *    generates a thumbnail, moderates, and stores. Errors come back as a JSON
 *    { error } body with a 4xx/5xx status, which we surface as the thrown message.
 *  - We downscale oversized images client-side first (see downscaleIfNeeded) —
 *    the Edge worker can't decode very large rasters, so this is what lets big
 *    photos succeed.
 * @param campaignId - Campaign the image belongs to.
 * @param file - The user-selected image File.
 * @returns The created asset + short-lived signed URLs.
 */
export async function uploadMedia(campaignId: string, file: File): Promise<UploadResult> {
  const prepared = await downscaleIfNeeded(file)

  const form = new FormData()
  form.append('campaignId', campaignId)
  form.append('file', prepared)

  const { data, error } = await supabase.functions.invoke<UploadResult>('upload-media', {
    body: form,
  })
  if (error) {
    // On a non-2xx, supabase-js exposes the raw Response on error.context; pull
    // our JSON { error } message out of it rather than the generic wrapper text.
    let message = error.message
    try {
      const body = await (error as unknown as { context?: Response }).context?.json?.()
      if (body && typeof body.error === 'string') message = body.error
    } catch {
      /* fall back to error.message */
    }
    throw new Error(message)
  }
  if (!data) throw new Error('Upload failed.')
  return data
}

/**
 * Creates a short-lived signed URL for a stored object path (private bucket).
 * Used to render assets loaded from the DB (the upload response already carries
 * fresh URLs). Returns null if the caller isn't permitted or the path is gone.
 * @param path - storage_path or thumb_path from a media_assets row.
 * @param expiresInSeconds - URL lifetime (default 1 hour).
 */
export async function signedUrlFor(
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data } = await supabase.storage.from('media').createSignedUrl(path, expiresInSeconds)
  return data?.signedUrl ?? null
}

/**
 * Reports an asset for review. Records the report and immediately hides the
 * asset (server-side) pending a DM decision.
 * @param assetId - media_assets id.
 * @param reason - optional free-text reason.
 */
export async function reportMedia(assetId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('report_media', {
    p_asset_id: assetId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

/**
 * DM moderation decision on an asset. `approved` un-hides it; `blocked` takes it
 * down (never served again). Rejected server-side unless the caller is the DM.
 * @param assetId - media_assets id.
 * @param status - 'approved' | 'blocked'.
 */
export async function setMediaStatus(
  assetId: string,
  status: 'approved' | 'blocked',
): Promise<void> {
  const { error } = await supabase.rpc('set_media_status', {
    p_asset_id: assetId,
    p_status: status,
  })
  if (error) throw new Error(error.message)
}
