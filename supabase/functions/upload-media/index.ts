/**
 * upload-media — the one shared, safe path for every image upload (portraits,
 * encounter images, handouts). Phase 1.6.1.
 *
 * Contract (called by the web app via supabase.functions.invoke with FormData):
 *
 *   CAMPAIGN MEDIA (the original purpose):
 *   POST multipart/form-data { campaignId: string, file: File }
 *   → 200 { asset: { id, campaign_id, storage_path, thumb_path, mime, byte_size,
 *                    width, height, moderation_status },
 *           originalUrl: string, thumbUrl: string }   (short-lived signed URLs)
 *   → 4xx { error } — not signed in / not a member / read-only / bad type /
 *                     too large / over storage cap / blocked by moderation
 *
 *   PROFILE AVATAR (Phase 7.3.1):
 *   POST multipart/form-data { scope: 'avatar', file: File }   (no campaignId)
 *   → 200 { avatarPath: string, avatarUrl: string }
 *   → 4xx { error } — not signed in / bad type / over 5 MB / blocked
 *
 * WHY THE AVATAR SHARES THIS FUNCTION rather than getting its own. Every byte a
 * user can put in front of another user must pass the same gauntlet: magic-byte
 * type sniffing, the pixel-count guard, EXIF/GPS stripping, re-encoding, and the
 * moderation hook. A second upload path would be a second place for one of those
 * to be forgotten — and the one most easily forgotten is EXIF stripping, which
 * on a phone photo means publishing the coordinates it was taken at.
 *
 * What the avatar branch deliberately SKIPS, and why: campaign membership (an
 * avatar belongs to a person, not a campaign), the read-only lock (freezing a
 * campaign must not stop you fixing your own profile picture), and the storage
 * cap (it is a per-campaign budget, and one small image per user is naturally
 * bounded — each upload replaces the previous).
 *
 * Pipeline (all server-side, synchronous — nothing goes "live" until it passes):
 *   1. AuthN: the caller's JWT identifies them (verify_jwt=false at the edge, we
 *      validate via getUser so we can also answer the CORS preflight).
 *   2. AuthZ: caller must be a MEMBER of the campaign, and the campaign must be
 *      writable (private.campaign_is_active — read-only campaigns reject uploads).
 *   3. Validate: file TYPE by MAGIC BYTES (not extension) against the allowlist
 *      (PNG/JPEG/WebP/GIF) and SIZE (<= 10 MB).
 *   4. Process: strip EXIF/profiles, clamp the longest side, re-encode the
 *      original + a thumbnail to WebP (controls Storage + egress cost).
 *   5. Cap: reject if used + new bytes would exceed private.campaign_storage_cap.
 *   6. Moderate: run the moderation hook (currently a pass-through seam; an
 *      automated provider plugs in here later and can return 'blocked').
 *   7. Store (service role) into the private `media` bucket + insert media_assets.
 *
 * All DB/Storage writes use the service role (bypassing RLS), which is why
 * media_assets/storage.objects have no client write policies.
 */
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
  MagickImageInfo,
} from 'npm:@imagemagick/magick-wasm@0.0.30'
import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/clients.ts'

/** Hard per-file size cap (10 MB) — the authoritative check (bucket limit is a backstop). */
const MAX_BYTES = 10 * 1024 * 1024
/** Longest-side clamp for the stored original, to bound Storage/egress cost. */
const MAX_DIM = 2048
/** Thumbnail box (fits within, preserves aspect). */
const THUMB_DIM = 320
/**
 * Avatar box. Deliberately small: an avatar is only ever rendered at roster or
 * header size, and storing a 2048px one would mean shipping it at that size to
 * every co-member on every page load.
 */
