# QA — Phase 3.2: Encounters (with images) + NPC roster

Verifies the DM's re-specified **Encounters** tab and the campaign **NPCs**
roster (migration 0020). Acceptance criteria from
[`PLANNING.md`](../../PLANNING.md) §3.2.3 (plus the 3.3 NPC roster this delivers):

> - Upload encounter images; presentation view displays them full-screen.
> - Confirm a player account cannot fetch any encounter or its images.

## Architecture recap (what you're testing)

- **NPCs** tab — a campaign-wide roster
  ([`NpcsPanel`](../../src/features/dm/NpcsPanel.tsx)): each NPC has a name,
  optional portrait (1.6 pipeline), description, and a **configurable stat block**
  modelled on the player sheet — add-your-own **sections** (`npc_stat_sections`),
  each with ordered label/value **fields** (`npc_stat_fields`); drag-reorder +
  autosave throughout.
- **Encounters** tab — master/detail
  ([`EncountersPanel`](../../src/features/dm/EncountersPanel.tsx)): name, a
  general **description**, a separate DM-only **"Hidden nearby"** notes box,
  **multiple images** (`encounter_images`, upload/caption/reorder) with a
  full-screen **Present** view, and **linked NPCs** from the roster
  (`encounter_npcs`) whose stat blocks are viewable read-only inline.
- **Access — strictly DM-only for every operation** on all six tables. Tables
  with a campaign_id gate on `private.is_campaign_dm`; child tables resolve the
  campaign through `is_encounter_dm` / `is_npc_dm` / `is_npc_section_dm`. Players
  and non-members match no policy → see/write nothing.
- **Image bytes caveat** (unchanged from the media model): the Storage RLS admits
  any campaign member to an *approved* asset's signed URL, but a player can't
  *discover* an encounter/NPC image path (those rows are DM-only), so images stay
  effectively DM-private in-app.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Campaign **"Test 1"**
  (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`), DM `ejcaldwell06`, player
  `ejcaldwell.test`, non-member `ejcaldwell00`.
- Create at least one NPC (with a stat block) and one encounter (with an image
  and a linked NPC) as the DM before the access-control checks.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| NPC roster & stat blocks | [npcs-editing.md](npcs-editing.md) | Create/edit/reorder/delete NPCs; portrait; description; configurable stat block (sections + fields, reorder, autosave); persistence |
| Encounters editing | [encounters-editing.md](encounters-editing.md) | Encounter create/edit/reorder/delete; description; DM-only hidden notes; images upload/caption/reorder/remove; link/unlink roster NPCs; persistence |
| Presentation view | [presentation-view.md](presentation-view.md) | **Present** opens full-screen; paging (arrows/keys); caption; Esc/close; single/no-image cases |
| Access control (DM-only) | [access-control.md](access-control.md) | **The headline check:** players and anon can read/write none of the six tables; NPCs/Encounters tabs absent for players; DM has full CRUD |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

NPCs (with configurable stat blocks) and encounters (with description, hidden
notes, images, and linked NPCs) create/edit/reorder/persist for the DM; uploaded
images show full-screen in the presentation view; and neither NPCs, encounters,
nor any of their child tables are readable/writable by players or anonymous
callers, with both tabs absent from the player UI.
