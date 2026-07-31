# QA — Encounters editing

**Phase:** 3.2. Verifies the DM can manage encounters — name, description,
DM-only hidden notes, images, and linked roster NPCs — with autosave and
persistence.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open **"Test 1"**, **Encounters** tab. Have at
least one NPC in the roster (see [npcs-editing.md](npcs-editing.md)) to test linking.

## Steps — encounter fields

- [x] Set **name**, **description**, and **hidden notes** → each debounces to
      **All changes saved**.
- [x] Add a **second** encounter; switch between them; **drag** to reorder.
- [x] Delete a pristine encounter → no prompt; one with content → confirm.
- [x] **Refresh** → names, descriptions, hidden notes, and order persist.

## Steps — images

- [x] **Add an image** → upload a PNG/JPEG → appears as a thumbnail row with a
      caption input; type a caption → **All changes saved**.
- [x] Upload a **second** image; **drag** to reorder; **remove** one (confirm only
      if captioned).
- [x] **Refresh** → images, captions, and order persist (thumbnails re-resolve).

## Steps — linked NPCs

- [x] Under **NPCs**, use **Link an NPC → Choose…** to attach a roster NPC → it
      appears in the linked list with its name + description.
- [x] Expand the linked NPC (▸) → its **stat block shows read-only** (sections +
      fields); it is not editable here.
- [x] A linked NPC is removed from the **Choose…** picker (no double-linking).
- [x] **Unlink** (✕) → it returns to the picker; the NPC itself still exists on
      the NPCs tab.
- [x] **Refresh** → linked NPCs persist.

## Pass criteria

Encounters create/edit/reorder/delete with description + DM-only hidden notes and
persist; images upload/caption/reorder/remove and persist; roster NPCs link/unlink
(no duplicates) with a read-only inline stat block and persist.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), campaign "Test 1". Encounter
  fields (name/description/DM-only hidden notes), create/reorder/delete, and
  persistence verified. Images upload/caption/reorder/remove + persistence
  verified. Linked NPCs: link from roster (no double-linking), read-only inline
  stat block on expand, unlink returns to picker, persists on refresh.
