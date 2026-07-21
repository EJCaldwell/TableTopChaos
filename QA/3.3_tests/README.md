# QA — Phase 3.3: NPC roster & quest/plot tracker

Verifies the DM's **Quests** tab (migration 0021) and confirms the **NPC roster**
(delivered with 3.2, migration 0020). Acceptance criteria from
[`PLANNING.md`](../../PLANNING.md) §3.3.3:

> - NPCs and quests are invisible to players.

## Architecture recap (what you're testing)

- **NPCs** — the campaign roster with configurable stat blocks. Built and tested
  under **Phase 3.2** ([QA/3.2_tests](../3.2_tests/)); the "NPCs invisible to
  players" half of this criterion is covered there
  ([3.2 access-control](../3.2_tests/access-control.md)). Not re-tested here.
- **Quests** tab — a board grouped by status
  ([`QuestsPanel`](../../src/features/dm/QuestsPanel.tsx)): `quests`
  (title, `status` = active|completed, description, private `plot_notes`, manual
  `position`). Create/edit, change status to move between the Active/Completed
  groups, drag-reorder within a group, and delete — all autosaved.
- **Access — strictly DM-only** for every operation on `quests`, gated on
  `private.is_campaign_dm(campaign_id)`. Players and non-members see/write nothing.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Campaign **"Test 1"**
  (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`), DM `ejcaldwell06`, player
  `ejcaldwell.test`, non-member `ejcaldwell00`.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Quests editing | [quests-editing.md](quests-editing.md) | Create/edit/delete quests; status move between Active/Completed groups; description + DM-only plot notes; drag-reorder within a group; autosave; persistence |
| Access control (DM-only) | [access-control.md](access-control.md) | **The headline check:** players and anon can read/write no `quests`; the Quests tab is absent for players; the DM has full CRUD. (NPC invisibility is verified in 3.2.) |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

Quests create/edit/reorder/persist and move cleanly between Active and Completed;
and neither quests nor NPCs are readable/writable by players or anonymous callers,
with the Quests (and NPCs) tabs absent from the player UI.
