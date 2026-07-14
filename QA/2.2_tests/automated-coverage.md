# QA — Phase 2.2 automated coverage

Same posture as 2.1: no unit-test runner yet, so automated coverage is the
**type-checker + build**; the substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes the inventory feature
  (`src/features/inventory/*`) and the regenerated `database.types.ts` (now with
  `inventory_items`).
- `npm run build` — production build succeeds. (Bundle now trips Vite's advisory
  >500 kB chunk-size warning — informational, not an error; code-splitting is a
  later optimization, not a 2.2 blocker.)

## What automated coverage does NOT prove

- **RLS behavior** (owner/DM/other-player) — see [access-control.md](access-control.md).
- **Autosave, optimistic UI, offline retry, drag-to-reorder** — behavior, verified
  manually in [inventory-editing.md](inventory-editing.md).

## Notes

- Inventory RLS reuses the migration 0010 character predicates, so it stays in
  lock-step with the character sheet's access rules by construction — no separate
  policy logic to drift.
- `qty` is guarded on both sides: the UI floors it to 1 and the DB `check (qty > 0)`
  rejects anything lower.
