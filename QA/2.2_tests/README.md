# QA — Phase 2.2: Inventory

Verifies the per-character inventory built in 2.2: the `inventory_items` table +
its RLS (migration 0012), and the `InventoryPanel` UI (add/edit/remove, quantity,
equipped flag, free-text notes, drag-to-reorder, autosave). Acceptance criteria
are from [`PLANNING.md`](../../PLANNING.md) §2.2.3:

> - Add/edit/remove items; data scoped to the owning character.

## Architecture recap (what you're testing)

- **`inventory_items`** — one row per item (character, name, qty, notes, equipped
  flag, position). **RLS reuses the 0010 predicates** (`can_read_character` /
  `can_write_character`), so access matches the character sheet exactly: owner
  read/write, campaign **DM read-only**, other players **none**.
- **UI** ([`InventoryPanel`](../../src/features/inventory/InventoryPanel.tsx)) on
  the player-only **"Inventory"** tab. Same autosave model as the character sheet:
  optimistic, debounced (~600 ms) per item, "Saving…/All changes saved/Save
  failed" indicator, offline-retry queue flushed on reconnect, and drag-to-reorder
  with a visible insertion line. Inventory hangs off the player's character, so
  with no character the panel points to the "My character" tab.

## Prerequisites (shared)

- Dev server (`npm run dev`) against live project `fnykpoattheldxtkrozd`.
- The 2.1 test data is reused: campaign **"Test 1"**, owner/DM
  `ejcaldwell06@gmail.com`; players `ejcaldwell000@gmail.com` (owns the character)
  and `ejcaldwell.test@gmail.com` (co-player). A non-owner needs the character id
  for the RLS checks (grab it from the DB or as the owner).

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Inventory editing & persistence | [inventory-editing.md](inventory-editing.md) | Add/edit/remove items; qty; equipped toggle; notes; drag-to-reorder; delete confirmation; autosave + offline retry; **persists on refresh** |
| Access control (RLS) | [access-control.md](access-control.md) | Data scoped to the owning character: owner read/write; **DM read-only**; co-player/non-member/anon **no access** |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

A player can add, edit (name/qty/notes/equipped), reorder, and remove inventory
items on their character, with everything persisting on refresh; the data is
scoped to the owning character — the DM can read it but not modify it, and other
players cannot read it.

## Phase result

**2026-07-09 — PASS (both areas).** All acceptance criteria met; RLS exactly
matches the character's access. Two UX enhancements added during the run:
expandable per-item notes (single-line preview → full textarea) with a custom
oversized/spaced overflow ellipsis, and ghost-placeholder item names (migration
0013 relaxed the name check to allow ''). See the area run logs for detail.
