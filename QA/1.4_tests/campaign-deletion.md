# QA — Campaign deletion

**Phase:** 1.4 (delivered alongside the shell). Verifies owner-only campaign
deletion and that the delete truly cascades in the database.

**Prerequisites:** a throwaway campaign owned by **Account A** with at least one
other member (**Account B**, joined via code) and at least one invite code
minted. Optional: Supabase SQL access to confirm the cascade.

## Steps

- [X] As **Account B (player)**, open the campaign → Overview shows **no** danger
      zone / delete control.
- [X] As **Account A (owner/DM)**, open the campaign → Overview shows a
      **Danger zone** with a **Delete campaign** button.
- [X] Click **Delete campaign** → an inline confirmation appears
      (`Yes, delete "<name>"` + Cancel). Click **Cancel** → nothing is deleted;
      controls return to the single button.
- [X] Click **Delete campaign** again, then **Yes, delete "<name>"** → you are
      redirected to the dashboard and the campaign is **gone** from A's list.
- [X] Sign in as **Account B** → the deleted campaign is **gone** from B's
      dashboard too (on next load).
- [X] *(Optional DB check)* In Supabase, confirm no rows remain for that
      campaign id in `campaigns`, `campaign_members`, or `invite_codes`:
      ```sql
      select
        (select count(*) from campaigns where id = '<id>')        as campaigns,
        (select count(*) from campaign_members where campaign_id = '<id>') as members,
        (select count(*) from invite_codes where campaign_id = '<id>')     as codes;
      ```
      All three counts should be **0**.

## Pass criteria

Only the owner sees the delete control; deletion requires explicit confirmation,
redirects to the dashboard, removes the campaign for every member, and leaves no
orphaned `campaign_members` or `invite_codes` rows (cascade verified).

> Authorized by the `campaigns_delete_owner` RLS policy
> (`owner_id = auth.uid()`); dependent rows are removed by `ON DELETE CASCADE`
> FKs, so no application-side cleanup is needed. Helper:
> `deleteCampaign` in
> [`../../src/features/campaigns/api.ts`](../../src/features/campaigns/api.ts).
