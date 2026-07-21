# QA — Access control (DM-only)

**Phase:** 3.1. The headline 3.1.3 criterion: **DM notes/recaps are invisible to
players.** Verifies that `dm_notes` and `sessions` are readable and writable by
the campaign's DM only — players and anonymous callers can do neither — and that
the two tabs never render in the player UI.

**Prerequisites:** shared prerequisites in [README.md](README.md). Have the
campaign id `<campaign_id>` for **"Test 1"** handy, and at least one note and one
session created by the DM (from the editing checklists).

## Steps — UI gating (defense-in-depth)

- [x] Sign in as the **DM** (`ejcaldwell06`), open "Test 1" → the badge reads
      **"You are the DM"**, and both **Secret notes** and **Session log** tabs
      are present.
- [x] Sign in as a **player** (`ejcaldwell.test`), open "Test 1" → the badge
      reads **"You are a player"**, and **neither** tab appears in the tab bar.

## Steps — data layer (RLS is the real gate)

Run in the console (`window.supabase`) as each account.

- [x] As the **DM**, read both tables → **rows returned**:
      ```js
      await supabase.from('dm_notes').select('*').eq('campaign_id', '<campaign_id>')
      await supabase.from('sessions').select('*').eq('campaign_id', '<campaign_id>')
      ```
- [x] As the **DM**, full write works — update an existing row and insert a new
      one both succeed (**rows returned**, no 403):
      ```js
      await supabase.from('dm_notes').update({ title: 'edited' }).eq('campaign_id', '<campaign_id>').select()
      await supabase.from('sessions').insert({ campaign_id: '<campaign_id>', title: 'QA insert' }).select()
      ```
- [x] As the **player** (`ejcaldwell.test`, a member of "Test 1"), read either
      table → **0 rows** (a player is *in* the campaign but still sees nothing):
      ```js
      await supabase.from('dm_notes').select('*').eq('campaign_id', '<campaign_id>')   // → data: []
      await supabase.from('sessions').select('*').eq('campaign_id', '<campaign_id>')   // → data: []
      ```
- [x] As the **player**, attempt to insert into each → **403 Forbidden** (write
      denied):
      ```js
      await supabase.from('dm_notes').insert({ campaign_id: '<campaign_id>', title: 'X' }).select()  // → 403
      await supabase.from('sessions').insert({ campaign_id: '<campaign_id>', title: 'X' }).select()  // → 403
      ```
- [x] As the **player**, attempt to update the DM's rows → **0 rows** affected
      (the rows aren't even visible to update):
      ```js
      await supabase.from('dm_notes').update({ title: 'HACKED' }).eq('campaign_id', '<campaign_id>').select()  // → data: []
      ```
- [x] As a **non-member** (`ejcaldwell00`), read either table → **0 rows**.
- [x] Signed out (**anon**), read either table → **0 rows**.

## Pass criteria

Both tabs are absent from the player UI; the DM has full CRUD on `dm_notes` and
`sessions`; and players (members included), non-members, and anonymous callers
can read nothing and write nothing to either table. Confirms migration 0017's
DM-only policies (`private.is_campaign_dm` on all four operations).

## Run log

- **2026-07-15** — PASS. Campaign "Test 1" (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`).
  - **UI gating** — DM (`ejcaldwell06`) sees both Secret notes + Session log tabs;
    player (`ejcaldwell.test`) sees neither.
  - **DM** — reads 3 `dm_notes` / 3 `sessions`; update → 3 rows (200); insert → 1
    row (201). Full CRUD confirmed.
  - **Player** (member) — reads `[]`/`[]`; inserts → **403 Forbidden** (both
    tables); update → `data: []` (rows not even visible to affect).
  - **Non-member** (`ejcaldwell00`) — reads `[]`/`[]`.
  - **Anon** — reads `[]`/`[]`.
  - Policy layer independently verified via `pg_policies`: all 8 policies (4 per
    table) gate SELECT/INSERT/UPDATE/DELETE on `private.is_campaign_dm(campaign_id)`,
    authenticated role only. Security advisors reported no new findings for
    `dm_notes` / `sessions` after migration 0017.
