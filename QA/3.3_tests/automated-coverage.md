# QA — Phase 3.3 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes `QuestsPanel`, the
  `questsApi` module, and the regenerated `quests` type in `database.types.ts`.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS / DM-only access** — that players and anon can read/write no `quests`, and
  that the DM has full CRUD — verified per account in
  [access-control.md](access-control.md).
- **Status grouping / reorder / autosave** — UI behavior, verified in
  [quests-editing.md](quests-editing.md).

## Notes

- `quests` enforces access on `is_campaign_dm(campaign_id)` for all four
  operations (migration 0021). Supabase advisors reported no new findings after
  0021.
- The **NPC roster** half of Phase 3.3 shipped with 3.2 (migration 0020) and is
  covered by [QA/3.2_tests](../3.2_tests/); it is not duplicated here.