const AVATAR_DIM = 256
/**
 * Per-file size cap for AVATARS — a fifth of the 10 MB campaign-media limit.
 *
 * Campaign media is content the campaign is for (maps, handouts) and is charged
 * against a per-campaign storage cap. An avatar is neither: it is one small
 * image per person, outside any cap, so nothing else bounds how much a user can
 * push through this path. A tighter ceiling is what makes "no storage cap on
 * avatars" safe rather than an open door.
 *
 * 5 MB is generous for a 256px output — comfortably above a typical phone photo
 * — while still rejecting an absurd upload before it is decoded.
 */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/**
 * Hard ceiling on SOURCE pixel count, enforced from the file header BEFORE
 * decoding. This is a memory guardrail: the Edge worker has a fixed RAM limit,
 * and ImageMagick-WASM decodes an image to a raw raster (plus working copies)
 * that OOMs the worker above ~4.5 MP — surfacing as an opaque
 * WORKER_RESOURCE_LIMIT / HTTP 546 rather than a clean error. Small byte size
 * does NOT imply small dimensions (a 200 KB JPEG can be 40 MP), and libjpeg's
 * shrink-on-load only scales in halves so it can't reliably keep a large image
 * under the limit — hence a plain pixel cap. It is set to exactly our own
 * MAX_DIM×MAX_DIM output (empirically the largest raster that decodes safely;
 * see QA/1.6_tests/processing-and-variants.md).
 *
 * The web client downscales to fit MAX_DIM before uploading (see ImageUpload),
 * so real users never hit this; it exists to give direct-API callers a clean
 * rejection instead of an OOM.
 */
const MAX_PIXELS = MAX_DIM * MAX_DIM // 2048*2048 = 4,194,304

/**
 * Sniffs the real image type from the leading bytes. Returns the canonical mime
 * or null if it is not an allowed image — this is what defeats a disguised
 * extension (e.g. a .png that is actually a script).
 * @param b - The file's bytes.
 */
function sniffMime(b: Uint8Array): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // GIF: "GIF8"
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'image/gif'
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

// ImageMagick WASM is initialized once per isolate (cold start), then reused.
let magickReady: Promise<void> | null = null
/** Loads + initializes the ImageMagick WASM exactly once. */
function ensureMagick(): Promise<void> {
  if (!magickReady) {
    magickReady = (async () => {
      const resp = await fetch(
        'https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.30/dist/magick.wasm',
      )
      const wasm = new Uint8Array(await resp.arrayBuffer())
      await initializeImageMagick(wasm)
    })()
  }
  return magickReady
}

/** The processed outputs: a normalized WebP original + WebP thumbnail. */
interface Processed {
  original: Uint8Array
  thumb: Uint8Array
  width: number
  height: number
}

/** Source dimensions read from the file header (no full raster decode). */
interface SourceInfo {
  width: number
  height: number
}

/**
 * Reads just the image header to learn its pixel dimensions WITHOUT decoding the
 * full raster — cheap and memory-safe. Used to reject images that are too large
 * to decode before we attempt the (memory-hungry) decode. Requires ImageMagick
 * to be initialized (call ensureMagick first).
 * @param input - The validated source bytes.
 * @returns width/height in pixels, or null if the header can't be parsed.
 */
function readSourceInfo(input: Uint8Array): SourceInfo | null {
  try {
    const info = MagickImageInfo.create(input)
    return { width: info.width, height: info.height }
  } catch {
    return null
  }
}

/**
 * Strips metadata, clamps the original's longest side to MAX_DIM, and re-encodes
 * both the original and a THUMB_DIM thumbnail to WebP. Re-encoding is what
 * removes EXIF/GPS and any non-image payload. Runs synchronously inside
 * ImageMagick's read callback. The caller has already rejected any source above
 * MAX_PIXELS, so the decode here stays within the worker's memory budget.
 * @param input - The validated source bytes.
 */
