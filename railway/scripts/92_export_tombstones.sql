-- ============================================================================
-- 92_export_tombstones.sql — emit public.deleted_accounts as re-appliable SQL.
--
-- Owns: the ONLY copy of the erasure record that survives a database restore.
--
-- WHY THIS EXISTS — the flaw it closes. The tombstone table (0032) lets the
-- migrate job re-delete accounts a restore has resurrected. But the tombstone
-- lives IN the database, so a backup taken BEFORE a deletion does not contain
-- it:
--
--     T0  nightly backup taken       -> contains the user, NO tombstone
--     T1  user deletes their account -> tombstone written
--     T2  restore the T0 backup      -> user is back, tombstone is GONE
--
-- Restoring a pre-deletion backup is exactly the restore anyone would actually
-- perform, and it reverts the tombstone table along with everything else. The
-- sweep then matches nothing and the erasure is silently undone — the person is
-- back, able to sign in with their old password. The in-database tombstone alone
-- protects only the narrower case where the tombstone itself survived (a
-- post-deletion backup, or a partial restore).
--
-- So the list has to exist OUTSIDE the thing being restored. This script writes
-- it to the backup volume as plain INSERT statements that can be replayed with
-- `psql -f` after a restore.
--
-- ON CONFLICT DO NOTHING: replaying is idempotent, and re-importing an older
-- export can never clobber a newer record.
--
-- Output is deliberately bare SQL (psql -tAX), so the file is directly runnable.
-- ============================================================================
select format(
  'insert into public.deleted_accounts (user_id, email_sha256, deleted_at, campaigns_deleted, media_files_deleted, subscriptions_canceled) values (%L, %L, %L, %s, %s, %s) on conflict (user_id) do nothing;',
  user_id,
  email_sha256,
  deleted_at,
  coalesce(campaigns_deleted::text, 'null'),
  coalesce(media_files_deleted::text, 'null'),
  coalesce(subscriptions_canceled::text, 'null')
)
from public.deleted_accounts
order by deleted_at;
