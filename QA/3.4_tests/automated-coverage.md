# QA — Phase 3.4 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes `PartyPanel`, the
  `party/api.ts` aggregation module, and the new `listCampaignCharacters`
  read function.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **DM read scope / journal exclusion** — that the DM can read every party
  character/sheet/inventory/abilities/spells/lore/portrait, and that the Party
  view never exposes a player's journal, is verified through the real client and
  the UI — see [party-view.md](party-view.md) and
  [journal-exclusion.md](journal-exclusion.md).
- **Read-only behavior** — that nothing on the Party view is editable is a UI
  property, verified manually.

## Notes

- **No migration in 3.4.** 3.4.1 is a confirmation that the migration-0010 read
  predicates already span the needed surfaces; `pg_policies` shows
  `characters` = `owner OR is_campaign_dm`, the sheet/inventory/abilities/spells
  tables = `can_read_character`/`can_read_section`, and `journal_entries` =
  `owner OR (shared AND is_character_dm)` (DM sees shared entries only).
- The Party view deliberately does not call any journal read at all — journal
  privacy is enforced both by RLS and by the view simply not surfacing it.
