# QA — Phase 2.4: Abilities/feats, spells & personal journal

Verifies the three player tabs added in 2.4 (redesign) and their access rules:
`abilities`, `spells`, and `journal_entries` (migrations 0015 + 0016). The
headline acceptance criterion from [`PLANNING.md`](../../PLANNING.md) §2.4.3:

> - Confirm the journal is invisible to the DM by default.

## Architecture recap (what you're testing)

- **Abilities & Feats** tab — `abilities` (name, description, optional `uses`),
  manually ordered ([`AbilitiesPanel`](../../src/features/abilities/AbilitiesPanel.tsx)).
- **Spells** tab — `spells` (name, `level` 0–9, `prepared`, description),
  displayed grouped by level ([`SpellsPanel`](../../src/features/spells/SpellsPanel.tsx)).
- Both reuse the 0010 predicates: **owner read/write, campaign DM read-only,
  other players none** (same as sheet/inventory).
- **Journal** tab — `journal_entries` (title, body, `shared`). **Owner-only by
  default**; the DM can read an entry **only when the player sets `shared = true`**
  (migration 0015 + `private.is_character_dm`); other players never. The DM can
  never write. ([`JournalPanel`](../../src/features/journal/JournalPanel.tsx))

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Reuse the standing data: campaign
  **"Test 1"**, DM `ejcaldwell06`, character owner `ejcaldwell000`, co-player
  `ejcaldwell.test`, non-member `ejcaldwell00`.
- Grab the owner's character id (as the owner, in the console):
  ```js
  (await supabase.from('characters').select('id').single()).data
  ```

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Abilities & spells editing | [abilities-and-spells.md](abilities-and-spells.md) | Add/edit/delete abilities (uses, description, reorder) and spells (level grouping, prepared, level-change regroup); autosave; persistence; DM read-only / others-none RLS |
| Journal privacy | [journal-privacy.md](journal-privacy.md) | Journal edit/persist; **DM cannot see an entry until the player shares it**; shared entry becomes DM-readable; co-player & anon never; DM cannot write |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

Abilities and spells edit/reorder/persist and are DM-read-only (others none); the
personal journal is invisible to the DM by default and becomes visible for a
specific entry only when the player shares it, never to other players.
