# QA — Phase 4.4: Realtime sync (no-refresh live updates)

Verifies that DM and player screens reflect each other's changes live via
Supabase Realtime (migration 0027 + `useRealtimeRefresh`), with RLS still gating
which events each client receives.

**Prerequisites:** TWO concurrent sessions side by side — DM `ejcaldwell06` and
player `ejcaldwell.test` — both in campaign "Test 1"
(`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`). Use two browsers or a normal + private
window so the sessions don't share auth. No page refreshes during these steps.

## Steps — live propagation (change on one screen appears on the other)

- [x] **HP → Party:** DM on the **Party** tab with the player's character open.
      Player on **HP & conditions** toggles a condition / changes current HP →
      the DM's Party HP block updates within ~1–2s, no refresh.
- [x] **Handouts → Shared with us:** DM shares a note on **Handouts**; the
      player's **Shared with us** tab shows it live. DM un-shares → it disappears
      for the player live.
- [x] **Scheduling (both directions):** DM proposes a session → it appears on the
      player's **Scheduling** live. Player RSVPs Yes → the DM sees the tally +
      name update live (and vice-versa).
- [x] **Initiative (two DM contexts):** open Combat in two DM tabs; add/edit a
      combatant in one → the other reflects it live.

## Steps — isolation (RLS still applies to Realtime)

- [x] A **signed-out / non-member** tab open on the app receives **no** events
      and shows nothing new when the DM changes shared items / schedule.
- [x] While the player is on a DM-only surface they can't read, no DM-only change
      leaks (players have no Handouts/Combat tabs anyway).

## Steps — teardown (no leaks)

- [x] Switch away from a realtime tab (e.g. Scheduling → Overview) and back a few
      times; updates keep working and there's no duplicate/stacked refreshing
      (channels are torn down on unmount). Optional: DevTools → Network → WS
      shows channels closing when you leave a tab.

## Pass criteria

Changes on one session appear on the other within ~1–2s without a refresh, in
both directions where applicable; non-members/anon receive nothing; and leaving/
returning to a tab doesn't leak or duplicate subscriptions.

## Run log

**2026-07-29 — PASS.** Two concurrent sessions (DM `ejcaldwell06` + player
`ejcaldwell.test`), campaign "Test 1".

- HP → Party: player HP/condition change patched the DM's open Party HP block in
  place (~1–2s), no full-sheet reload.
- Handouts → Shared with us: share added just that card live; un-share removed
  just that card.
- Scheduling: DM-proposed session appeared live for the player; player RSVP
  updated the DM's tally cell + name without the list flashing.
- Initiative: editing a combatant in one DM tab merged that row in the other.
- Isolation: signed-out tab received no events.
- Teardown: switching tabs and back kept updates working with no duplicate
  refreshing (channels removed on unmount).

Implemented as **row-level merges** (useRealtimeSync + mergeById / per-row
handlers), not full re-fetches — only the changed row/field re-renders. **All
pass.**