function processImage(input: Uint8Array): Processed {
  let original: Uint8Array | null = null
  let thumb: Uint8Array | null = null
  let width = 0
  let height = 0

  ImageMagick.read(input, (img) => {
    // Drop all metadata/profiles (EXIF, GPS, color profiles).
    img.strip()

    // Clamp the original so we never store a giant image. MagickGeometry(W,H)
    // means "fit within", preserving aspect ratio.
    if (Math.max(img.width, img.height) > MAX_DIM) {
      img.resize(new MagickGeometry(MAX_DIM, MAX_DIM))
    }
    width = img.width
    height = img.height
    img.write(MagickFormat.WebP, (data) => {
      original = data.slice() // copy: the view is only valid inside the callback
    })

    // Thumbnail from the (already stripped) image.
    img.resize(new MagickGeometry(THUMB_DIM, THUMB_DIM))
    img.write(MagickFormat.WebP, (data) => {
      thumb = data.slice()
    })
  })

  if (!original || !thumb) throw new Error('image processing produced no output')
  // Guard: the encode target is WebP, so the bytes MUST start with "RIFF"...."WEBP".
  // ImageMagick silently writes the *source* format if the format arg is falsy
  // (e.g. a mis-cased MagickFormat member), which would store bytes that lie about
  // their type (stored as .webp / mime image/webp). Fail loud instead of storing a
  // mislabeled object. (RIFF at 0..3, WEBP at 8..11.)
  const isWebp = (b: Uint8Array) =>
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  if (!isWebp(original) || !isWebp(thumb)) {
    throw new Error('image re-encode did not produce WebP output')
  }
  return { original, thumb, width, height }
}

/**
 * Strips metadata and re-encodes a single square-ish avatar to WebP.
 *
 * Separate from processImage rather than a flag on it: processImage is the
 * heavily-tested campaign-media path, and an avatar needs exactly one output
 * instead of an original-plus-thumbnail pair. A branch inside it would make both
 * callers harder to reason about for the sake of avoiding twelve lines.
 *
 * `strip()` is the load-bearing call — it is what removes EXIF, including the
 * GPS coordinates a phone photo carries. Re-encoding also guarantees the stored
 * bytes really are an image, not a payload wearing an image's extension.
 *
 * @param input - Validated source bytes (type and pixel count already checked).
 * @returns WebP bytes and the final dimensions.
 * @throws If ImageMagick produces no output, or output that is not WebP.
 */
function processAvatar(input: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  let out: Uint8Array | null = null
  let width = 0
  let height = 0

  ImageMagick.read(input, (img) => {
    img.strip()
    // "Fit within", preserving aspect — never upscales a small source, and
    // never distorts a non-square one. Cropping to a square is the client's
    // business (CSS), not something to bake irreversibly into the stored file.
    if (Math.max(img.width, img.height) > AVATAR_DIM) {
      img.resize(new MagickGeometry(AVATAR_DIM, AVATAR_DIM))
    }
    width = img.width
    height = img.height
    img.write(MagickFormat.WebP, (data) => {
      out = data.slice() // copy: the view is only valid inside the callback
    })
  })

  if (!out) throw new Error('avatar processing produced no output')
  // Same guard as processImage: ImageMagick silently writes the SOURCE format
  // if the format argument is falsy, which would store bytes that lie about
  // their type. Fail loudly rather than storing a mislabeled object.
  const b = out as Uint8Array
  const isWebp =
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  if (!isWebp) throw new Error('avatar re-encode did not produce WebP output')
  return { bytes: b, width, height }
}

/**
 * Moderation hook — the pluggable content-safety seam (1.6). Today it is a
 * pass-through (returns 'approved'): automated provider integration is deferred,
 * and the report-and-takedown flow (report_media / set_media_status) covers
 * removal. A provider (Rekognition/Vision/Sightengine) plugs in here and may
 * return 'blocked' (upload rejected) or 'flagged' (stored but hidden).
 * @param _bytes - The processed original (what a provider would inspect).
 */
