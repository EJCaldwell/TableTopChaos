# QA — Phase 4.3 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes `HpConditionsPanel`,
  `SchedulePanel`, their `api.ts` modules, and the regenerated
  `character_status` / `schedule_sessions` / `schedule_rsvps` types.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS** — owner-only HP writes / DM read; scheduling member-read, DM-write
  sessions, own-only rsvp — verified per account in the manual files.
- **Behavior** — damage/heal math (temp HP first), death-save pips, condition
  toggles, RSVP tally, persistence on refresh — verified manually.

## Notes

- All three tables enforce RLS and reported no `rls_enabled_no_policy` advisory
  after migrations 0025/0026.
- `character_status` reuses `can_read_character` / `can_write_character` (0010);
  `schedule_rsvps` uses a new `can_access_session` SECURITY DEFINER helper (0026).
- These three tables are **not yet** part of the campaign export/import (4.2) —
  tracked as a follow-up; out of scope for this phase's QA.
