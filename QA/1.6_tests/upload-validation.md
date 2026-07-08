# QA — Upload validation (type & size)

**Phase:** 1.6. Verifies the `upload-media` Edge Function rejects bad uploads
**server-side** (not just in the client), by magic bytes and size — so a
disguised extension or an oversized file can't get through by bypassing the UI.

**Prerequisites:** shared prerequisites in [README.md](README.md). A campaign
owned by **Account A** (writable — trialing/active, or `enforce_active=false`).

## Steps

- [x] **Happy path.** Upload a valid PNG or JPEG (≤10 MB) → **200** with an
      `asset` (non-null `id`, `storage_path`, `thumb_path`, `mime='image/webp'`,
      `byte_size>0`, `width`/`height`) and signed `originalUrl` / `thumbUrl`.
- [x] **Wrong type.** Upload a non-image (e.g. a `.txt` or `.pdf`) → **415**
      "Unsupported file type…". No `media_assets` row is created.
- [x] **Disguised extension.** Take a text/script file and rename it to
      `evil.png`, upload it → still **415** (rejected by *magic bytes*, not the
      extension). Confirm nothing was stored:
      ```sql
      select count(*) from public.media_assets where campaign_id = '<id>';
      ```
- [x] **Oversized.** Upload an image > 10 MB → **413** "too large (max 10 MB)".
      No row/object created.
- [x] **Empty file.** Upload a 0-byte file → **400** "The file is empty."
- [x] **Not signed in.** Call the function with no Authorization header → **401**.
- [x] **Non-member.** As an account that is **not** a member of the campaign,
      upload to it → **403** "not a member of this campaign."

## Pass criteria

Only real images of an allowed type (PNG/JPEG/WebP/GIF) within the size cap are
accepted; type is enforced by content (magic bytes), so a disguised extension is
rejected; auth + membership are enforced. Every rejection leaves **no**
`media_assets` row and **no** Storage object.

> Enforced in [`upload-media`](../../supabase/functions/upload-media/index.ts):
> `sniffMime` (magic-byte allowlist), `MAX_BYTES`, `getUser` (401), and a
> `campaign_members` check (403).

## Run log

**2026-07-08 — PASS (7/7).** Executed against the live `upload-media` function
(deployed v4) using generated fixtures and password-grant JWTs for Accounts A
(DM), B (player), C (non-member).

| Case | Result | Response |
| --- | --- | --- |
| Happy path (`valid.png`/`valid.jpg`) | ✅ 200 | `mime=image/webp`, thumb + signed URLs returned |
| Wrong type (`notes.txt`) | ✅ 415 | "Unsupported file type…" |
| Disguised extension (`disguised.png` = script bytes) | ✅ 415 | rejected by magic bytes; no row |
| Oversized (`oversized.png`, ~26 MB noise) | ✅ 413 | "too large (max 10 MB)" |
| Empty file (`empty.png`, 0 bytes) | ✅ 400 | "The file is empty." |
| No Authorization header | ✅ 401 | "Not signed in." |
| Non-member (Account C) | ✅ 403 | "You are not a member of this campaign." |

Every rejection left the `media_assets` row count unchanged.
