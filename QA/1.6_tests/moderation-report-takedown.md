# QA — Moderation: report & takedown

**Phase:** 1.6. Verifies the report-and-takedown flow and that flagged/blocked
media is never served — even to someone who knows the storage path. (Automated
provider moderation is deferred; the hook is a pass-through, so uploads arrive
`approved`.)

**Prerequisites:** shared prerequisites in [README.md](README.md). A campaign
owned by **Account A (DM)** with **Account B** as a player member, and one
uploaded, approved image in it.

## Steps — report hides immediately

- [x] As **Account B (member)**, report the asset:
      ```js
      await supabase.rpc('report_media', { p_asset_id: '<asset-id>', p_reason: 'test' })
      ```
      → succeeds. Confirm it flipped to hidden:
      ```sql
      select moderation_status from public.media_assets where id = '<asset-id>';  -- 'flagged'
      select count(*) from public.media_reports where media_asset_id = '<asset-id>'; -- 1
      ```
- [x] **Not served while flagged.** As **Account B**, try to fetch it:
      ```js
      await supabase.storage.from('media').createSignedUrl('<storage_path>', 60)
      ```
      → **no** usable URL / error (RLS requires an *approved* asset). The image no
      longer loads in the UI.
- [x] **Non-member can't report.** As an account not in the campaign, calling
      `report_media` on the asset → error ("only report media in your own
      campaigns").

## Steps — DM moderation

- [x] **Player can't moderate.** As **Account B**, call
      `set_media_status('<asset-id>', 'approved')` → error (DM-only).
- [x] **DM re-approves.** As **Account A (DM)**, `set_media_status('<asset-id>',
      'approved')` → status back to `approved`; the image serves again (signed URL
      works, renders).
- [x] **DM blocks (takedown).** As **Account A**, `set_media_status('<asset-id>',
      'blocked')` → status `blocked`. As **any** account, a signed URL for its
      path is **denied** and the image never loads. DM still sees the row (for the
      moderation queue) but members do not:
      ```sql
      -- as a member client: zero rows; as the DM client: one row
      select id, moderation_status from public.media_assets where id = '<asset-id>';
      ```

## Pass criteria

A member report immediately quarantines an image (hidden, signed URLs denied); a
blocked image is never served to anyone; only the campaign DM can approve/block;
reporting is restricted to campaign members. Serving eligibility is enforced at
the Storage RLS layer, not just the UI.

> Enforced by `report_media` / `set_media_status`
> ([0008_media_pipeline.sql](../../supabase/migrations/0008_media_pipeline.sql))
> and the `media_objects_read_members` Storage policy (signed URLs succeed only
> for an **approved** asset the caller is a member of).

> **Note / follow-up:** `blocked` stops *serving* but does not yet delete the
> Storage bytes (they still count toward the cap). Physical deletion on takedown
> is a documented follow-up.

## Run log

**2026-07-08 — PASS (all steps).** Run against the live RPCs + Storage RLS using
password-grant JWTs for A (DM), B (player member), C (non-member) on the approved
asset `d73077be…`. All calls were raw REST (`/rest/v1/rpc/*` and
`/storage/v1/object/sign/media/*`) so the Storage RLS layer — not just the UI — is
what's exercised.

| Step | Actor | Result |
| --- | --- | --- |
| Baseline sign of approved asset | B | ✅ 200, `signedURL` returned |
| `report_media` | B | ✅ 204; status → `flagged`, 1 report row |
| Sign while flagged | B | ✅ denied (400 "Object not found" — RLS requires approved) |
| `report_media` on other's campaign | C | ✅ 400 "You can only report media in your own campaigns." |
| `set_media_status('approved')` | B (player) | ✅ 400 "Only the campaign DM can moderate media." |
| `set_media_status('approved')` (re-approve) | A (DM) | ✅ 204; sign works again (200) |
| `set_media_status('blocked')` (takedown) | A (DM) | ✅ 204 |
| Sign while blocked | B **and** C | ✅ denied for both (400 "Object not found") |
| `select media_assets` for the row | B (member) → **0 rows**; A (DM) → **1 row** | ✅ DM sees blocked row for the queue; member does not |

Final DB state: `report_rows = 1` (C's rejected report correctly did **not**
insert), `moderation_status = blocked`.
