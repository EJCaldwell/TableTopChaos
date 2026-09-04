# QA — Phase 4.2: campaign export & import + journal export

Verifies the three Edge Functions (export-campaign, import-campaign,
export-journal) and their UI. Acceptance (PLANNING 4.2.3): export opens & every
image present; re-import reproduces all content (incl. journals) as a NEW
campaign with no existing campaign modified; export works while read-only;
players download only their own journal.

**Prereqs:** DM `ejcaldwell06` on a populated campaign (characters, journals,
NPCs, encounters w/ images, quests, sessions, shared items). Dev server :5173.

## Steps — export (DM)

- [x] DM → **Overview** → **Backup & data** → **Export campaign (.zip)** →
      a `.zip` downloads; "Export downloaded."
- [x] Open the zip: `manifest.json` (schemaVersion 1, counts, sha256),
      `campaign.json`, and `images/<…>` for every referenced asset.
- [x] `campaign.json` counts match the campaign; members listed as **display
      names**, not auth ids.

## Steps — import (DM)

- [x] **Choose a .zip to import…** → pick the exported zip → **Import as new
      campaign** → summary of counts + **Open the new campaign**.
- [x] Open it: name is "… (imported)"; characters, journals, NPCs (+stat
      blocks), encounters (+images render), quests, sessions, shared items all
      present; portraits/images display.
- [x] The **original** campaign is unchanged (still there, untouched) — import
      created a separate new campaign.
- [x] Bad file: import a non-zip / truncated zip → clear error, no new campaign.

## Steps — export while read-only (if a read-only campaign is available)

- [x] Export still succeeds on a read-only / pending-deletion campaign.

## Steps — player journal export

- [x] Player → **Journal** → **Download my journal** → a `.json` and a `.md`
      download; contents are only that player's own entries.

## Pass criteria

Export produces a valid, image-complete zip; import rebuilds everything as a new
campaign without touching existing ones; journal export is per-caller only.

## Run log

**2026-07-21 — PASS.** Campaign `d0e1fc8f…` (populated: 2 characters, 4 NPCs,
2 encounters, 2 quests, 3 sessions, 1 shared item, 1 journal entry, 10 media
assets / 20 image files).

- **Export:** downloaded a valid ZIP; `manifest.json` counts matched (above),
  `campaign.json` + `images/…` present.
- **Import:** created a new "… (imported)" campaign; encounters present and
  **images render**; player **portraits render**. Original campaign unchanged.
- **Journal export:** "Download my journal" produced `.json` + `.md` of the
  caller's own entries.

### Bugs found & fixed during QA
1. **Corrupt ZIP download** — the export returned `Content-Type: application/zip`,
   but `supabase.functions.invoke` only returns a Blob for
   `application/octet-stream` and otherwise falls back to `response.text()`,
   mangling the binary. Fixed: export now sends `application/octet-stream`; the
   client re-labels the Blob as `application/zip` when saving. (export-campaign v2)
2. **Import 500 — duplicate campaign_members key** — creating a campaign
   auto-adds the owner as a `dm` member via a DB trigger, colliding with the
   import's explicit member insert. Fixed: upsert with
   `onConflict: campaign_id,user_id, ignoreDuplicates`. Also fixed error
   reporting (PostgrestErrors aren't `Error` instances, so the real message was
   swallowed as a generic "Import failed."). (import-campaign v2→v3)

**All pass.**

**2026-07-29 — schema v2 re-test PASS.** Re-exported a campaign carrying the new
data; `manifest.json` counts included `characterStatus`, `scheduleSessions`,
`scheduleRsvps`. Imported via the new dashboard "Import from a backup" card →
new campaign carried HP/conditions (character_status) and proposed sessions;
RSVPs intentionally absent; encounters/portraits still rendered; original
untouched. Import now also reachable from the main menu, not just campaign
Overview.
