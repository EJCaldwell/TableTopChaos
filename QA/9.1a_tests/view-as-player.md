# QA — DM "view as player" (Phase 9.1a)

**Manual, in-browser. The user runs these.** The gate and the bundle checks are
done and recorded in
[run-2026-08-28-view-as-player.md](run-2026-08-28-view-as-player.md).

**Prerequisites:** dev server on 5173, signed in as **EJ** (the only allowlisted
account), in a campaign where EJ is the DM. Hard-reload first.

- [ ] **1.** A grey **DEV** bar appears under the header, showing your username,
      the first 8 characters of your user id, and `real role: DM`.
- [ ] **2.** Tick **View as player**. The bar turns red and says you are viewing
      as a player — and that this does **not** prove a player cannot read the
      data.
- [ ] **3.** DM-only tabs disappear (Party, NPCs, Encounters, Quests, Combat,
      Handouts, Secret notes, Session log) and the player-only **Shared with us**
      tab appears.
- [ ] **4.** Open **Settings**. The delete-campaign control is gone — `isOwner`
      follows the override too.
- [ ] **5.** Untick it. Everything comes back.
- [ ] **6.** Tick it again, then navigate to another campaign and back. **The
      mode is off** — it is deliberately not persisted, and not carried between
      campaigns.
- [ ] **7.** Reload the page while it is ticked. **The mode is off.**
- [ ] **8.** Press **Reset layouts**. It reports a count, including zero.
- [ ] **9.** Sign in as **QA** (a different browser profile). **No DEV bar at
      all** — that account is not on the allowlist.

### Character switcher (added 2026-08-28)

Back as **EJ**, DM of a campaign with at least one other member who has made a
character. Leave **View as player** unticked.

- [ ] **10.** The DEV bar has a **Sheet:** dropdown listing `(me)` plus the other
      members. Pick another member. The bar turns red and warns the sheet is
      **read only**. Open **Character**, **Inventory**, **Lore**, **Abilities**,
      **HP** — each shows *their* data, not yours. Switch back to `(me)`; your
      own sheet returns.
- [ ] **11.** While inspecting their sheet, **save an edit**. It **succeeds and
      is permanent** (migration 0052) — reload and confirm it stuck. The other
      member really will see it, so edit something you don't mind changing.
- [ ] **12.** While inspecting, open **Journal**. It is **empty** — a player's
      journal is private even from a dev account (0054). Then change campaign:
      the dropdown is back on `(me)`.

## Pass criteria

All twelve. Steps 6, 7 and 9 carry the most weight on the view-as half: the
first two are the "forgot I was in this mode" failure, the third is the gate.
On the switcher half it is **step 12** — if an inspected journal shows entries,
the exclusion has leaked again and that is a privacy defect, not a UI one.

## Known gaps, stated rather than hidden

- **This does not prove RLS.** It shows what the UI renders, not what the server
  returns. The 8.2 matrix is the evidence for access control; do not mark
  anything off here on its behalf.
- **It cannot replace a second browser for realtime testing.**
- **The character switcher is NOT a rendering trick**, unlike the view-as
  toggle. It reads and writes another member's real data via a real grant
  (0052), so its edits are permanent and visible to them. Treat it as editing
  production data, because it is.
