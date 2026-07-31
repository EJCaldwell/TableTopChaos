# QA — NPC roster & stat blocks

**Phase:** 3.2. Verifies the DM can manage the campaign NPC roster and each NPC's
configurable stat block, with autosave and persistence.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open campaign **"Test 1"**, **NPCs** tab.

## Steps — roster

- [x] Set a **name** (e.g. `Goblin Boss`) and **description** → debounces to
      **All changes saved**; the roster row shows the name.
- [x] Upload a **portrait** → it appears in the detail header and persists.
- [x] Add a **second** NPC; click rows to switch.
- [x] **Drag** an NPC by its `⠿` handle to reorder (incl. to bottom) → insertion
      bar marks the gap.
- [x] Delete a pristine NPC → no prompt; delete one with content → confirm prompt.
- [x] **Refresh** → NPCs, fields, portraits, and order persist.

## Steps — configurable stat block

- [x] Set the section title (e.g. `Combat`); **+ Add field** → a label/value row.
- [x] Fill fields (e.g. `HP` / `21`, `AC` / `17`, `Speed` / `30 ft`) → debounces
      to **All changes saved**.
- [x] Add a **second** section (e.g. `Abilities`) with fields.
- [x] **Drag** to reorder fields within a section, and reorder sections → both
      show an insertion bar and update.
- [x] Delete a blank field → no prompt; delete one with content → confirm; delete
      a section with fields → confirm.
- [x] **Refresh** → sections, fields, values, and order all persist.

## Pass criteria

NPCs create/edit/reorder/delete with portrait + description and persist; each NPC
has a configurable stat block (sections + label/value fields) that reorders,
autosaves, and persists on refresh.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), campaign "Test 1". Roster
  create/edit/reorder/delete + portrait + description verified; configurable stat
  block (sections + label/value fields, drag-reorder, autosave) verified and
  persists on refresh. **Added during testing:** ghost-placeholder section titles
  (blank on create, no "Untitled" fallback); field value boxes min-2/max-6 rows
  (grow then scroll, `AutoTextarea` maxRows); and a **Duplicate NPC** action
  (header button) that deep-copies name/description/portrait + the whole stat
  block into `<name> (copy)`.
