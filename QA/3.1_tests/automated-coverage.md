# QA — Phase 3.1 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes the two DM panels, the
  shared `dm/autosave` hook, the `notesApi`/`sessionsApi` modules, and the
  regenerated `dm_notes` / `sessions` types in `database.types.ts`.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS / DM-only access** — that players and anon can read/write neither
  `dm_notes` nor `sessions`, and that the DM has full CRUD, is verified through
  the real client per account — see [access-control.md](access-control.md).
- **Tag/attendee input** — that commas and trailing spaces survive while typing
  (the raw-draft fix) is a UI behavior, verified manually in
  [notes-editing.md](notes-editing.md) and
  [session-log-editing.md](session-log-editing.md).
- **Autosave, drag-reorder, delete-confirm, tag filtering** — behavior, verified
  manually.

## Notes

- Both tables enforce access with `private.is_campaign_dm(campaign_id)`
  (SECURITY DEFINER, migration 0003) on *all four* operations — a stricter model
  than the character tables, which grant the DM read-only. There is no
  owner/player split here: the workspace belongs to the campaign's DM(s).
- Supabase security advisors reported **no new findings** for `dm_notes` /
  `sessions` after migration 0017 (RLS enabled with policies on both).
