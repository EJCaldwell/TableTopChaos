# QA — Data migration

**Phase:** 6.2. Server-side; mine to run.

**Prerequisites**
- 6.1 passed (schema replayed on the target from the 27 migrations).
- Hosted project **unpaused** — it is on the free plan and pauses after 7 days idle.
- Baselines captured from the source *immediately before* the dump, not from this
  document: counts move as you use the app.

---

## Steps

- [ ] **Capture source baselines** — per-table row counts across `public`, plus
      `auth.users` (5), `storage.objects` (106), and
      `private.campaign_storage_used()` per campaign. Paste them into the run log;
      they are the only thing every later assertion is measured against.
- [ ] **Dump data only**, no roles/ownership (the target has its own):
      `pg_dump --data-only --no-owner --no-privileges --schema=public --schema=storage`
- [ ] **Restore, then diff per-table counts.** Every table matches. A table that is
      *empty* on the target but populated on the source usually means the restore
      hit an FK ordering problem and the error was swallowed — check for zero-row
      tables explicitly rather than eyeballing totals.
- [ ] **`auth.users` migrated column-by-column with UUIDs preserved exactly.**
      GoTrue owns this table and its schema varies by version, so no bulk copy.
      Expect 5 rows, each with its original `id`.
      **A regenerated UUID silently orphans a user from every campaign** — all
      `auth.uid()` comparisons and `campaign_members` keys depend on it. Verify by
      set difference, not by count:
      ```sql
      -- run against the target with the source ids pasted in; must return 0 rows
      select id from auth.users
       where id not in ( /* source uuids */ );
      ```
- [ ] **Media re-uploaded through the Storage API**, not written onto the volume.
      Direct volume writes skip the `storage.objects` rows that the 0008 RLS policy
      and `private.campaign_storage_used()` both read — the files would exist and be
      invisible *and* unprotected.
- [ ] **Object count is 106** and `private.campaign_storage_used()` matches the
      source value for every campaign (this is what the billing storage cap reads,
      so a mismatch misprices every campaign).
- [ ] **Foreign keys and sequences intact.** No orphaned `campaign_members`,
      `characters`, or `shared_items` rows; sequence values ahead of max ids so the
      next insert does not collide.
- [ ] **Passwords work.** Both sides store bcrypt in `encrypted_password`, so
      existing logins should carry over. Confirm with a real sign-in for at least one
      migrated user. If a hash fails to transfer, that user needs a reset — which
      needs SMTP configured (6.3) first.

## Pass criteria

Every per-table count matches the captured baseline with no unexpectedly-empty
tables, 5 users with original UUIDs (zero rows from the set-difference query), 106
storage objects with matching per-campaign byte totals, FKs and sequences sound, and
at least one migrated user signs in with their existing password.

## Run log

_No runs yet._
