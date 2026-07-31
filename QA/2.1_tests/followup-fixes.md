# QA — Sheet-editing follow-up fixes

**Phase:** 2.1 (follow-up). Verifies the three non-blocking issues found during
the 2.1.3 run (see [sheet-editing.md](sheet-editing.md) run log) are fixed:

1. **Delete confirmations** for fields/sections that contain content.
2. **Drag-to-reorder can reach the last position**, with a **visual drop
   indicator** during the drag.
3. **Offline/failed autosaves are retried on reconnect** (no silent data loss).

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
player who owns the character (`ejcaldwell000@gmail.com` in the current test data),
open the campaign, and select **"My character"**. Have at least 3 sections, one
with 3+ fields, so there's room to reorder.

## 1 — Delete confirmations

- [x] **Empty field deletes instantly.** Add a field — the label shows ghost
      placeholder text ("Label"), not real text (migration 0011 allows an empty
      label). Leave it untouched, click ✕ → deletes with **no** confirmation.
- [x] **Field with content confirms.** Type a value (or a real label) into a field,
      click ✕ → a **confirm dialog** appears. Cancel → field stays. ✕ again →
      confirm → field deletes.
- [x] **Empty section deletes instantly.** Add a new section, delete all its fields,
      click the section ✕ → deletes with **no** prompt.
- [x] **Section with fields confirms.** On a section that has ≥1 field, click the
      section ✕ → a **confirm dialog** naming the section + field count appears.
      Cancel → nothing changes. Confirm → section and its fields delete.
- [x] (The whole-character **Delete character** button still confirms as before.)

## 2 — Drag-to-reorder: last position + drop indicator

- [x] **Drop indicator visible.** Start dragging a section by its `⠿` handle → a
      thin accent line appears at the gap where it would land, and **tracks** as you
      move over other sections (upper half of a row → line above it; lower half →
      line below it).
- [x] **Section to the bottom.** Drag the **first** section and drop it **below the
      last** section (hover the lower half of the last section) → it becomes the
      last section. Wait for **"All changes saved"**, **refresh** → order persists
      with it last.
- [x] **Field drop indicator.** Drag a field by its `⠿` handle → the insertion line
      appears between fields and tracks the pointer (line stays within that section).
- [x] **Field to the bottom.** Drag the **first** field in a section and drop it
      **below the last** field → it becomes the last field. Refresh → persists.
- [x] **No cross-section field moves.** While dragging a field, hover a *different*
      section's fields → no indicator appears there (fields reorder only within
      their own section). Dropping there is a no-op.

## 3 — Offline save retried on reconnect

- [x] DevTools → Network → **Offline**. Edit a field's value and wait → indicator
      shows **"Save failed"**; the edit stays on screen.
- [x] **Do NOT edit anything else.** Set Network back to **Online**.
- [x] Within a moment the indicator flips to **"Saving…"** then **"All changes
      saved"** on its own (the reconnect flush retries the failed save).
- [x] **Refresh** → the offline edit **persisted** (this is the bug that previously
      lost the change).
- [x] *(Optional, multi-edit)* Offline, edit **two** different fields, then go
      online → both retry and both persist on refresh.
- [x] *(Optional, reorder)* Offline, reorder a section, then go online → the new
      order is saved and persists on refresh.

## Pass criteria

Deleting a field/section that has content prompts for confirmation (empty ones
delete instantly); any section or field can be dragged to the last position with a
visible insertion indicator during the drag; and a save that fails while offline is
automatically retried when connectivity returns, with the edit surviving a refresh.

## Run log

**2026-07-09 — PASS (all three).** Run in-browser as the character owner on
campaign "Test 1".

- **Delete confirmations:** new fields now render with ghost placeholder text
  (empty label allowed via migration 0011); untouched fields/empty sections delete
  instantly, populated fields and sections-with-fields prompt to confirm.
- **Drag-to-reorder:** after a rewrite to a ref-based drop target + per-row
  `onDrop` + `dataTransfer.setData` (the earlier stale-closure/bubbling model
  couldn't move fields at all and couldn't reach the last position), sections and
  fields both reorder including to the bottom, with a tracking insertion line;
  cross-section field moves are correctly a no-op. Persists on refresh.
- **Offline retry:** an edit made while offline shows "Save failed", then flushes
  automatically on reconnect ("Saving…" → "All changes saved") and survives a
  refresh; multi-edit and offline-reorder variants also pass.

All three original 2.1.3 follow-ups are now resolved. Code: `CharacterPanel.tsx`;
schema: migration `0011_sheet_field_label_optional.sql`.
