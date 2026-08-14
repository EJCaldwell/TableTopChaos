# QA — Phase 5.1: Mode data model & switching

Covers the per-campaign **game mode** shipped in 5.1.1 / 5.1.2 / 5.1.2b / 5.1.2c:
the `campaigns.game_mode` column, picking a mode when creating a campaign,
switching it later from the new DM-only **Settings** tab, its persistence, DM-only
enforcement by RLS, and the **non-destructive switch-down** invariant.

5.1 ships the data model and the controls **only**. The mode does not change the
app's chrome yet — that is 5.2 — so a `playspace` / `rpg` campaign still renders
today's tab bar. Expected, not a bug.

## What you are testing

- **Data model** — `public.game_mode` enum (`notetaker` | `playspace` | `rpg`) and
  `campaigns.game_mode not null default 'notetaker'`
  ([0028_game_mode.sql](../../supabase/migrations/0028_game_mode.sql)). The default
  means no backfill ran and every pre-existing campaign is untouched.
- **Access** — switching is a plain `update` on `campaigns`, so it reuses
  **`campaigns_update_dm`** (`private.is_campaign_dm(id)` as both `USING` and
  `WITH CHECK`). No new policy shipped with 0028.
- **Reads** — `getCampaign` / `listMyCampaigns` already `select('*')`, so the mode
  flows through with no new endpoint.
- **Write** — [`setGameMode`](../../src/features/campaigns/api.ts) uses `.single()`,
  so a blocked update throws instead of silently no-op'ing.
- **UI** — shared [`ModePicker`](../../src/features/campaigns/ModePicker.tsx) used by
  both the create form on [`DashboardPage`](../../src/features/campaigns/DashboardPage.tsx)
  and the "Game mode" section of
  [`SettingsPanel`](../../src/features/campaigns/SettingsPanel.tsx), so the wording
  and ordering cannot drift.
- **Settings tab (5.1.2b)** — campaign administration moved out of
  [`OverviewPanel`](../../src/features/campaigns/OverviewPanel.tsx) into a DM-only
  `settings` tab, last in the DM group ([tabs.ts](../../src/features/campaigns/tabs.ts)):
  name, game mode, Backup & data (**export only** as of 2026-08-07 — import stayed
  on the dashboard), owner-only danger zone. Overview keeps the roster,
  invite codes and a read-only mode line. Pure relocation — no behavior change.
- **Co-DM removal (5.1.2c)** — migration 0029 is comments only; `createInviteCode`
  no longer takes a `role` and hard-codes `'player'`.
- **Invariant** — no trigger and no cascade is wired to `game_mode`. Lower modes stop
  *reading* richer data; they never delete it.

## Shared prerequisites

- Dev server on **:5173** against project `fnykpoattheldxtkrozd`.
- Campaign **"Main Test"** `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`
  (DM `ejcaldwell06`; players include `ejcaldwell.test`). Non-member: `ejcaldwell00`.
- All campaigns currently read `notetaker`.

## Areas

| Area | File | Who runs it | Status |
|------|------|-------------|--------|
| Mode data model & access control | [mode-access.md](mode-access.md) | Claude, server-side via Supabase MCP | **PASS** 2026-07-31 |
| Mode selection & switching (UI) | [mode-selection.md](mode-selection.md) | User, in browser | **PASS** 2026-08-07 |
| DM Settings tab | [settings-tab.md](settings-tab.md) | User, in browser | **PASS** 2026-08-07 |

**Phase 5.1 QA is complete — all three areas PASS.** One follow-up came out of the
Settings run: import was removed from the Settings tab's **Backup & data** block
(export only now), since importing creates a *new* campaign and therefore belongs
to the dashboard. See the run log in [settings-tab.md](settings-tab.md).

The playspace/combat half of the non-destructive invariant (maps, tokens, combat
rows surviving a switch-down) cannot be tested until those tables exist — deferred
to Phase 9 / Phase 10 QA. What *is* testable now — that no trigger or cascade hangs
off the column, and that existing campaign data is untouched across up→down→up — is
covered in [mode-access.md](mode-access.md).

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — `tsc -b` + `vite build` only;
this project has no test runner (Phase 8).

## Phase pass criteria

A DM can pick a mode at creation and change it any time behind a clear confirm step
whose copy is correct in both directions; the mode persists across refresh and
navigation; a player or non-member cannot change it (blocked server-side, not just
hidden); a `notetaker` campaign behaves exactly as before apart from the intended
move of admin controls into Settings; and the relocated rename / export-import /
owner-only delete still work.
