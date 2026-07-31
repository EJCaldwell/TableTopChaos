# QA — Inventory editing & persistence

**Phase:** 2.2. Verifies the owning player can add, edit, reorder, and remove
inventory items, that autosave is optimistic and reliable, and that everything
persists on refresh.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
character owner (`ejcaldwell000@gmail.com`), open campaign "Test 1", select the
**"Inventory"** tab.

## Steps — no-character guard

- [ ] *(Optional)* Sign in as a player who has **not** created a character and open
      Inventory → the panel shows **"No character yet"** pointing to the "My
      character" tab (no inventory UI). Skip if your test player already has one.

## Steps — add / edit

- [x] With a character present, the panel shows **"Inventory"** and an empty-state
      line ("Nothing carried yet…") plus **+ Add item**.
- [x] Click **+ Add item** → a row appears with an **empty name showing the
      "Item name" ghost placeholder** (no literal text to delete), qty **1**, empty
      notes, equipped unchecked.
- [x] Edit the **name** (e.g. `Longsword`); set **qty** (e.g. 2); type **notes**
      (e.g. "+1, from the vault"); tick **equipped**.
- [x] The save indicator shows **"Saving…"** then **"All changes saved"** shortly
      after you stop (debounced — not on every keystroke).
- [x] **Refresh** → all items, names, quantities, notes, and equipped states persist.

## Steps — expandable notes

- [x] Clicking the notes preview (or the **expand chevron** `▸` next to delete ✕)
      opens a full multi-line **textarea** ("Full description / notes") below the
      row; the chevron turns to `▾`.
- [x] Type a long, multi-line description in the textarea → it autosaves; the
      collapsed preview shows the first line truncated with the `. . .`.
- [x] Collapse (`▾` → `▸`) and **refresh** → the full description persists; expand
      again to confirm the whole text is intact.
- [x] Expanding/collapsing is per-item (expanding one doesn't expand others).

## Steps — qty guard

- [x] Try to set qty to `0` or clear it → it does not persist below **1** (the
      field floors to 1; DB also enforces qty > 0). Confirm on refresh qty ≥ 1.

## Steps — drag-to-reorder

- [x] Drag an item by its `⠿` handle → a thin insertion line appears and tracks the
      pointer (upper half of a row → line above; lower half → below).
- [x] Drop it in a new spot, including **below the last item** (append to end).
- [x] Wait for **"All changes saved"**, then **refresh** → the new order persists.

## Steps — remove (with confirmation)

- [x] **Pristine row deletes instantly.** Add an item, leave it blank (empty
      name/qty 1/no notes/not equipped), click ✕ → deletes with **no** prompt.
- [x] **Item with content confirms.** On an item you named/edited, click ✕ → a
      **confirm dialog** naming the item appears. Cancel → stays. ✕ → confirm →
      removed. Refresh → still gone.

## Steps — offline retry (optional)

- [x] DevTools → Network → **Offline**. Edit an item and wait → **"Save failed"**;
      the edit stays on screen.
- [x] Set Network back to **Online** without editing again → indicator flips to
      **"Saving…"** → **"All changes saved"** on its own; **refresh** → the edit
      persisted.

## Pass criteria

The player can add, edit (name/qty/notes/equipped), reorder, and remove items
freely; autosave is debounced/optimistic with a visible status and retries after
an offline failure; and all of it survives a page refresh.

## Run log

**2026-07-09 — PASS.** Run in-browser as the character owner
(`ejcaldwell000@gmail.com`) on campaign "Test 1". Add/edit (name/qty/notes/
equipped), qty floor, drag-to-reorder incl. to the bottom, delete (instant for
pristine, confirm for populated), and offline retry all behaved as specified;
everything persists on refresh.

Two UX enhancements added during the run (from user feedback):
1. **Expandable notes** — the notes cell is a single-line preview that opens to a
   full multi-line textarea (per-item), so long descriptions have room.
2. **Custom overflow ellipsis** — the collapsed preview ends in an oversized,
   spaced `. . .` shown only when the text actually overflows (measured from the
   DOM; native text-overflow ellipsis can't be styled).
Plus: new items now start with an **empty name + "Item name" ghost placeholder**
(migration 0013 relaxed the name check to allow '').
