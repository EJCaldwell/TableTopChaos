# QA — Phase 4.3: Player HP & conditions + shared scheduling

Verifies the two tabs added after Phase 4 (filling former placeholders): the
player's **HP & conditions** tracker (`character_status`, migration 0025) and the
shared **Scheduling** tab (`schedule_sessions` + `schedule_rsvps`, migration
0026). Also confirms the removed **Dice** and **Party loot** placeholder tabs no
longer appear.

## Architecture recap (what you're testing)

- **HP & conditions** — [`HpConditionsPanel`](../../src/features/status/HpConditionsPanel.tsx):
  one `character_status` row per character (current/max/temp HP, death-save
  tallies, conditions[]). Owner edits; DM reads (RLS mirrors the sheet:
  `can_read_character` select, `can_write_character` write). Row is created lazily
  on first edit (upsert).
- **Scheduling** — [`SchedulePanel`](../../src/features/schedule/SchedulePanel.tsx):
  DM proposes sessions (`schedule_sessions`, DM-write / member-read); every member
  RSVPs (`schedule_rsvps`, one per member per session; a member writes only their
  own, everyone reads the tally via `can_access_session`).

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Campaign **"Test 1"**
  (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`), DM `ejcaldwell06`, player
  `ejcaldwell.test` (has a character), non-member `ejcaldwell00`.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| HP & conditions | [hp-conditions.md](hp-conditions.md) | HP/temp/heal/damage, death saves, conditions, persistence; DM read-only via Party; owner-only writes (RLS) |
| Scheduling | [scheduling.md](scheduling.md) | DM propose/edit/delete; member RSVP + tally; RLS (members read, DM writes sessions, members write only own rsvp) |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

HP & conditions persists and is owner-write / DM-read; scheduling lets the DM
propose and members RSVP with a correct tally, enforced by RLS; and the Dice /
Party loot tabs are gone.
