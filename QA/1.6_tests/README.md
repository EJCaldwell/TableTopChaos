# QA — Phase 1.6: Media upload pipeline & content safety

Verifies the one shared image path built in 1.6: the `upload-media` Edge
Function (validate by magic bytes + size → strip EXIF + re-encode + thumbnail →
storage-cap + read-only checks → moderation hook → store), the `media_assets` /
`media_reports` schema + RLS, the private `media` Storage bucket, and the
report-and-takedown flow. Acceptance criteria are from
[`PLANNING.md`](../../PLANNING.md) §1.6.3.

## Architecture recap (what you're testing)

- **`upload-media`** Edge Function (`verify_jwt=false`, validates the JWT itself):
  the only writer of Storage + `media_assets`. Uses the service role.
- **Private `media` bucket** — no public URLs; members read via short-lived signed
  URLs, and only for **approved** assets in **their** campaigns (storage RLS).
- **Moderation** is a deferred-provider model: uploads arrive `approved` (the
  Edge Function's moderation hook is a pass-through); a member **report** flags
  (hides) an asset; the **DM** blocks/approves via `set_media_status`.
- **Storage cap** = `private.campaign_storage_cap()` (from 1.5); usage =
  `private.campaign_storage_used()`. Enforced in the Edge Function.

## Prerequisites (shared)

- Dev server running against live project `fnykpoattheldxtkrozd`; the
  `upload-media` function deployed.
- A campaign owned by **Account A** with at least one player member (for RLS
  read tests). A second account helps test cross-campaign RLS + reporting.
- Test images on hand: a valid **PNG/JPEG**, a **JPEG with EXIF/GPS** (to prove
  stripping), an **oversized** file (>10 MB), a **non-image** file, and a
  **disguised** file (e.g. a text/script file renamed to `.png`).
- Because Phase 2 features (portraits/handouts) that *consume* the upload
  component don't exist yet, drive uploads either by **temporarily mounting
  `<ImageUpload campaignId=… />`** on a page, or by calling the Edge Function
  directly (`supabase.functions.invoke('upload-media', { body: form })` from the
  app console, or `curl` with a user access token). Backend criteria are fully
  testable without any UI.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Upload validation | [upload-validation.md](upload-validation.md) | Oversized / wrong-type / disguised-extension rejected **server-side**; empty file; happy-path accept |
| Processing & variants | [processing-and-variants.md](processing-and-variants.md) | Thumbnail generated + renders; original re-encoded to WebP; **EXIF stripped**; dimensions clamped |
| Storage cap & read-only | [storage-cap-and-readonly.md](storage-cap-and-readonly.md) | Cap enforced (used + new > cap → rejected); uploads rejected while campaign is read-only |
| Moderation: report & takedown | [moderation-report-takedown.md](moderation-report-takedown.md) | Report flags/hides; blocked never served (signed URL denied); DM-only moderation; RLS visibility |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only (no
test runner yet), plus notes on why the pipeline needs manual/integration testing.

## Pass criteria for the phase

Oversized, wrong-type, and disguised-extension uploads are rejected server-side;
thumbnails generate and render and EXIF is stripped from stored images; a
flagged/blocked image is quarantined and not served; the per-campaign storage cap
is enforced. (Storage-cap ties back to 1.5's `campaign_storage_cap`; the
read-only lock reuses `campaign_is_active`.)
