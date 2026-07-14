# QA — Portrait access

**Phase:** 2.3. Verifies a character portrait (uploaded via the 1.6 media
pipeline on the "My character" tab) displays for the **owner and DM** and that a
**non-member cannot obtain a signed URL** for it — the 0008 private-bucket
Storage RLS.

**Prerequisites:** shared prerequisites in [README.md](README.md). Accounts:
- **Owner** = `ejcaldwell000@gmail.com` (owns the character).
- **DM** = `ejcaldwell06@gmail.com`.
- **Non-member** = `ejcaldwell00@gmail.com` — **not** a member of "Test 1"
  (confirmed in the DB), so the true "non-member gets no URL" case.
- *(Co-player `ejcaldwell.test` is a member — see the note at the end.)*

Row/URL checks run in the app **console** (`window.supabase`, dev helper) as the
signed-in account.

## Steps — upload & display (owner)

- [x] As the **owner**, on **"My character"**, upload a portrait → it renders in
      the header and persists on refresh.
- [x] Grab the portrait's Storage path (as the owner, who can read it):
      ```js
      const c = (await supabase.from('characters')
        .select('portrait_asset_id').eq('campaign_id', '<campaign_id>').single()).data
      const a = (await supabase.from('media_assets')
        .select('storage_path, thumb_path').eq('id', c.portrait_asset_id).single()).data
      a  // note storage_path — call it <portrait_path>
      ```
- [x] As the **owner**, a signed URL succeeds:
      ```js
      (await supabase.storage.from('media').createSignedUrl('<portrait_path>', 60)).data
      // → { signedUrl: "https://…" }  (non-null)
      ```

## Steps — DM can view

- [x] As the **DM**, a signed URL for the same path **succeeds** (non-null
      `signedUrl`). The DM is a campaign member, so the 0008 read policy admits it.

## Steps — non-member gets no URL

- [x] As the **non-member** (`ejcaldwell00@gmail.com`), the same call returns **no
      URL**:
      ```js
      (await supabase.storage.from('media').createSignedUrl('<portrait_path>', 60))
      // → data: null, error: {...}  (not a campaign member → denied)
      ```
- [x] The non-member also can't read the asset row:
      ```js
      await supabase.from('media_assets').select('*').eq('storage_path', '<portrait_path>')
      // → data: []
      ```

## Pass criteria

The owner and DM can obtain a signed URL for the portrait (and it displays for the
owner); a non-member cannot get a URL and cannot read the asset row. This reuses
the 0008 member-scoped Storage RLS unchanged.

> **Note (member scope):** the 1.6 Storage policy admits **any campaign member**
> for approved assets, so a co-player (`ejcaldwell.test`) can also obtain a URL —
> broader than the plan's "owner + DM" wording. This is intentional and matches
> how all shared media (encounter images, handouts) works; the acceptance
> criterion is specifically about **non-members**, which is enforced. If portraits
> ever need to be owner+DM-only, that's a tighter Storage policy for a later phase.

## Run log

- **2026-07-13** — PASS. Portrait path
  `d0e1fc8f-…/49243753-…/original.webp` (campaign "Test 1").
  **Owner** (`ejcaldwell000`) → non-null `signedUrl`. **DM** (`ejcaldwell06`) →
  non-null `signedUrl` (member admitted by 0008). **Non-member** (`ejcaldwell00`)
  → `createSignedUrl` returned `{ data: null, error: Object not found }` and the
  `media_assets` row read returned `[]`. Matches the acceptance criterion:
  owner + DM can obtain a URL, non-member cannot get a URL or read the row.