async function moderate(_bytes: Uint8Array): Promise<'approved' | 'flagged' | 'blocked'> {
  return 'approved'
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    // --- 1. AuthN. ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Not signed in.' }, 401)
    const { data: { user }, error: userErr } = await userClient(authHeader).auth.getUser()
    if (userErr || !user) return jsonResponse({ error: 'Not signed in.' }, 401)

    // --- Parse the multipart body. ---
    const form = await req.formData().catch(() => null)
    const campaignId = form?.get('campaignId')
    const file = form?.get('file')
    // Avatar mode is opt-in by an explicit `scope` field, NOT inferred from a
    // missing campaignId. Inferring it would turn a client bug that drops the
    // campaign id into a silent avatar overwrite instead of a clear 400.
    const isAvatar = form?.get('scope') === 'avatar'

    if (!(file instanceof File)) {
      return jsonResponse({ error: 'An image file is required.' }, 400)
    }
    if (!isAvatar && typeof campaignId !== 'string') {
      return jsonResponse({ error: 'campaignId and an image file are required.' }, 400)
    }

    const admin = serviceClient()

    // --- 2. AuthZ: caller is a member, and the campaign is writable. ---
    // Skipped entirely for avatars: there is no campaign to be a member of, and
    // a read-only campaign must not stop you fixing your own profile picture.
    // Identity is still established from the JWT above, and an avatar can only
    // ever be written to the caller's OWN path (see step 7).
    let ent: { is_active: boolean; storage_cap: number | null; storage_used: number } | null = null
    if (!isAvatar) {
      const { data: membership } = await admin
        .from('campaign_members')
        .select('user_id')
        .eq('campaign_id', campaignId as string)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!membership) {
        return jsonResponse({ error: 'You are not a member of this campaign.' }, 403)
      }

      const { data: e, error: entErr } = await admin
        .rpc('campaign_entitlements', { p_campaign_id: campaignId as string })
        .single()
      if (entErr || !e) return jsonResponse({ error: 'Could not check campaign entitlements.' }, 500)
      if (!e.is_active) {
        return jsonResponse({ error: 'This campaign is read-only; uploads are paused.' }, 403)
      }
      ent = e
    }

    // --- 3. Validate size + real type (magic bytes). ---
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length === 0) return jsonResponse({ error: 'The file is empty.' }, 400)
    // Avatars get their own, tighter ceiling. Note this measures what actually
    // ARRIVED: the web client downscales before uploading, so a browser upload
    // is already well under it and this is really the backstop for a direct API
    // caller — the one that is not subject to any storage cap.
    const sizeLimit = isAvatar ? AVATAR_MAX_BYTES : MAX_BYTES
    if (bytes.length > sizeLimit) {
      return jsonResponse(
        {
          error: isAvatar
            ? 'That image is too large for an avatar (max 5 MB).'
            : 'That image is too large (max 10 MB).',
        },
        413,
      )
    }
    const sniffed = sniffMime(bytes)
    if (!sniffed) {
      return jsonResponse(
        { error: 'Unsupported file type. Allowed: PNG, JPEG, WebP, GIF.' },
        415,
      )
    }

    // --- 4. Process (strip EXIF, clamp, re-encode original + thumb to WebP). ---
    await ensureMagick()

    // Dimension guard (memory): read the header to learn pixel dimensions before
    // decoding, and reject anything above MAX_PIXELS. This turns an opaque OOM
    // (WORKER_RESOURCE_LIMIT / 546) into a clean, explainable rejection.
    const info = readSourceInfo(bytes)
    if (!info) return jsonResponse({ error: 'That image could not be read.' }, 422)
    if (info.width * info.height > MAX_PIXELS) {
      return jsonResponse(
        {
          error:
            `That image is too large to process (${info.width}×${info.height}). ` +
            `Please upload an image no larger than ${MAX_DIM}×${MAX_DIM} pixels.`,
        },
        413,
      )
    }

    // --- 4b. Avatar branch: one output, own path, replaces the previous. ---
    // Placed here rather than earlier so an avatar goes through every check
    // above it — magic bytes, size, pixel count — with no way to skip them.
    if (isAvatar) {
      let avatar: { bytes: Uint8Array; width: number; height: number }
      try {
        avatar = processAvatar(bytes)
      } catch (_e) {
        return jsonResponse({ error: 'That image could not be processed.' }, 422)
      }

      const avatarStatus = await moderate(avatar.bytes)
      if (avatarStatus === 'blocked') {
        return jsonResponse({ error: 'This image was blocked by content moderation.' }, 422)
      }

      // The path is built from the JWT's user id — never from the request body —
      // so a caller cannot write to somebody else's avatar path. A random
      // filename each time, because a fixed path overwritten in place keeps
      // serving the old image from cache.
      const { data: prior } = await admin
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle()
      const previousPath = prior?.avatar_url ?? null

      const avatarPath = `avatars/${user.id}/${crypto.randomUUID()}.webp`
      const upA = await admin.storage.from('media').upload(avatarPath, avatar.bytes, {
        contentType: 'image/webp',
        upsert: false,
      })
      if (upA.error) {
        console.error('upload-media: avatar upload failed', upA.error)
        return jsonResponse({ error: 'Could not store the image.' }, 500)
      }

      const { error: profErr } = await admin
        .from('profiles')
        .update({ avatar_url: avatarPath })
        .eq('id', user.id)
      if (profErr) {
        // Roll the object back: a stored file nothing points at is a leak, and
        // unlike the reverse it is invisible.
        await admin.storage.from('media').remove([avatarPath])
        console.error('upload-media: avatar profile update failed', profErr)
        return jsonResponse({ error: 'Could not save your avatar.' }, 500)
      }

      // Delete the OLD object only after the profile points at the new one. The
      // other order would leave a broken avatar if this failed; this order
      // leaves an orphaned file, which costs bytes and nothing else.
      if (previousPath && previousPath !== avatarPath && previousPath.startsWith('avatars/')) {
        const { error: rmErr } = await admin.storage.from('media').remove([previousPath])
        if (rmErr) console.error('upload-media: old avatar not removed', previousPath, rmErr)
      }

      const signed = await admin.storage.from('media').createSignedUrl(avatarPath, 3600)
      return jsonResponse({ avatarPath, avatarUrl: signed.data?.signedUrl ?? null })
    }

    let processed: Processed
    try {
      processed = processImage(bytes)
    } catch (_e) {
      return jsonResponse({ error: 'That image could not be processed.' }, 422)
    }
    const totalBytes = processed.original.length + processed.thumb.length

    // --- 5. Storage cap. ---
    // A null cap means "unlimited". Otherwise used + new must stay within it.
    if (ent && ent.storage_cap !== null && Number(ent.storage_used) + totalBytes > Number(ent.storage_cap)) {
      return jsonResponse(
        { error: 'This campaign has reached its image-storage limit.' },
        413,
      )
    }

    // --- 6. Moderate. ---
    const status = await moderate(processed.original)
    if (status === 'blocked') {
      return jsonResponse({ error: 'This image was blocked by content moderation.' }, 422)
    }

    // --- 7. Store + record. ---
    const assetId = crypto.randomUUID()
    const originalPath = `${campaignId as string}/${assetId}/original.webp`
    const thumbPath = `${campaignId as string}/${assetId}/thumb.webp`

    const up1 = await admin.storage.from('media').upload(originalPath, processed.original, {
      contentType: 'image/webp',
      upsert: false,
    })
    const up2 = await admin.storage.from('media').upload(thumbPath, processed.thumb, {
      contentType: 'image/webp',
      upsert: false,
    })
    if (up1.error || up2.error) {
      // Best-effort cleanup so a half-written asset doesn't leak bytes.
      await admin.storage.from('media').remove([originalPath, thumbPath])
      console.error('upload-media: storage upload failed', up1.error, up2.error)
      return jsonResponse({ error: 'Could not store the image.' }, 500)
    }

    const { data: asset, error: insErr } = await admin
      .from('media_assets')
      .insert({
        id: assetId,
        campaign_id: campaignId as string,
        uploaded_by: user.id,
        storage_path: originalPath,
        thumb_path: thumbPath,
        mime: 'image/webp',
        byte_size: totalBytes,
        width: processed.width,
        height: processed.height,
        original_filename: file.name,
        moderation_status: status,
      })
      .select('id, campaign_id, storage_path, thumb_path, mime, byte_size, width, height, moderation_status')
      .single()
    if (insErr || !asset) {
      await admin.storage.from('media').remove([originalPath, thumbPath])
      console.error('upload-media: insert failed', insErr)
      return jsonResponse({ error: 'Could not record the image.' }, 500)
    }

    // Short-lived signed URLs so the client can render immediately.
    const [origSigned, thumbSigned] = await Promise.all([
      admin.storage.from('media').createSignedUrl(originalPath, 3600),
      admin.storage.from('media').createSignedUrl(thumbPath, 3600),
    ])

    return jsonResponse({
      asset,
      originalUrl: origSigned.data?.signedUrl ?? null,
      thumbUrl: thumbSigned.data?.signedUrl ?? null,
    })
  } catch (err) {
    console.error('upload-media error:', err)
    return jsonResponse({ error: 'Upload failed.' }, 500)
  }
})
