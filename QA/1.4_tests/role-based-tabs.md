# QA — Role-based tabs

**Phase:** 1.4. Core acceptance area: the tab bar is filtered by the caller's
role, and a player never sees DM-only tabs.

**Prerequisites:** two accounts (A, B); Account A creates a campaign (becomes
DM) and mints a player invite code; Account B redeems it (becomes player). Both
open the same campaign at `/campaigns/:id`.

## Expected tab sets

Shared tabs (everyone): **Overview, Dice, Party loot, Scheduling**.

- **DM** also sees: **Party, Encounters, NPCs, Combat, Quests, Session log,
  Handouts, Secret notes** (12 tabs total).
- **Player** also sees: **My character, Inventory, Spells & abilities,
  Backstory, HP & conditions, Journal, Shared with us** (11 tabs total). No
  Party/Encounters/NPCs/Combat/Quests/Session log/Handouts/Secret notes.

## Steps

- [X] As **Account A (DM)**, open the campaign. Badge reads **"You are the DM"**
      (accent-colored).
- [X] Confirm all 8 DM tabs above are present and **none** of the player-only
      tabs (My character, Inventory, …) appear.
- [X] Click each non-Overview DM tab → a "Coming soon" placeholder with the
      tab's title + blurb renders; Overview shows roster + invite codes.
- [X] As **Account B (player)**, open the same campaign. Badge reads **"You are
      a player"** (muted).
- [X] Confirm the 7 player-only tabs are present and **no** DM-only tab appears.
      In particular **Secret notes** and **Party** are absent.
- [X] Click Overview as the player → roster is visible, but **no** invite-code
      section and **no** danger zone.
- [X] Reload the page on any non-Overview tab → the page still lands cleanly
      (defaults back to Overview after reload; no crash/blank).

## Pass criteria

Each role sees exactly its expected tab set, the DM/player badge matches, and a
player has no DM-only tab in the DOM at all (not merely hidden). Overview's
DM-only sections (invite codes, delete) are absent for the player.

> The underlying gate is `tabsForRole(isDm)` in
> [`../../src/features/campaigns/tabs.ts`](../../src/features/campaigns/tabs.ts);
> RLS independently blocks a player from reading DM data even if a tab were
> forced open.
