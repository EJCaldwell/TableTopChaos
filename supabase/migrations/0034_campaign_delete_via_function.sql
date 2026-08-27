-- ============================================================================
-- 0034_campaign_delete_via_function.sql — force campaign deletion through the
-- delete-campaign Edge Function.
--
-- THE BUG. `campaigns_delete_owner` (0003) let the owning DM delete a campaign
-- straight from the browser. The FK cascade tidied the database, but **nothing
-- told Stripe**, so the subscription kept charging the card indefinitely while
-- the customer had nothing to show for it — and since campaign_subscriptions
-- cascaded away too, there was no in-app trace at all. The cascade also left the
-- campaign's Storage FILES behind: it removes media_assets ROWS, not objects.
-- Every one of the 46 orphans found in Phase 6 arrived this way.
--
-- Cancelling Stripe requires a secret key, so it can only happen server-side.
-- Leaving the policy in place while routing the UI through an Edge Function
-- would fix the app and leave the bug reachable by anyone calling PostgREST
-- directly — so the policy goes. **Deletion is now possible only via
-- delete-campaign**, which cancels Stripe, removes the files, and only then
-- deletes the row.
--
-- The authorization rule is unchanged: the function re-checks `owner_id` against
-- the caller's JWT server-side. The check moved, it did not weaken.
--
-- Unaffected, because both use the service role (which bypasses RLS):
--   * delete-account — already cancels Stripe before deleting a user's campaigns
--   * import-campaign — rolls back a half-imported campaign that has no
--     subscription and no uploads yet
-- ============================================================================
drop policy if exists "campaigns_delete_owner" on public.campaigns;

comment on table public.campaigns is
  'Campaigns. NOTE: there is deliberately NO client DELETE policy — see 0034. '
  'Deleting a campaign must go through the delete-campaign Edge Function so the '
  'Stripe subscription is cancelled and Storage files are removed first. A '
  'direct delete would leave the customer being billed for a campaign that no '
  'longer exists.';
