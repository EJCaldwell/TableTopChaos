# Manual checklist — DM Settings tab (Phase 5.1.2b / 5.1.2c)

**Phase:** 5.1 — Mode data model & switching (Settings split + co-DM cleanup)
**Run by:** the user, in the browser on :5173.

Campaign administration moved out of Overview into a new DM-only **Settings** tab.
This is a *relocation*, so the point of this checklist is mostly **regression**: the
moved features must behave exactly as they did before.

## Prerequisites

- DM/owner `ejcaldwell06` and player `ejcaldwell.test` signed in (separate
  browsers/profiles).
- Campaign **"Main Test"**. Have a throwaway campaign available for the delete step
  — do **not** delete "Main Test".

## Steps

### Tab placement & gating

- [ ] 1. As DM, the tab bar ends its DM group with **Settings** — after Secret
      notes, before the shared/player tabs. Blurb-wise it is the last thing a DM
      reaches for, which is intended (it holds the danger zone).
- [ ] 2. As the **player**, there is **no Settings tab** anywhere in the bar.
- [ ] 3. Settings shows four blocks in order: **Campaign name**, **Game mode**,
      **Backup & data**, **Danger zone** (danger zone only for the owner).

### Overview is correctly reduced

- [ ] 4. Overview now shows **only** the people side: the roster, DM invite codes,
      and the one-line read-only mode text. No rename control, no export/import, no
      delete button anywhere on Overview.
- [ ] 5. The roster still renders correctly for both roles and the DM still sees
      exactly one DM (themselves) — 5.1.2c's invariant is one DM per campaign, its
      owner.

### Regression on the moved features

- [ ] 6. **Rename** — Settings → Campaign name → Rename, change it, save. The
      header/title updates **immediately without a refresh**, and the dashboard
      shows the new name. Refresh: it persisted.
- [ ] 7. **Rename validation** — try saving a blank name → an inline error
      ("Campaign name cannot be empty"), nothing saved. Try Rename → Cancel → the
      draft is discarded and the original name is intact.
- [ ] 8. **Backup & data** — export the campaign; the ZIP downloads as before.
      The block is **export only**: there is no file picker and no "Import a
      campaign" heading here. Import still lives on the **dashboard**, and
      importing a ZIP there still creates a new campaign with its content.
      (Phase 4.2 behavior otherwise unchanged — you are confirming the move
      didn't break it.)
- [ ] 9. **Journal export** still works from wherever it lives for the player —
      unaffected by this move, quick sanity check only.
- [ ] 10. **Danger zone (owner only)** — on a **throwaway** campaign: "Delete
      campaign" shows a confirm reading *Yes, delete "<name>"*; Cancel backs out
      with nothing deleted; confirming deletes it and returns you to the dashboard,
      where it is gone. Refresh to confirm it stays gone.

### Invite codes (5.1.2c)

- [ ] 11. Overview → create an invite code. It is created as a **player** code —
      there is no role choice in the UI at all (the DM-code path was removed).
      Redeem it with a spare account and confirm the new member joins as a player.

## Pass criteria

Settings is DM-only and last in the DM group; Overview holds only roster + invite
codes + the read-only mode line; rename, export/import and the owner-only delete
all behave exactly as they did before the split, including their validation and
confirm steps; and invite codes can only ever mint players.

## Run log

**2026-08-07 — PASS.** Campaign "Main Test"
`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`, plus a throwaway campaign for step 10.
Run by the user in the browser on :5173; DM `ejcaldwell06` / player
`ejcaldwell.test` in separate profiles.

- Steps 1–11 — all reported good by the user: Settings is last in the DM group and
  absent for the player; the four blocks render in order; Overview is reduced to
  roster + invite codes + read-only mode line; rename (incl. blank-name validation
  and Cancel-discards-draft) updates without a refresh and persists; export/import
  worked; journal export unaffected; owner-only delete confirmed, cancelled and
  deleted correctly and stayed gone across a refresh; invite codes offer no role
  choice and mint players only.

> **Follow-up (2026-08-07) — import removed from the Settings tab.** The user asked
> for the import half of **Backup & data** to be dropped. Offering "import" inside a
> specific campaign's settings implied it would overwrite *that* campaign, when in
> fact `importCampaign` always creates a brand-new one. No capability lost: the
> dashboard already owns the import flow
> ([DashboardPage.tsx](../../src/features/campaigns/DashboardPage.tsx)), which is
> where a "create a campaign from a backup" action belongs.
> `CampaignDataPanel` is now export-only (file input, pending-file confirm step and
> post-import summary all removed); `importCampaign` / `ImportResult` stay in
> `exportImport/api.ts` for the dashboard caller. `npm run build` clean afterward
> (bundle 652.99 kB → 650.63 kB). Step 8 above was updated to assert the absence of
> the import controls here — **re-verify that single step on the next browser
> pass.**
