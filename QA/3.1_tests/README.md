# QA — Phase 3.1: DM notes & session log/recaps

Verifies the two DM-workspace tabs added in 3.1 and their access rules:
**Secret notes** (`dm_notes`) and **Session log** (`sessions`), both from
migration 0017. The headline acceptance criterion from
[`PLANNING.md`](../../PLANNING.md) §3.1.3:

> - DM notes/recaps are invisible to players.

## Architecture recap (what you're testing)

- **Secret notes** tab — `dm_notes` (title, body, `tags[]`, manual `position`),
  with a tag-filter bar and drag-reorder
  ([`NotesPanel`](../../src/features/dm/NotesPanel.tsx)).
- **Session log** tab — `sessions` (title, `session_date`, `recap`,
  `attendees[]`, manual `position`), with drag-reorder
  ([`SessionLogPanel`](../../src/features/dm/SessionLogPanel.tsx)).
- **Access — strictly DM-only for _every_ operation.** Unlike the character
  tables (owner read/write, DM read-only), these are the DM's *own* private
  workspace: every policy is gated on `private.is_campaign_dm(campaign_id)` for
  select/insert/update/delete. Players (and non-members) match no policy and see
  and write **nothing**. A campaign may have more than one DM; all DMs of the
  campaign share the same notes/sessions.
- Both panels share one autosave engine
  ([`dm/autosave.tsx`](../../src/features/dm/autosave.tsx)): optimistic edits,
  per-field debounce, offline-retry queue, and drag-reorder helpers. Tags and
  attendees keep a raw text draft so commas/spaces survive typing and only the
  parsed list is stored.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Reuse the standing data: campaign
  **"Test 1"**, DM `ejcaldwell06`, a player `ejcaldwell.test`, non-member
  `ejcaldwell00`.
- Grab the campaign id (as the DM, in the console):
  ```js
  (await supabase.from('campaigns').select('id, name')).data
  ```

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Notes editing | [notes-editing.md](notes-editing.md) | Add/edit/delete notes; tags typing (commas + spaces) and tag-filter bar; drag-reorder; autosave; persistence |
| Session log editing | [session-log-editing.md](session-log-editing.md) | Add/edit/delete sessions; date; attendees typing (commas + spaces); recap; drag-reorder; persistence |
| Access control (DM-only) | [access-control.md](access-control.md) | **The headline check:** players and anon can read/write neither `dm_notes` nor `sessions`; tabs don't render for players; the DM has full CRUD |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

Notes and sessions add/edit/tag/reorder/persist for the DM; tags and attendees
accept comma- and space-separated input; and — the headline — neither table is
readable or writable by players or anonymous callers, with the tabs absent from
the player UI entirely.
