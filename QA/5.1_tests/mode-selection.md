# Manual checklist — Mode selection & switching (Phase 5.1)

**Phase:** 5.1 — Mode data model & switching
**Run by:** the user, in the browser on :5173. Claude cannot drive or observe this.

## Prerequisites

- Dev server on :5173 against `fnykpoattheldxtkrozd`.
- Signed in as DM `ejcaldwell06`; a second browser/profile signed in as player
  `ejcaldwell.test` for step 9.
- Campaign **"Main Test"** (currently `notetaker`).
- Reference copy — the three options, in this order, in both pickers:
  | Label | Description |
  |---|---|
  | Note taker | Character sheets, journals and DM tools. No map or combat tracker. |
  | Playspace | Everything in Note taker, plus a shared battlemap with tokens. |
  | Full RPG | Everything in Playspace, plus round-based combat on the map. |

## Steps

### Create-campaign picker (Dashboard)

- [ ] 1. Dashboard → start creating a campaign. The form shows **"How will this
      campaign play?"** with the three options above, in that order, **Note taker
      preselected**.
- [ ] 2. Create a campaign with **Full RPG** selected. It opens, and its Settings
      tab shows Full RPG as the saved mode.
- [ ] 3. Back on the dashboard, start another create. The picker has **reset to
      Note taker** (it does not remember the last choice). Cancel or create as
      Note taker.

### Switching from Settings

- [ ] 4. Open "Main Test" → **Settings** tab → **Game mode**. The label reads
      "This campaign plays as" and **Note taker** is selected with the accent
      border.
- [ ] 5. Pick **Full RPG**. A confirm step appears **before anything saves**, with
      *up* copy: "Switching up to Full RPG **unlocks the extra features** for
      everyone in this campaign", plus buttons "Switch to Full RPG" and "Cancel".
- [ ] 6. Click **Cancel** → the confirm disappears and the selection returns to
      **Note taker** (nothing was saved).
- [ ] 7. Pick **Full RPG** again → **Switch to Full RPG**. It saves; the confirm
      clears; Full RPG is now the selected mode. Go to **Overview** — the read-only
      line reads "This campaign plays as **Full RPG**. Change it in the Settings
      tab."
- [ ] 8. Now pick **Note taker** (a switch *down*). The confirm copy branches:
      "Switching down to Note taker **only hides the richer features — nothing is
      deleted.** Any maps, tokens and combat you've set up are kept and come back
      if you switch up again." Confirm it.
- [ ] 9. While on Full RPG (switch back up first), re-pick **Full RPG** — the mode
      already in effect. Expect **no confirm step at all** (a no-op is not worth
      confirming); if one was pending it just clears.

### Persistence & player view

- [ ] 10. Set the campaign to **Playspace**, then hard-refresh (Cmd-Shift-R). The
      Settings picker still shows Playspace, and the dashboard list for that
      campaign is consistent with it. Navigate to another tab and back — still
      Playspace.
- [ ] 11. As the **player** (`ejcaldwell.test`), open the same campaign. There is
      **no Settings tab**, and Overview's mode line reads "This campaign plays as
      **Playspace**. **Only the DM can change it.**" — read-only text, no picker,
      no buttons.
- [ ] 12. **Nothing else changed.** With the campaign back on **Note taker**, click
      through the DM tabs (Party, Encounters, NPCs, Combat, Quests, Session log,
      Handouts, Secret notes, Scheduling) and, as the player, the character tabs.
      Everything looks and behaves as it did before 5.1 — no chrome change, no
      missing tab, no console errors. (Chrome branching is 5.2; a Playspace/RPG
      campaign also still shows today's tab bar, which is expected.)

## Pass criteria

The create form defaults to Note taker and resets after each create; the Settings
picker never saves without a confirm; the confirm copy is correct in both
directions and absent for a no-op re-pick; the saved mode survives refresh and
navigation and reaches Overview immediately without a reload; players see a
read-only line and no Settings tab; and a Note taker campaign is otherwise
indistinguishable from before this subphase.

## Run log

**2026-08-07 — PASS.** Campaign "Main Test"
`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa` (starting mode `notetaker`, confirmed
server-side before the run — all 7 campaigns in the project read `notetaker`).
Run by the user in the browser on :5173; DM `ejcaldwell06` / player
`ejcaldwell.test` in separate profiles.

- Steps 1–12 — all reported good by the user: the create picker defaults to Note
  taker and resets between creates; the Settings picker never saves without a
  confirm; the confirm copy is correct *up* and *down* and is absent for a no-op
  re-pick; Cancel reverts the selection with nothing saved; the mode survives a
  hard refresh and navigation and reaches Overview without a reload; the player
  sees the read-only "Only the DM can change it" line and no Settings tab; and a
  Note taker campaign is otherwise indistinguishable from before 5.1, with no
  console errors.
- No bugs found in this area.
