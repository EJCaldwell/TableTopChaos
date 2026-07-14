# QA — Phase 2.1 automated coverage

Same posture as 1.4–1.6: no unit-test runner in the project yet, so automated
coverage is the **type-checker + build**, and the substantive verification is the
manual checklists in this folder.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — types across the app, including the
  new character feature (`src/features/character/*`) and the regenerated
  `database.types.ts` (now includes `characters`, `sheet_sections`, and
  `sheet_fields`).
- `npm run build` — production build succeeds (no dynamic-import or other
  warnings).

## What automated coverage does NOT prove

- **RLS behavior.** The owner/DM/other-player access rules (migration 0010) are
  only trustworthy when observed through the real client as each account — see
  [access-control.md](access-control.md). A passing build says nothing about who
  can read/write which row.
- **Autosave & optimistic UI.** Debounce timing, the save indicator, and
  optimistic apply/rollback need the running app — see
  [sheet-editing.md](sheet-editing.md).
- **Drag-to-reorder + persistence.** Native HTML5 drag-and-drop and the
  `position` writes are behavior, not types; verified manually.
- **Portrait round-trip.** Upload → stored `portrait_asset_id` → signed-URL
  re-render after refresh crosses the media pipeline and Storage RLS; manual.

## Notes / follow-ups

- **DM read-only view surface** (the "Party" tab) is not built yet; RLS already
  permits the DM read, so 2.1.3 verifies it at the data layer. The UI entry point
  is slated for the later DM-tools phase.
- The "My character" tab treats a campaign as **single-character per player**
  (loads the earliest character); multi-character support, if ever wanted, is a
  future change — the schema does not forbid extra rows.
