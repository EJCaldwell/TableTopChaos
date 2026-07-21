# QA — Quests editing

**Phase:** 3.3. Verifies the DM can manage the quest board — create, edit, set
status, reorder, delete — with autosave and persistence.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open **"Test 1"**, **Quests** tab.

## Steps — editing

- [x] Open **Quests** → privacy note + **+ New quest**; empty state reads "No
      quests yet." Two group headers appear once quests exist: **Active** and
      **Completed** (each with a count).
- [x] **+ New quest** → a card appears under **Active** with title, a status
      select, Description, and a **🔒 Plot notes (DM only)** box (accent-dashed).
      Indicator shows **Saving… → All changes saved**.
- [x] Set a **title**, **description**, and **plot notes** → each debounces to
      **All changes saved**.
- [x] Add a **second** and **third** quest.

## Steps — status grouping

- [x] Change a quest's **status** to **Completed** → it moves from the Active group
      to the Completed group; both group counts update.
- [x] Change it back to **Active** → it returns to the Active group.

## Steps — reorder & delete

- [x] With ≥2 quests in a group, **drag** one by its `⠿` handle to reorder within
      the group → an insertion bar marks the drop gap.
- [x] Delete a pristine (blank) quest → no prompt; delete one with content →
      confirm prompt ("Delete …?").
- [x] **Refresh** → quests, their fields, statuses (correct groups), and order all
      persist.

## Pass criteria

Quests create/edit/delete with debounced autosave and persist; changing status
moves a quest between the Active and Completed groups; drag-reorder within a group
persists on refresh.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), "Test 1". Quest create/edit/delete
  with autosave (title/description/DM-only plot notes); status change moves a
  quest between the Active/Completed groups (counts update); drag-reorder within a
  group persists on refresh.
