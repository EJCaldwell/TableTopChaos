-- ============================================================================
-- 91_reapply_deletions.sql — re-apply erasures after a database restore.
--
-- Run by railway/migrate/migrate.sh on EVERY deploy, immediately after the grant
-- sweep. Normally it matches nothing and does nothing.
--
-- WHY IT RUNS UNCONDITIONALLY. Backups include auth.users (see
-- railway/backup/backup.sh), so restoring one taken before a deletion brings the
-- person back — password hash included — and silently undoes a right-to-erasure
-- request. A documented post-restore checklist would work right up until the one
-- restore that happens at 3am during an incident, which is exactly when a step
-- gets skipped. Making it part of the standard deploy path means the erasure is
-- re-applied by the next thing anyone does, without anyone having to remember.
--
-- SAFE TO RUN ALWAYS:
--   * Idempotent — user_id is the primary key of public.deleted_accounts, and
--     deleting an already-absent user is a no-op.
--   * Cannot touch a live account. It only ever names ids that were previously
--     erased through the delete-account Edge Function.
--   * Cannot affect someone who signs up again with the same email: a new signup
--     gets a NEW auth.users id, and this matches on id, not address. That is the
--     deliberate reason it does not match on email_sha256 — doing so would ban a
--     person from ever returning, which erasure does not mean.
--
-- WHAT IT DOES NOT RESTORE-PROOF, and cannot:
--   * Storage FILES were deleted at erasure time and are not in a pg_dump, so
--     restored storage.objects rows point at nothing. Those rows are COUNTED and
--     reported here, never deleted — removing the row strands the file (see the
--     note further down). Actual cleanup belongs to the Storage API.
--   * Stripe subscriptions were cancelled at Stripe and will not come back. A
--     restored campaign_subscriptions row can therefore claim `active` while
--     Stripe says `canceled`. Deleting the campaign (which the cascade below
--     does) resolves it for erased users; for everyone else it needs a manual
--     reconcile, which is why DEPLOY.md §10 exists.
-- ============================================================================

do $$
declare
  n_users int := 0;
  n_orphan_objects int := 0;
begin
  -- Nothing to do before 0032 has been applied (e.g. mid-baseline on a fresh
  -- database). Checked rather than assumed so the sweep never fails a deploy.
  if to_regclass('public.deleted_accounts') is null then
    raise notice 'reapply_deletions: deleted_accounts table absent — skipping';
    return;
  end if;

  -- Re-delete any resurrected account. The FK cascade from auth.users does the
  -- rest: campaigns they DMed (with all content, for every member), their
  -- characters in other people's campaigns, memberships, invites, RSVPs, profile.
  with resurrected as (
    delete from auth.users u
    where exists (
      select 1 from public.deleted_accounts d where d.user_id = u.id
    )
    returning u.id
  )
  select count(*) into n_users from resurrected;

  if n_users > 0 then
    raise warning 'reapply_deletions: RE-DELETED % account(s) that a restore had '
                  'resurrected. This is expected after restoring a backup taken '
                  'before those deletions; investigate if no restore happened.',
                  n_users;
  else
    raise notice 'reapply_deletions: no resurrected accounts (expected)';
  end if;

  -- Storage rows whose owning campaign no longer exists. REPORTED, NOT DELETED.
  --
  -- An earlier version of this script deleted them, which was wrong twice over
  -- (it removed 46 pre-existing orphans on 2026-08-21 before being corrected):
  --
  --   1. **Deleting a storage.objects row does not delete the file.** That table
  --      is storage-api's INDEX; the bytes live in the backing store. Removing
  --      the row makes the file unreachable through the API — it can no longer
  --      be listed or deleted — so it converts recoverable garbage into stranded
  --      garbage that only filesystem access can reclaim. Deletion must go
  --      through the Storage API (DELETE /object/…), which removes both, and
  --      that is the deferred daily storage-cleanup cron in PRE_LAUNCH §1.
  --   2. It was broader than this file's own stated purpose. A missing campaign
  --      is not evidence of an erasure — campaigns get deleted directly all the
  --      time — so this swept up orphans unrelated to any account deletion.
  --
  -- Counting is still worth doing: it is the only signal that a restore left
  -- rows pointing at files that no dump contained, and it feeds the cleanup cron.
  --
  -- Storage paths are '<campaign_id>/<asset_id>/<file>' (see upload-media).
  select count(*) into n_orphan_objects
  from storage.objects o
  where o.bucket_id = 'media'
    and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (
      select 1 from public.campaigns c
      where c.id = split_part(o.name, '/', 1)::uuid
    );

  if n_orphan_objects > 0 then
    raise notice 'reapply_deletions: % storage row(s) belong to a campaign that no '
                 'longer exists. NOT deleted here — removing the row would strand '
                 'the file. Sweep them via the Storage API (PRE_LAUNCH §1 cleanup '
                 'cron).', n_orphan_objects;
  end if;
end $$;

-- Verification: any row here is an account that should be gone but is not.
-- Expected output: no rows. migrate.sh fails the deploy on output.
select d.user_id as resurrected_account_still_present
from public.deleted_accounts d
join auth.users u on u.id = d.user_id;
