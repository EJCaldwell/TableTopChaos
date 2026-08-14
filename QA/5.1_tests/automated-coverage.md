# Automated coverage — Phase 5.1

There is no test runner in this project yet (Phase 8). "Automated" here means the
TypeScript build plus the Supabase advisors.

## Commands

| Command | What it proves |
|---------|----------------|
| `npm run build` (`tsc -b` + `vite build`) | Whole app type-checks and bundles. `noUnusedLocals` / `noUnusedParameters` are on, so dead props left behind by the Overview → Settings split fail the build. |
| `get_advisors` (security + performance) | Migration 0028 / 0029 introduced no new RLS or index warnings. |

## What the build actually catches for 5.1

- `GameMode` is derived from the generated `Database['public']['Enums']['game_mode']`
  ([database.types.ts](../../src/lib/database.types.ts)), so a mode string that is
  not in the enum is a compile error at every call site — `createCampaign`,
  `setGameMode`, `ModePicker`, `gameModeRank`.
- `campaigns.game_mode` is non-nullable in the generated Row type, so
  `campaign.game_mode` can be read without a null guard and any code that forgets to
  pass it on insert still compiles only because the DB default covers it.
- The Overview → Settings relocation: `OverviewPanel` dropped `isOwner` /
  `onRenamed` / `onModeChanged`, and `CampaignPage` now passes them to
  `SettingsPanel`. A missed or stale prop is a type error, so "the wiring is
  correct" needs no manual step.
- `createInviteCode` losing its `role` parameter (5.1.2c) — any surviving caller
  that still passes a role fails to compile.

## Source under test

- [supabase/migrations/0028_game_mode.sql](../../supabase/migrations/0028_game_mode.sql)
- [supabase/migrations/0029_single_dm_comments.sql](../../supabase/migrations/0029_single_dm_comments.sql) (comments only)
- [src/features/campaigns/api.ts](../../src/features/campaigns/api.ts) — `GameMode`, `GAME_MODES`, `gameModeRank`, `setGameMode`, `createCampaign(gameMode)`
- [src/features/campaigns/ModePicker.tsx](../../src/features/campaigns/ModePicker.tsx)
- [src/features/campaigns/SettingsPanel.tsx](../../src/features/campaigns/SettingsPanel.tsx)
- [src/features/campaigns/OverviewPanel.tsx](../../src/features/campaigns/OverviewPanel.tsx)
- [src/features/campaigns/DashboardPage.tsx](../../src/features/campaigns/DashboardPage.tsx)
- [src/features/campaigns/CampaignPage.tsx](../../src/features/campaigns/CampaignPage.tsx)
- [src/features/campaigns/tabs.ts](../../src/features/campaigns/tabs.ts)

## Not covered automatically

Everything behavioral: which mode the create form defaults to, the confirm-step
copy, persistence across refresh, tab visibility per role, and that the moved
rename / export / delete still work. Those live in the manual checklists.

## Run log

**2026-07-31 — PASS.**
- `npm run build` → clean, 142 modules, `built in 1.27s`, no type errors.
- `get_advisors` (security) → 9 lints, **all pre-existing and unrelated to 5.1**:
  `trial_redemptions` RLS-enabled-no-policy (by design — locked table),
  6 × SECURITY DEFINER-executable notices for `campaign_entitlements`,
  `report_media`, `set_media_status`, `redeem_invite_code` (all by design, Phase
  1.5/1.6), and leaked-password-protection disabled (auth setting). Nothing new
  from 0028 or 0029.

**2026-08-07 — PASS.** Re-run at the start of the browser QA pass and again after
the import-removal follow-up.
- `npm run build` → clean both times; 142 modules, `built in 1.23s` / `1.34s`.
  Bundle 652.99 kB → **650.63 kB** after `CampaignDataPanel` lost its import half.
- No migration ran, so no advisor re-check was needed.
- Note the build did *not* catch anything for the removal on its own:
  `importCampaign` / `ImportResult` are still live exports used by
  [DashboardPage](../../src/features/campaigns/DashboardPage.tsx), so nothing went
  unused. That the dashboard import path still works is a manual step
  ([settings-tab.md](settings-tab.md) step 8).
