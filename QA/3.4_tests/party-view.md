# QA — Party read view

**Phase:** 3.4. Verifies the DM can see every player's character sheet and
portrait, read-only, from the Party tab.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open campaign **"Test 1"**, **Party** tab.

## Steps — roster & selection

- [x] Open **Party** → the intro note ("Read-only view … Journals stay private")
      shows, and a roster lists every player character with the **character name**
      and the **owning player's display name**.
- [x] The first character is auto-selected; its read-only sheet shows on the right.
- [x] Click a different character in the roster → the detail switches to it.

## Steps — read-only sheet content

For a character with data (owner `ejcaldwell000`):

- [x] **Lore** — Backstory / Appearance / Personality render with their safe
      markdown (bold/italic/code); empty lore fields are omitted.
- [x] **Character sheet** — the player's flexible sections and their label/value
      fields are listed.
- [x] **Inventory** — items with quantity, an "equipped" marker, and notes.
- [x] **Abilities & Feats** — names, optional use counts, descriptions.
- [x] **Spells** — grouped by level, with a "prepared" marker and descriptions.
- [x] **Nothing is editable** — there are no text inputs, no add/delete buttons,
      no drag handles anywhere on the sheet (it is display-only).

## Steps — empty states

- [x] A character with no sheet/inventory/abilities/spells simply omits those
      sections (no empty boxes, no errors).
- [x] If a player hasn't created a character, they don't appear in the roster;
      with zero characters the panel reads "No player characters yet."

## Pass criteria

The DM sees a roster of all player characters and can open each one read-only
with its portrait, lore, sheet, inventory, abilities, and spells; nothing on the
view can be edited.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), campaign "Test 1". Roster listed
  both "EJ" characters with their owners (yrdy / Tester 1); auto-select + switch
  worked. Read-only sheet verified on both: portrait, lore (safe markdown),
  collapsible sections (start closed, open on click), flexible sheet sections
  (larger/bold titles) + fields, inventory, abilities, and spells (grouped by
  level). Empty sections omitted cleanly; nothing on the view is editable.
