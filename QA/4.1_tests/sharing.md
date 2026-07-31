# QA — Phase 4.1: shared items (DM→player channel)

Verifies `shared_items` (migration 0024): the DM shares notes/images; players see
them; un-sharing removes them; players can't read DM content that was never shared.

**Prereqs:** DM `ejcaldwell06` + player `ejcaldwell.test` on campaign "Test 1"
(`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`). Dev server on :5173.

## Steps — DM shares (Handouts tab)

- [ ] DM → **Handouts** tab: a **Share a note** composer, a **Share an image**
      uploader, and a **Currently shared** list.
- [ ] Share a **note** (title + body with **bold**/*italic*/`code`) → appears in
      Currently shared; indicator Saving→saved.
- [ ] Share an **image** (upload) → appears with a thumbnail.
- [ ] Edit a shared note's title/body and an image's caption → debounced save;
      reload → edits persist.

## Steps — player sees (Shared with us tab)

- [ ] Player → **Shared with us** tab shows both items, newest first; the note
      renders markdown; the image displays.
- [ ] DM **Un-share** the note (confirm) → player refresh: the note is gone; the
      image remains.

## Steps — isolation

- [ ] Player has **no Handouts tab**; only "Shared with us".
- [ ] Data layer — as the **player**:
      ```js
      const cid='d0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      await supabase.from('shared_items').select('*').eq('campaign_id',cid)            // → shared rows only
      await supabase.from('shared_items').insert({campaign_id:cid,type:'note'}).select() // → 403
      // never-shared DM content stays invisible:
      await supabase.from('dm_notes').select('*').eq('campaign_id',cid)                // → []
      ```
- [ ] As **non-member / anon**: `shared_items` select → `[]`.

## Pass criteria

DM shares note+image; player sees them; un-share removes for everyone; player
cannot write shared_items and cannot read un-shared DM content.

## Run log

**2026-07-21 — PASS.** Campaign `d0e1fc8f…`.

- DM Handouts: shared a note (markdown) + an image; edited inline; un-shared the
  note → removed for players; image remained.
- Player "Shared with us": saw shared items; no Handouts tab.
- Isolation (player console): `shared_items` insert → 403; un-shared `dm_notes`
  select → `[]`.
- Positive visibility: a first `shared_items` select returned `[]` under a stale
  session; re-run under the confirmed `ejcaldwell.test` session returned
  `Array(1)`. Verified server-side too — simulating the player
  (`is_campaign_member` + count under `set role authenticated` + JWT claim):
  `is_member=true`, `visible_shared_rows=1`. RLS correct; the earlier `[]` was a
  cached/anon browser session, not a policy gap. **All pass.**
