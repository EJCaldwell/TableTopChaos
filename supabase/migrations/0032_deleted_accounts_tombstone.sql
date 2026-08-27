-- ============================================================================
-- 0032_deleted_accounts_tombstone.sql — remember THAT an account was deleted,
-- so a database restore cannot silently resurrect it.
--
-- THE PROBLEM THIS SOLVES. Backups are a `pg_dump` of the whole database,
-- `auth.users` included (see railway/backup/backup.sh — that is deliberate; a
-- backup that restores campaigns but not the users who own them is useless).
-- So restoring a backup taken before a deletion brings the person back:
--
--   * their auth.users row returns WITH the bcrypt password hash, so they can
--     sign in again;
--   * their campaigns, memberships, characters and journals return;
--   * storage.objects ROWS return, but the FILES do not — pg_dump never held
--     them — so media is broken rather than absent;
--   * the Stripe subscription stays cancelled, so campaign_subscriptions now
--     disagrees with Stripe. Harmless while private.billing_config.enforce_active
--     is false; after that flip a restored campaign would get full access with no
--     subscription behind it.
--
-- The compliance half is worse than the technical half: someone exercised a
-- right to erasure and a restore quietly undoes it. Because 7.1 deletion is
-- immediate and hard by design, NOTHING recorded that the deletion happened —
-- leaving no way to know, after a restore, whose data should not be there.
--
-- WHY A TOMBSTONE IN THE SAME DATABASE. It gets captured by every subsequent
-- backup, so it travels with the thing it describes: restore a backup and the
-- tombstone comes back too, listing exactly which accounts to re-delete. A list
-- kept anywhere else would have to be restored separately, by someone who
-- remembered it existed.
--
-- Re-application is automated, not documented-and-forgotten:
-- railway/scripts/91_reapply_deletions.sql runs on EVERY `migrate` deploy and
-- deletes any auth.users row named here. It is idempotent — normally it matches
-- nothing — so the protection costs nothing until the day it matters.
--
-- RETENTION NOTE for 7.2's privacy policy: backups keep 14 daily copies
-- (BACKUP_KEEP=14), so a deletion propagates to backups by expiry within 14
-- days. That is the honest statement to publish; this table is what makes it
-- true even if a restore happens inside that window.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- public.deleted_accounts — one row per erased account. Append-only in practice.
--
-- In `public` rather than `private` because the delete-account Edge Function
-- reaches the database through PostgREST, which only exposes `public`. Secured
-- the same way trial_redemptions is: **RLS enabled with NO policies at all**, so
-- every client role is denied outright, while the service role bypasses RLS and
-- can write. (The grant sweep grants table privileges to authenticated here as
-- it does everywhere; with no policy to permit a row, those privileges select
-- nothing. A grant is permission to be *evaluated by a policy*, not permission
-- to read.)
--
-- CRITICAL: user_id has NO foreign key to auth.users. An FK with ON DELETE
-- CASCADE — the convention everywhere else in this schema — would delete the
-- tombstone at the same instant as the user, which is precisely the moment it
-- needs to start existing. This is the one place where the absence of an FK is
-- the design rather than an oversight.
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_accounts (
  -- The erased auth.users id. Primary key so re-deleting is naturally idempotent.
  user_id      uuid primary key,

  -- SHA-256 of the lowercased email, so a support question ("was this account
  -- deleted?") can be answered without keeping a list of real addresses.
  --
  -- Honestly: this is pseudonymisation, not anonymisation. Email addresses have
  -- low entropy and a plain hash is dictionary-attackable, so treat this as
  -- personal data with a fig leaf, not as anonymous. It is retained on the same
  -- footing as trial_redemptions — a record kept to satisfy an obligation — and
  -- 7.2 must disclose it.
  email_sha256 text,

  deleted_at   timestamptz not null default now(),

  -- What the deletion acted on, for answering "did erasure actually complete?"
  -- long after the rows are gone and cannot be counted.
  campaigns_deleted     integer,
  media_files_deleted   integer,
  subscriptions_canceled integer
);

comment on table public.deleted_accounts is
  'Phase 7.1/0032: tombstones for erased accounts, so a database restore cannot '
  'silently resurrect someone who exercised their right to erasure. Deliberately '
  'has NO foreign key to auth.users — a cascade would delete the tombstone at '
  'the exact moment it must begin to exist. Re-applied automatically by '
  'railway/scripts/91_reapply_deletions.sql on every migrate deploy.';

comment on column public.deleted_accounts.email_sha256 is
  'SHA-256 of the lowercased email. Pseudonymised, NOT anonymous — email entropy '
  'is low enough to brute-force. Treat as personal data; disclose in 7.2.';

-- RLS on with NO policies: denies every client role. Only the service role
-- (which bypasses RLS) can read or write, i.e. only the Edge Function and the
-- migrate job. Same pattern as trial_redemptions, and it will show up in
-- get_advisors as "RLS enabled, no policy" — which is correct and intended, not
-- an oversight to fix.
alter table public.deleted_accounts enable row level security;

-- Index for the support lookup ("was this address deleted?"). The primary key
-- already covers the re-application path.
create index if not exists deleted_accounts_email_sha256_idx
  on public.deleted_accounts (email_sha256);
