# QA — Campaign rename (DM-only)

Ad-hoc feature added during Phase 4 work (not a numbered phase): the DM can
rename a campaign from the **Overview** tab. Reuses the existing
`campaigns_update_dm` RLS policy (no migration).

## What it covers

- API `renameCampaign(id, name)` → `campaigns.update({name})` (RLS: DM only).
- Overview shows the campaign name as a heading with a **Rename campaign** button
  (DM only); inline edit → Save (Enter) / Cancel (Esc); empty names rejected.
- `onRenamed` callback updates the workspace header immediately; dashboard list
  reflects it on next load.

## Run log

**2026-07-29 — PASS.** Campaign `d0e1fc8f…`.

- DM: Rename campaign → edit → Save updates the header + Overview title
  immediately and persists on refresh.
- Empty name → rejected with a message (no write).
- Player: no Rename button. Data layer — player
  `campaigns.update({name}).eq(id,…).select()` → `Array(0)` (RLS blocked;
  `campaigns_update_dm` is DM-only). **All pass.**
