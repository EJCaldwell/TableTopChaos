# Automated coverage — Phase 7.4

"Automated" here means `npm run build` (`tsc -b` + `vite build`),
`npm run qa:checks`, and server-side verification run directly against the
production database over `railway ssh … psql`. There is still no general test
runner.

## `npm run build` — clean

**The type layer did real work in this subphase.** Renaming `display_name` →
`username` in `database.types.ts` turned every stale read into a compile error,
including three that a grep for `display_name` would have found but a grep for
`displayName` would not. The build enumerated the sweep rather than me guessing
at it:

```
ProfilePage.tsx(71,31): Property 'display_name' does not exist …
schedule/api.ts(92,55):  Property 'display_name' does not exist …
SchedulePanel.tsx(133,48): Property 'display_name' does not exist …
```

`username` is typed `string` (not `string | null`) because 0039 made it NOT
NULL, so every `?? 'Unnamed adventurer'` fallback became provably dead and was
deleted rather than left as decoration.

## `npm run qa:checks` — 62 passed, 0 failed

Unchanged by this subphase; it covers workspace-layout logic, which usernames do
not touch. Re-run to confirm no regression.

## Server-side

Everything below is recorded in the run log with its output:

| | |
|---|---|
| Backfill correctness | 5/5 accounts legal, unique, no nulls |
| Constraint matrix (as `authenticated`) | 8 cases |
| `claim_username` allocator | 9 cases, twice — before and after the 0040 fix |
| End-to-end signup through GoTrue | 3 accounts |
| Character-name exposure (0041) | 4 access cases + 7 privacy assertions |

## NOT covered automatically

The browser: the signup form, the rename flow, the provisional banner, and the
roster line rendering. Those are in [usernames.md](usernames.md) and are the
user's to run.
