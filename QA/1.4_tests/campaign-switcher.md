# QA — Campaign switcher

**Phase:** 1.4. Verifies the switcher and the "same account, different role per
campaign" acceptance criterion.

**Prerequisites:** one account (**Account A**) that is a member of **two**
campaigns with **different roles** — DM in "Campaign One" (A created it), player
in "Campaign Two" (created by Account B, joined via invite code). A second
account (B) is only needed to set up Campaign Two.

## Steps

- [X] Sign in as **Account A**. On the dashboard both campaigns appear with the
      correct badge (Campaign One = DM, Campaign Two = Player).
- [X] Open **Campaign One**. Badge = "You are the DM"; DM tab set shows; a
      **"Switch to"** dropdown appears in the header (present because A has >1
      campaign).
- [X] Select **Campaign Two** from the dropdown → URL changes to that campaign,
      badge flips to **"You are a player"**, and the tab set changes to the
      **player** tabs. No page reload/flash of the wrong tabs.
- [X] The active tab resets to **Overview** after switching (you are not left on
      a tab that doesn't exist for the new role).
- [X] Switch back to **Campaign One** → DM tabs and DM badge return.
- [X] Sign in as an account that belongs to **only one** campaign → the
      "Switch to" dropdown is **not** shown.

## Pass criteria

The same account shows the correct role, badge, and tab set in each campaign;
the switcher navigates between them, resets to Overview, and is hidden when the
user has a single campaign.

> Role + switcher options both come from a single `listMyCampaigns` read in
> [`../../src/features/campaigns/CampaignPage.tsx`](../../src/features/campaigns/CampaignPage.tsx).
