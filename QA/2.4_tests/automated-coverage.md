# QA — Phase 2.4 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes the abilities, spells, and
  journal features and the regenerated `abilities` / `spells` / `journal_entries`
  types.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS / journal privacy** — that the DM sees only shared journal entries and
  that abilities/spells are DM-read-only / others-none is verified through the
  real client per account — see [journal-privacy.md](journal-privacy.md) and
  [abilities-and-spells.md](abilities-and-spells.md).
- **Autosave, level regrouping, reorder, delete-confirm** — behavior, verified
  manually.

## Notes

- Abilities & spells reuse the migration 0010 predicates, so their access stays
  in lock-step with the character. The journal is the one place with a distinct,
  stricter model (owner-only + share-to-DM), backed by `private.is_character_dm`
  (migration 0015).
- The earlier combined "spells & abilities" table was removed; this phase's
  backend is migrations 0015 (journal) + 0016 (abilities + spells).
