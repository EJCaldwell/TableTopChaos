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
 * uploaded successfully. (See QA/1.9_tests/processing-and-variants.md.)
 */
export const MAX_IMAGE_DIM = 2048

/**
 * The target size for an image that must fit within `max` on its longest side,
 * or null when it already does.
 *
 * Separated from the canvas work (2026-09-01) so the arithmetic can be tested:
 * this is the maths behind the fix for the Edge worker's OOM on large rasters,
 * and it had never been exercised outside a browser.
 *
 * @param width - Source width in pixels.
 * @param height - Source height in pixels.
 * @param max - Longest permitted side.
 * @returns The fitted size, or null if no resize is needed.
 */
export function fittedSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } | null {
  const longest = Math.max(width, height)
  if (longest <= max) return null
  const scale = max / longest
  // Floored at 1: a very long, thin image (a map banner, a scanned scroll)
  // scales its short side below half a pixel and rounds to 0, and a canvas of
  // width 0 throws — so the upload would fail for exactly the images that most
  // need shrinking.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

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
  const fitted = fittedSize(bitmap.width, bitmap.height, MAX_IMAGE_DIM)
  if (!fitted) {
    bitmap.close()
    return file
  }
  const { width: w, height: h } = fitted
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

/**
 * Largest file accepted for an avatar, checked before upload.
 *
 * Must match AVATAR_MAX_BYTES in supabase/functions/upload-media — the server is
 * the authority, this is only for instant feedback. Note the two measure
 * different things and that is deliberate: the client checks the file the user
 * PICKED (so the message names a number they can see in their file manager),
 * while the server checks what arrived after downscaling, which is always
 * smaller. So a file passing here can never be rejected for size there.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/** Human form of {@link MAX_AVATAR_BYTES}, for UI copy and error messages. */
export const MAX_AVATAR_LABEL = '5 MB'

/** Result of an avatar upload (Phase 7.3.1). */
export interface AvatarUploadResult {
  /** Storage path now recorded on profiles.avatar_url. */
  avatarPath: string
  /** Short-lived signed URL so the caller can render it immediately. */
  avatarUrl: string | null
}

/**
 * Uploads the signed-in user's profile avatar.
 *
 * Edge Function: `upload-media` (POST multipart { scope: 'avatar', file }).
 *  - Deliberately the SAME function as campaign media, so an avatar gets the
 *    identical gauntlet: magic-byte type check, pixel-count guard, EXIF/GPS
 *    stripping, WebP re-encode, moderation hook. A separate path would be a
 *    second place to forget one of those — most dangerously the EXIF strip,
 *    which on a phone photo means publishing where it was taken.
 *  - No campaignId: an avatar belongs to a person. Membership, the read-only
 *    lock and the storage cap are all skipped server-side, which is why the
 *    server builds the storage path from the caller's JWT rather than from
 *    anything in this request.
 *  - The server also updates `profiles.avatar_url` and deletes the previous
 *    object, so callers do not write the profile row themselves.
 *
 * @param file - The chosen image (PNG/JPEG/WebP/GIF, <= 10 MB).
 * @returns The new storage path and a signed URL for immediate display.
 * @throws With the server's message on any rejection (type, size, moderation).
 */
export async function uploadAvatar(file: File): Promise<AvatarUploadResult> {
  // Size-check the chosen file BEFORE downscaling. Doing it after would let a
  // 60 MB file be decoded and re-encoded in the browser first — the slow, memory
  // hungry part — only to be told it was too big all along.
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(`That image is too large for an avatar (max ${MAX_AVATAR_LABEL}).`)
  }

  // Downscale in the browser first, exactly as uploadMedia does. The server
  // rejects any source above MAX_PIXELS (a memory guard — ImageMagick-WASM OOMs
  // the worker on large rasters), and a modern phone photo is comfortably over
  // it. Without this step, a normal camera picture fails with a size error.
  const prepared = await downscaleIfNeeded(file)

  const form = new FormData()
  form.append('scope', 'avatar')
  form.append('file', prepared)

  const { data, error } = await supabase.functions.invoke<AvatarUploadResult>('upload-media', {
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
