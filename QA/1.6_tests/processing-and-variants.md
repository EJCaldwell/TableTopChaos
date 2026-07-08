# QA — Processing & variants (EXIF strip, re-encode, thumbnail)

**Phase:** 1.6. Verifies server-side image processing: the stored original is
re-encoded (metadata stripped), a thumbnail is generated, and both render.

**Prerequisites:** shared prerequisites in [README.md](README.md). A **JPEG that
contains EXIF/GPS metadata** (most phone photos do; or add EXIF with `exiftool`).

## Steps

- [x] **Thumbnail generated.** Upload an image → the response has a `thumb_path`
      and a `thumbUrl`; open `thumbUrl` → a small (≤320 px longest side) WebP
      renders. `originalUrl` renders the full image.
- [x] **Re-encoded to WebP.** The `asset.mime` is `image/webp` regardless of the
      source type, and the stored objects end in `.webp`:
      ```sql
      select mime, storage_path, thumb_path, width, height, byte_size
      from public.media_assets where campaign_id = '<id>' order by created_at desc limit 1;
      ```
- [x] **EXIF stripped.** Download the stored original (via `originalUrl`) and
      inspect it (`exiftool downloaded.webp` or an online EXIF viewer) → **no**
      GPS/EXIF/camera metadata remains (present in the source, absent after).
- [x] **Dimensions clamped.** Upload an image whose longest side > 2048 px →
      stored `width`/`height` have the longest side reduced to **2048** (aspect
      preserved). A smaller image is stored at its original dimensions.
- [x] **Byte accounting.** `byte_size` equals the stored original + thumbnail
      bytes (it's what counts against the cap — see
      [storage-cap-and-readonly.md](storage-cap-and-readonly.md)).

## Pass criteria

Every stored image is a re-encoded WebP with metadata removed, has a working
thumbnail, and is bounded in dimensions — so stored images are safe (no EXIF
leakage) and cost-controlled.

> Enforced in [`upload-media`](../../supabase/functions/upload-media/index.ts)
> `processImage` (ImageMagick WASM: `strip()`, `resize` to `MAX_DIM`/`THUMB_DIM`,
> `write(Webp)`).

> **Known simplification:** animated GIFs are re-encoded to a single static WebP
> frame (animation is not preserved). Note it here if that matters for a feature.

## Run log

**2026-07-08 — PASS (5/5), after fixing two bugs found during this run.**
Verified against `upload-media` **v4** using `fixtures/exif_gps.jpg` (800×600 JPEG
carrying Make/Model/Software/GPS/UserComment) plus wide/oversize fixtures.

| Check | Result | Evidence |
| --- | --- | --- |
| Re-encoded to WebP | ✅ | `mime=image/webp`; stored `original.webp` decodes as WEBP (PIL) |
| Thumbnail | ✅ | `thumb.webp` = WEBP 320×240 (≤320 longest side) |
| EXIF stripped | ✅ | source had GPS 40°44′54″N / camera "QA-Camera" / "top-secret-comment"; stored original `exiftool` shows **none** (only filesystem timestamps) |
| Dimensions clamped | ✅ | wide 4000×1000 → stored 2048×512 (aspect preserved); 800×600 stored as-is |
| Byte accounting | ✅ | `byte_size`=32406 = original 25444 + thumb 6962 (exact) |

### Bugs found & fixed

1. **WebP re-encode was a silent no-op (mislabeled objects).** `img.write()` was
   called with `MagickFormat.Webp`, but the enum member is `WebP` (capital P), so
   the arg was `undefined` and ImageMagick wrote the **source** format while the
   row/object were labeled `image/webp`. Fixed the casing (both original + thumb
   writes) and added a RIFF/`WEBP` magic-byte guard in `processImage` that throws
   if the encoder didn't actually produce WebP — so a future mis-cast fails loud
   instead of storing a lie. (Was BUG #1; fix deployed v2.)

2. **Worker OOM on real photos (`WORKER_RESOURCE_LIMIT` / HTTP 546).**
   ImageMagick-WASM decodes to a raw raster that exhausts the Edge worker's memory
   above ~4.5 MP (calibrated: 2048² = 4.19 MP passes; 2200² = 4.84 MP OOMs). Phone
   photos (12 MP+) always crashed with an opaque 546. `MagickReadSettings`
   shrink-on-load did **not** bound the decode in this WASM build (libjpeg only
   scales in halves). **Chosen fix (client resize + server guard):**
   - **Client:** `downscaleIfNeeded` in [`media/api.ts`](../../src/features/media/api.ts)
     downscales to ≤2048 px longest side via `createImageBitmap` + `<canvas>` +
     `toBlob('image/webp', 0.9)` (browser-native decode, no WASM limit) before
     upload — this is what lets big photos succeed. The `<ImageUpload>` size hard
     reject was removed (helper text: "large images are resized automatically").
   - **Server:** a header-only `MAX_PIXELS` (= 2048²) guard via `MagickImageInfo`
     rejects oversize sources with a clean **413** *before* decoding, so a
     direct-API caller gets an explainable error instead of a 546.

   Verified: `wide_4mp.jpg` 4000×1000 → 200 (clamped 2048×512); `oversize_dims.jpg`
   4000×2500 (10 MP) sent raw → **413** "too large to process (4000×2500)…" (no
   OOM); a client-style pre-downscaled 2048×1280 WebP → 200. Fix deployed v4.

**2026-07-08 (later) — real-browser smoke test, PASS.** Stood up a temporary
dev-only harness (`/media-test`, `src/features/media/MediaTestPage.tsx` — removed
after this test) to exercise the actual `<ImageUpload>` component and
`downscaleIfNeeded` in a real browser rather than a simulated pre-downscaled
fixture:
- Uploaded a real photo with longest side > 2048 px → **passed**; stored
  dimensions came back ≤ 2048, confirming the browser's `createImageBitmap` +
  `<canvas>` + `toBlob('image/webp')` path ran client-side before the request
  ever reached the server.
- Uploaded an animated GIF → **passed**; stored as a single static WebP frame, as
  documented above.
- General UX polish (preview/busy-state/error-copy sanity) was skipped as
  optional — not needed given the pipeline itself is fully verified.

No remaining open items for 1.6 processing/variants.
