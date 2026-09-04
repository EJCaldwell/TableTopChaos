# Manual checklist — Mode data model & access control (Phase 5.1)

**Phase:** 5.1 — Mode data model & switching
**Run by:** Claude, server-side through the Supabase MCP (`execute_sql` with
`set local role` + JWT claims). No browser needed — and deliberately so: UI gating
is defense-in-depth, the data layer is the test.

## Prerequisites

- Project `fnykpoattheldxtkrozd`, migration 0028 applied.
- Campaign **"Main Test"** `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`.
- User ids: DM `ejcaldwell06` = `6c5f4c63-6959-46ea-9337-42ec562c242c`;
  player `ejcaldwell.test` = `f1fd154d-4199-4d12-a5fd-0dc58ed7de7c`;
  non-member `ejcaldwell00` = `a900ec93-314f-4c85-b65a-c8cdfd3bfb5e`.
- Every write below runs inside `begin; … rollback;` so no fixture data changes.

## Steps

### Schema

- [x] 1. The enum exists with exactly the three tiers in order.
      Expect `notetaker,playspace,rpg`.
- [x] 2. `campaigns.game_mode` is `not null default 'notetaker'`.
      Expect `'notetaker'::game_mode / NO`.

### Access-control matrix — `update campaigns set game_mode = …`

- [x] 3. **DM** update → **1 row affected**.
- [x] 4. **Player (member)** update → **0 rows affected** (silent no-op at the DB;
      `setGameMode`'s `.single()` turns that into a thrown error in the client).
- [x] 5. **Non-member** update → **0 rows affected**.
- [x] 6. **Anon** select of the campaign → **0 rows** (cannot even read the mode).
- [x] 7. **Player** select of the campaign → **1 row** — members must still *read*
      the mode, since Overview shows a read-only "plays as X" line.
- [x] 8. Policy audit on `campaigns`: exactly four policies, all `{authenticated}`,
      no `anon` policy; the only UPDATE policy is `campaigns_update_dm` gated on
      `private.is_campaign_dm(id)` in **both** `USING` and `WITH CHECK`.

### Invariants

- [x] 9. An invalid mode value is rejected by the enum, not silently coerced.
- [x] 10. No trigger fires on `game_mode`: the only triggers on `campaigns` are
      `campaigns_add_owner_as_dm` (AFTER INSERT) and `campaigns_set_updated_at`
      (BEFORE UPDATE — touches `updated_at` only). No cascade, no mode trigger.
- [x] 11. **Non-destructive switching:** as DM, run `notetaker → rpg → notetaker →
      playspace` in one transaction and re-count the campaign's child rows.
      Every count must be unchanged.

## Pass criteria

The DM is the only role that can change the mode; player, non-member and anon all
fail (0 rows / no read), and no `anon` policy exists on `campaigns`. The enum
rejects unknown values, nothing is triggered or cascaded by a mode change, and
switching across all three tiers leaves campaign data byte-for-byte intact.

## Deferred

The full non-destructive proof — that **playspace maps/tokens/walls/lights**
(Phase 9) and **combat rows** (Phase 10) survive a switch-down — cannot run until
those tables exist. Re-verify it in Phase 9 and Phase 10 QA. Step 11 is the
strongest version available today: existing campaign data plus the structural
proof (step 10) that nothing is wired to delete on mode change.

## Run log

**2026-07-31 — PASS.** Campaign `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa` ("Main
Test"), all writes rolled back.

- Step 1 — enum values → `notetaker,playspace,rpg`. PASS.
- Step 2 — column → `'notetaker'::game_mode / NO` (not null, defaulted). PASS.
- Step 3 — DM (`6c5f4c63…`) `set game_mode='rpg'` → `rows_affected: 1`. PASS.
- Step 4 — player (`f1fd154d…`, a member of this campaign) same update →
  `rows_affected: 0`. PASS.
- Step 5 — non-member (`a900ec93…`) same update → `rows_affected: 0`. PASS.
- Step 6 — `role anon`, claims cleared, select the campaign → `0` rows. PASS.
- Step 7 — player select → `1` row, so the read-only mode line still works. PASS.
- Step 8 — `pg_policies` on `campaigns`: `campaigns_select_members` (SELECT,
  `owner_id = auth.uid() OR private.is_campaign_member(id)`), `campaigns_insert_own`
  (INSERT), `campaigns_update_dm` (UPDATE, `private.is_campaign_dm(id)` in both
  `qual` and `with_check`), `campaigns_delete_owner` (DELETE,
  `owner_id = auth.uid()`). All `{authenticated}`; **no anon policy**. PASS.
- Step 9 — DM `set game_mode='wargame'` → `ERROR 22P02: invalid input value for
  enum game_mode: "wargame"`. Rejected. PASS.
- Step 10 — triggers on `campaigns`: `campaigns_add_owner_as_dm` (AFTER INSERT) and
  `campaigns_set_updated_at` (BEFORE UPDATE → `set_updated_at()`). Neither reads or
  reacts to `game_mode`; no cascade on the column. PASS.
- Step 11 — DM ran `rpg → notetaker → playspace` in one transaction; counts after:
  characters 2, npcs 4, encounters 2, initiative_entries 1, campaign_members 4 —
  identical to before, final mode `playspace`. Rolled back. PASS.
- Also confirmed all 7 campaigns in the project still read `notetaker` — the 0028
  default landed with no backfill and disturbed nothing.
- Advisors after 0028/0029: no new lints (see automated-coverage.md).
