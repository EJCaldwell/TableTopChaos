# QA — Phase 3.5: DM private helpers (initiative + dice)

Verifies the DM's **Combat** tab (migration 0022): a private initiative tracker
and a client-side dice roller. Acceptance criterion from
[`PLANNING.md`](../../PLANNING.md) §3.5.3:

> - Initiative list and dice roller are visible only to the DM.

## Architecture recap (what you're testing)

- **Combat** tab — [`CombatPanel`](../../src/features/dm/CombatPanel.tsx):
  - **Initiative tracker** — `initiative_entries` (name, `initiative` value,
    notes, manual `position`). Add a blank combatant, **seed from the party**
    (one row per player character), or **add a roster NPC**; edit
    name/initiative/notes; **Sort by initiative** (bakes the value-sorted order
    into `position`) and drag-reorder ties; **step through** turns with a
    current-turn pointer + **round** counter (client-only, not persisted); Clear.
  - **Dice roller** — pure client-side: standard notation (`2d6+3`, `d20`,
    `1d8+1d4+2`) parsed and rolled in the browser, quick single-die buttons, and
    an in-session history. No DB, no persistence, not shared.
- **Access** — `initiative_entries` is **DM-only** for every operation
  (`is_campaign_dm`). The dice roller has no server surface at all. The Combat
  tab never renders for players.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Campaign **"Test 1"**
  (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`), DM `ejcaldwell06`, player
  `ejcaldwell.test`, non-member `ejcaldwell00`. A couple of player characters and
  roster NPCs exist (from earlier phases) to test seeding.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Combat tools | [combat-tools.md](combat-tools.md) | Initiative add/seed/edit/sort/reorder/step-through/persist; dice notation parsing, quick dice, history |
| Access control (DM-only) | [access-control.md](access-control.md) | **The headline check:** players and anon can read/write no `initiative_entries`; the Combat tab is absent for players |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

The initiative tracker manages combatants (add/seed/edit/sort/reorder/step) and
persists; the dice roller rolls valid notation correctly and rejects bad input;
and neither is reachable by players — `initiative_entries` is DM-only and the
Combat tab is absent from the player UI.
