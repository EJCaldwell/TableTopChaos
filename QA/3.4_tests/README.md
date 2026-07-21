# QA — Phase 3.4: Party view (read player sheets)

Verifies the DM's read-only **Party** tab. Acceptance criteria from
[`PLANNING.md`](../../PLANNING.md) §3.4.3:

> - DM sees all party sheets and portraits; the DM cannot see a player's journal.

## Architecture recap (what you're testing)

- **No new backend.** 3.4.1 was a *confirmation* that the DM's existing read
  access already spans every player-facing sheet surface. Verified in
  `pg_policies`:
  - `characters` → `owner OR is_campaign_dm` (DM reads all characters).
  - `sheet_sections` / `sheet_fields` / `inventory_items` / `abilities` /
    `spells` → `can_read_character` / `can_read_section` (migration 0010 grants
    the DM read).
  - `journal_entries` → `owner OR (shared AND is_character_dm)` — the DM sees
    **only entries a player marked `shared`**, never the private journal. The
    Party view surfaces **no journal at all**.
- **Party** tab — a read-only panel
  ([`PartyPanel`](../../src/features/party/PartyPanel.tsx)): a roster of every
  player's character; selecting one shows a read-only sheet (portrait, lore,
  flexible sections/fields, inventory, abilities, spells). There are no inputs
  and no journal. Data is bundled by
  [`party/api.ts`](../../src/features/party/api.ts) from the existing per-feature
  read functions.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Reuse the standing data: campaign
  **"Test 1"** (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`), DM `ejcaldwell06`,
  player-owner `ejcaldwell000` (has a character with portrait + lore + inventory
  + abilities + spells + a private journal), co-player `ejcaldwell.test`.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Party read view | [party-view.md](party-view.md) | Roster lists every player character; selecting one shows a read-only sheet (portrait, lore, sections/fields, inventory, abilities, spells); nothing is editable |
| Journal exclusion | [journal-exclusion.md](journal-exclusion.md) | **The headline check:** the Party view never shows a player's journal, and a `journal_entries` read as the DM returns only shared entries (data layer) |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

The DM can open every player's character sheet read-only (with portrait and
lore) from the Party tab, nothing on it is editable, and the player's journal is
never shown — the DM sees journal entries only when a player has shared them, and
the Party view surfaces none.
