# QA — Sheet editing & persistence

**Phase:** 2.1. Verifies the owning player can create a character and freely
build/edit/reorder its sheet, that autosave is optimistic and reliable, and that
**everything persists on refresh** (the core 2.1.3 acceptance criterion).

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as
**Account B** (a player member), open the campaign, and select the **"My
character"** tab.

## Steps — creation

- [x] Submit an empty name → nothing happens (create is a no-op on blank).
- [x] Enter a name (e.g. `Thorin`) → **Create character**. The form is replaced by
      the editable sheet; the name field shows `Thorin`; the sheet is empty and
      offers **"Use starter layout"**.
- [x] **Refresh** the page → the character is still there (not the creation form).

## Steps — starter layout

- [x] Click **Use starter layout** → three sections appear: **Basics**,
      **Abilities**, **Combat**, each pre-filled with blank-value fields
      (Abilities has Strength…Charisma, etc.).
- [x] **Refresh** → all starter sections/fields persist in the same order.

## Steps — add / rename / delete

- [x] Click **+ Add section** → a new **"New section"** appears at the bottom.
- [x] Rename it (e.g. `Notes`); rename a field's **label** and type a **value**.
- [x] The save indicator shows **"Saving…"** then **"All changes saved"** shortly
      after you stop typing (debounced, ~600 ms — it does **not** save on every
      keystroke).
- [x] **+ Add field** inside a section → a new blank field row appears.
- [x] Delete a field (✕ on the row) → it disappears immediately (optimistic).
- [x] Delete a section (✕ in its header) → the section and its fields disappear.
- [x] **Refresh** → every rename, added field/section, typed value, and deletion
      is reflected exactly (nothing reverts, nothing reappears).

> **Follow-up (non-blocking UX gap, found 2026-07-09):** deleting a field or
> section with content is immediate/optimistic with **no confirmation** — a
> misclick silently loses data (fields) or a whole section's fields (sections).
> Proposed fix for a later pass: confirm before deleting a **field** that has a
> non-empty label or value, and confirm before deleting a **section** that
> contains any fields (regardless of their content). Empty/blank
> fields-with-nothing-typed and empty sections can keep deleting instantly.

## Steps — drag-to-reorder

- [x] Drag a **section** by its `⠿` handle and drop it before another section →
      the order changes on screen.
- [x] Drag a **field** by its `⠿` handle within a section and drop it before
      another field → the field order changes. (Fields reorder only within their
      own section.)
- [x] Wait for **"All changes saved"**, then **refresh** → both the new section
      order and the new field order persist.

> **Follow-up (functional gap, found 2026-07-09):** you **cannot move a section
> or field to the LAST position** in its area. Reordering drops an item *before*
> the target it's dropped on, so there is no drop target past the final item —
> e.g. Abilities can't be moved below the last section, and a field can't be moved
> below the last field in its section. Fix: treat a drop in the empty space
> after the last item (or on the lower half of the last item) as "append to end",
> so any item can reach the bottom.
>
> **Follow-up (UX, found 2026-07-09):** there is **no visual drop indicator**
> during a drag — the user can't see where the item will land. Add a visible
> insertion marker (e.g. a line between rows/sections, or highlighting the target
> slot) that tracks the drag position.

## Steps — portrait

- [x] In the header, use **Portrait** to upload a test image (drag or browse).
- [x] After processing, the portrait thumbnail renders in the header.
- [x] **Refresh** → the portrait still renders (resolved via a fresh signed URL
      from the stored `portrait_asset_id`).

## Steps — optimistic UI / failure surfacing (optional)

- [x] Throttle or drop the network (DevTools → Offline) and edit a field →
      the edit still shows locally; when the debounced save fails the indicator
      shows **"Save failed"** and an inline error appears. Restoring the network
      and editing again clears it. *(Sanity check that failures are visible, not
      silent.)* — failure surfacing works as described.

> **Follow-up (data-loss bug, found 2026-07-09):** a save that fails while offline
> is **never retried**. The edit stays in local state and the indicator shows
> "Save failed", but restoring the network does **not** flush the pending change —
> it is only re-attempted if the user happens to edit that same field again. An
> offline edit left untouched is silently lost on refresh. Fix: keep a
> pending/dirty queue of failed saves and flush it on reconnect (and/or retry with
> backoff), so "Save failed" always resolves to a real write once the network is
> back.

## Pass criteria

The player can create a character and add, rename, reorder, and delete sections
and fields freely; autosave is debounced and optimistic with a visible status;
and **all changes — including drag-reordering and the portrait — survive a page
refresh**.

## Run log

**2026-07-09 — PASS.** Run in-browser as player `ejcaldwell000@gmail.com` on
campaign "Test 1" (owner/DM `ejcaldwell06@gmail.com`). All steps behaved as
specified: creation (incl. blank no-op), starter layout, add/rename/delete,
debounced+optimistic autosave, drag-to-reorder, portrait round-trip, and
persistence on refresh at every stage. Offline test confirmed failures surface
visibly.

Three non-blocking follow-ups surfaced (see inline notes above):
1. No delete confirmation for fields/sections that contain content (data loss on
   misclick).
2. Cannot drag a section/field to the **last** position, and there is no visual
   drop indicator during a drag.
3. Offline/failed saves are **not retried or flushed on reconnect** — an untouched
   offline edit is lost on refresh.
