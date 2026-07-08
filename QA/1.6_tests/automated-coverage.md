# QA — Phase 1.6 automated coverage

Same posture as 1.5: no unit-test runner in the project yet, so automated
coverage is the **type-checker + build**, and the substantive verification is the
manual/integration checklists in this folder.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — types across the app, including the
  media feature (`src/features/media/*`) and the regenerated `database.types.ts`
  (now includes `media_assets`, `media_reports`, and the `campaign_entitlements`
  / `report_media` / `set_media_status` RPCs).
- `npm run build` — production build succeeds.

## Why the pipeline is mostly manual/integration

- The core logic lives in a **Deno Edge Function** using **ImageMagick WASM** and
  **Supabase Storage** — exercising it meaningfully needs a real request with a
  real image, a real bucket, and the webhook-less storage path. That's an
  integration test against the live project, not a unit test.
- Magic-byte validation, EXIF stripping, thumbnail generation, signed-URL RLS,
  and the storage-cap arithmetic are all only trustworthy when observed
  end-to-end (see upload-validation / processing-and-variants / storage-cap /
  moderation checklists).

## Notes / follow-ups surfaced during the build

- Automated content moderation is a **pluggable pass-through hook**; wiring a
  provider (Rekognition/Vision/Sightengine) is deferred.
- `blocked` assets stop being served but their Storage bytes aren't physically
  deleted yet (still count toward the cap) — deletion-on-takedown is a follow-up.
- Animated GIFs are re-encoded to a static WebP frame.
