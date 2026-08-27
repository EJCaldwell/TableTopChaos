# QA 7.1 — Account deletion, data rights & cascade

Covers [PLANNING.md](../../PLANNING.md) subphase 7.1: the GDPR/CCPA right-to-erasure
path, its cascade rules, Stripe cancellation and Storage cleanup.

**Decisions taken before building** (user, 2026-08-21): deletion is **immediate
with a typed hard confirm** — no soft-delete, no grace period, no scheduler — and
a deleted DM's campaigns are **deleted for every member**, matching PLANNING's
"there is no ownership-transfer path".

Immediate deletion is also what keeps a `deleted_at` predicate out of the RLS
policies on all 29 tables. One missed clause there would leak a "deleted" user's
content, which is a worse failure than the one a grace period prevents.

---

## Area A — Design finding: the database already implements the cascade

Verified against the live schema before writing any code. The cascade rules 7.1.1
specifies were **already enforced by foreign keys** from migrations 0001–0003:

| FK | On delete | Effect |
|---|---|---|
| `campaigns.owner_id → auth.users` | CASCADE | campaigns they DM are destroyed, with every FK hanging off them |
| `characters.owner_id → auth.users` | CASCADE | their character in someone else's campaign goes; that campaign survives |
| `campaign_members.user_id`, `invite_codes.created_by`, `schedule_rsvps.user_id`, `profiles.id` | CASCADE | memberships, invites, RSVPs, profile |
| `media_assets.uploaded_by` | **SET NULL** | uploads survive, unattributed |
| `media_reports.reporter_id` | **SET NULL** | reports survive, unattributed |
| `trial_redemptions.campaign_id` | **SET NULL** | anti-abuse record outlives the campaign |

So the real work was only the three things cascade cannot do.

### Consequences worth stating plainly

- **`trial_redemptions` deliberately survives erasure.** The one-trial-per-card
  control has to outlive the account, or deleting your account resets it and the
  control is worthless. This means **a card fingerprint is retained after
  deletion** — 7.2's privacy policy must disclose it as a fraud-prevention
  legitimate interest. Recorded here because it is a compliance obligation
  created by a technical decision, and easy to lose between subphases.
- **`media_assets.uploaded_by` being SET NULL is right for the campaign and
  wrong for the person.** A departing player's uploads — including a character
  portrait that may be a photograph of a real person — would otherwise sit in
  someone else's campaign forever, unattributable and unfindable. The function
  therefore deletes their own uploads **before** the user row, while
  `uploaded_by` still points at them. Order is load-bearing.

---

## Area B — SECURITY FINDING: service-role-only functions were world-callable

Found 2026-08-21 while QAing 7.1, **not reported by any tool**. Two functions
were callable by any ordinary signed-in user:

| Function | Exposure |
|---|---|
| `account_deletion_targets(uuid)` (added in 0030, minutes earlier) | an authenticated **player** could pass **another user's id** and receive that user's Storage paths |
| `campaign_entitlements(uuid)` (**shipped in 0009**) | any signed-in user could read `is_active`, `storage_cap` and `storage_used` for **any campaign**, including ones they are not a member of |

Both migrations end in `revoke all on function … from public` +
`grant execute … to service_role`, and both were documented as service-role only.

### Why the revoke did nothing

Two behaviours compound, and the combination is a trap:

1. **A new FUNCTION is EXECUTABLE BY `PUBLIC` by default** — the exact opposite
   of a new TABLE, which starts with no privileges at all.
2. **`revoke … from public` does not remove a named-role grant.** This stack's
   init sets `alter default privileges … grant execute on functions to anon,
   authenticated, service_role`, so `authenticated` receives its **own** grant at
   creation time, untouched by revoking from PUBLIC.

The pattern therefore restricts nothing while reading as though it does. That is
what made it survive from 0009: the intent was written down, commented, and
wrong. **`get_advisors` never flagged it**, and it is not a table so no RLS audit
would ever have looked.

### Fix (migration 0031), in order of how much it is relied on

1. **Dropped `account_deletion_targets` entirely.** The Edge Function holds the
   service role and can read the two tables directly, so a privileged RPC taking
   a user id bought nothing and cost a leak. Removing a surface beats defending
   one.
2. **Revoked EXECUTE from `anon` and `authenticated` by name** on
   `campaign_entitlements`.
3. **Made it self-healing.** `railway/scripts/90_grant_app_privileges.sql`
   re-applies the revokes on every `migrate` run and `railway/migrate/migrate.sh`
   **fails the deploy** if any service-role-only function is executable by
   `authenticated`. A one-off migration would not hold: default privileges
   re-grant execute on every *new* function, so the guard has to be standing.

**Known limitation of the guard:** it checks a **named list**. A future
service-role-only function that nobody adds to that list is invisible to it. The
list is in the grant sweep with a comment stating the rule — a function that
answers without checking the caller's identity belongs on it; one that reads
`auth.uid()` and describes only the caller does not.

### Verification — PASS

| Probe | Before | After |
|---|---|---|
| `account_deletion_targets` as player, another user's id | **200 + their Storage paths** | **404** (dropped) |
| `campaign_entitlements` as player, non-member campaign | **200 + storage data** | **403** `42501 permission denied` |
| `campaign_entitlements` as service role | 200 | 200 (still works) |
| `account_deletion_preview` as player | — | 200, **their own** campaigns only |
| `account_deletion_preview` as anon | — | **401** permission denied |
| `migrate` function-privilege assertion | — | `check OK` |

---

## Area C — `delete-account` guards, verified without deleting anything

| Probe | Result |
|---|---|
| Wrong confirmation string | **400** "Type your email address exactly to confirm deletion." |
| No `Authorization` header | **401** "Not signed in." |
| `GET` instead of `POST` | **405** |
| State after all probes | `campaigns=8 profiles=5 characters=6` — **unchanged** |

The confirmation is matched against the **email**, not the display name:
`display_name` is nullable and non-unique, so it cannot be a reliable token. It
is re-checked server-side, so the UI's confirm field is a guard against mistakes
rather than a security boundary — a stray or replayed request cannot delete an
account.

### Ordering, which is the whole design

Each step is placed so a failure leaves the least-bad state:

1. Identify the caller from their JWT — never the request body.
2. Require the typed confirmation.
3. Read Stripe subscription ids and Storage paths **while the rows still exist**.
4. Cancel Stripe subscriptions. **If any cancellation fails, abort before
   deleting anything.** A user with no account but a live subscription keeps
   being charged with no way to stop it — strictly worse than a failed deletion
   they can retry (502, "nothing was deleted").
5. Delete their own Storage objects and `media_assets` rows.
6. Delete `auth.users`; the foreign keys cascade.

Steps 5 and 6 are not atomic across systems and cannot be. If 6 fails after 5 the
account survives having lost its uploads — retryable, and better than the reverse
(files orphaned in a bucket with nothing pointing at them: an erasure that
silently did not erase).

`resource_missing` from Stripe is treated as success, so a stale subscription id
cannot block deletion forever.

---

## Area E — Restore protection (migration 0032 + the re-apply sweep) — **PASS**

Added 2026-08-21 after the question *"what would happen if a backup were restored
after someone deleted their account?"* — which has an uncomfortable answer.

### The problem

Backups are a `pg_dump` of the whole database, `auth.users` included (deliberate:
a backup that restores campaigns but not the users who own them is useless). So
restoring a backup taken before a deletion brings the person back:

| | After a restore |
|---|---|
| `auth.users` row **including the bcrypt hash** | returns — **they can sign in again** |
| Profile, campaigns, memberships, characters | return |
| `storage.objects` **rows** | return |
| The actual **files** | do not — never in a `pg_dump` |
| Stripe subscription | stays cancelled |

Three consequences: a **compliance** failure (a right-to-erasure request silently
undone, with nothing recording that it ever happened), **broken media**, and
**database/Stripe divergence** — a restored `campaign_subscriptions` row claiming
`active` while Stripe says `canceled`, which after the `enforce_active` flip would
grant a campaign full access with no subscription behind it.

### The mechanism

`public.deleted_accounts` (migration 0032) — user id, SHA-256 of the lowercased
email, timestamp, and what the deletion acted on. Two details are load-bearing:

- **No foreign key to `auth.users`.** Everything else in this schema cascades
  from that row; an FK here would delete the tombstone at the exact instant it
  must begin to exist. The absence of an FK is the design.
- **RLS enabled with no policies** — the `trial_redemptions` pattern. Denied to
  every client role; only the service role, which bypasses RLS, can write. Will
  appear in `get_advisors` as "RLS enabled, no policy": correct and intended.

It lives in the same database on purpose, so it is captured by every subsequent
backup and travels with the data it describes. A list kept elsewhere would have to
be restored separately by someone who remembered it existed.

`railway/scripts/91_reapply_deletions.sql` runs on **every** migrate deploy and
deletes any `auth.users` row named in the tombstone. Automated rather than
documented deliberately: a post-restore checklist holds right up until the restore
that happens mid-incident, which is exactly when a step is skipped.

It matches on **id, not email hash** — so someone who deletes their account and
later signs up again is unaffected. Matching on email would ban them permanently,
which erasure does not mean.

### Why the tombstone is written late (do not "tidy" this)

It would read better to write the tombstone first and abort before destroying
anything. That would be **actively dangerous**: a tombstone for an account that
still exists causes the sweep to delete that live account at the next deploy. So
it is written as late as possible while still preceding the deletion — after
cancellation and file removal, with the user delete the only step left.

### Verification — both halves, PASS

A guard observed only in its passing state is not a verified guard. Every run
before this reported "no resurrected accounts", which is indistinguishable from
the sweep being broken. So both directions were tested with throwaway fixtures.

**Test A — the write path.**

| Check | Result |
|---|---|
| Deletion through the real Edge Function | 200 |
| Tombstone row created | yes |
| `email_sha256` | `53e548b7…` — **matches** SHA-256 of the lowercased address exactly |
| `campaigns_deleted` | 1 |

**Test B — the sweep's teeth.** A tombstoned user was left alive in `auth.users`
with a campaign, reproducing precisely what a restore creates.

| Check | Result |
|---|---|
| Sweep log | `RE-DELETED 1 account(s) that a restore had resurrected` |
| Resurrected profile | gone |
| Their campaign | gone (cascade) |
| Totals | back to baseline — profiles 5, campaigns 8 |
| Sign-in as the resurrected account | `400 invalid_credentials` |
| Tombstones retained | 2 |

### Two bugs found by this verification

1. **The tombstone write path was dead code in production.** The first deletion
   after 0032 returned `200` and recorded nothing: the functions service had been
   deployed *before* the tombstone code was written and never redeployed. Caught
   only by querying the table — **the `200` proved nothing.** Any claim that this
   mechanism "works" before Test A was false.
2. **The sweep deleted 46 `storage.objects` rows it should not have.** Two errors
   compounded: the SQL matched *any* row whose campaign was missing (broader than
   the file's own stated purpose — a missing campaign is not evidence of an
   erasure), and **deleting a `storage.objects` row does not delete the file** —
   that table is storage-api's index, so removing the row makes the file
   unreachable through the API, converting recoverable garbage into stranded
   garbage. Impact measured, not assumed: all 35 live `media_assets` retained
   their rows and **zero** referenced paths went missing; the 46 were the orphans
   under long-deleted campaign `e3b1cf97…` first identified in 6.2. Not reversed —
   reconstructing index rows for files nothing references would mean inventing
   metadata. The sweep now **counts and reports** instead; real cleanup belongs to
   the Storage API via the deferred cron in PRE_LAUNCH §1.

   *Lesson, and it mirrors the CORS one:* destructive SQL in a sweep that runs on
   every deploy deserves **more** scrutiny than the feature it supports, not less,
   because it executes far more often.

**Test C — the counter fix.** `media_files_deleted` had recorded *assets* while
the API response returned *files* (each asset is two Storage objects). One event,
two units, in a compliance record. Corrected and then exercised rather than
assumed: a fixture with **2 assets = 4 files** produced `mediaFiles: 4` in the
response and `media_files_deleted: 4` in the tombstone — agreeing.

The first attempt at this test reported `0`/`0`, which *looked* like agreement.
It was not: the uploads had silently failed because `/tmp` had been cleared and
`curl -F` errored with status `000` on the missing file. Two zeroes agreeing
proves nothing — the test had to be re-run with real uploads before it meant
anything. Test images now live in the session scratchpad rather than `/tmp`.

### FLAW FOUND AFTER THE FACT: the tombstone did not survive the restore it guards against

Raised by the user 2026-08-21, and it invalidated the claim above that restores
were covered. **The tombstone lives IN the database.** A backup taken *before* a
deletion therefore does not contain it:

```
T0  nightly backup taken        -> contains the user, NO tombstone
T1  user deletes their account  -> tombstone written
T2  restore the T0 backup       -> user is back, tombstone is GONE
```

Restoring a pre-deletion backup is *exactly* the restore anyone would perform.
The sweep then matched nothing and the erasure was silently undone — the person
back, signing in with their old password.

**Test B did not catch this**, and it is worth being precise about why: it
inserted a tombstone manually and left the user alive, i.e. "tombstone survived,
user resurrected". That is a genuine scenario (a post-deletion backup, or a
partial restore) and the sweep handles it. But it is not the scenario the feature
existed for. A test can pass convincingly while testing the wrong half.

### Fix — the erasure record now lives outside the restored data

- `railway/scripts/92_export_tombstones.sql` emits `deleted_accounts` as
  replayable `INSERT … ON CONFLICT DO NOTHING` statements.
- The nightly backup job writes them to `/backups/deleted-accounts-latest.sql` —
  a **stable filename, overwritten each run, deliberately NOT pruned** with the
  dumps. It is a cumulative list, not a point-in-time snapshot; losing it to
  retention would defeat the purpose. A failed export does **not** fail the
  backup (the dump is the more important artefact) but warns loudly.
- `railway/DEPLOY.md` §10 is the restore runbook, built around the two disaster
  shapes having different best sources:

  | Situation | Source | Currency |
  |---|---|---|
  | Database reachable (bad migration/deploy) | **export live, before restoring** | to the second |
  | Database gone (volume/region loss) | the nightly file | up to **24h** of deletions missing |

  Step 4 — re-running `migrate` after re-importing — is **mandatory**: between the
  restore and that run, resurrected accounts are live and can sign in.

**Verification — PASS.** A real tombstone was created (fixture deleted through
the Edge Function), the backup forced onto a short schedule, and the generated
file inspected via a temporary log line (the container has no shell):

```sql
insert into public.deleted_accounts (user_id, email_sha256, deleted_at,
  campaigns_deleted, media_files_deleted, subscriptions_canceled)
values ('fc6aea47-…', '98b0d51a…', '2026-08-24 14:39:33.397456+00', 0, 0, 0)
on conflict (user_id) do nothing;
```

Values match the tombstone exactly and the statement is well-formed and
replayable. The debug line was removed afterwards and the `0 8 * * *` schedule
restored.

**Not yet verified end to end:** replaying that file with `psql -f` into a
restored database. There is no psql path to the Railway database by design (no
public endpoint), so this is exercised as part of the deferred **"test a restore"**
item in PRE_LAUNCH §3 — which is now the more valuable of the two backup tasks.

### Limits of restore protection, which cannot be automated away

- **Storage files are not in a `pg_dump`**, so restored rows for *surviving* users
  may point at missing files. The sweep only reports these.
- **Stripe will not un-cancel.** A restored subscription row can claim `active`
  while Stripe says `canceled`; resolved for erased users by the cascade, but for
  anyone else it needs a manual reconcile.
- **Retention bounds the window:** `BACKUP_KEEP=14` daily copies, so a deletion
  propagates to backups by expiry within 14 days. That is the honest statement
  for 7.2 to publish; the tombstone is what makes it true if a restore happens
  inside that window.

### Cleanup

Both fixture tombstones were removed afterwards (one carried a fabricated hash
from the restore simulation). Deleting a tombstone is normally exactly what must
not happen; these described throwaway `.test` accounts. Final state matches the
pre-7.1 baseline: campaigns 8, profiles 5, characters 6, media_assets 35.

---

## Area D — Browser pass — **PASS** 2026-08-21

### The fixture account (created 2026-08-21)

| | |
|---|---|
| Email | `qa-delete-fixture@tabletopchaos.test` |
| Password | `FixtureDelete!2026` |
| User id | `8c94c1b4-bd29-4b3b-8228-967e416f83e0` |

Created through the **GoTrue admin API with `email_confirm: true`**, so no
confirmation email was involved — which is the only way to make a throwaway
account while Resend has no verified domain and `MAILER_AUTOCONFIRM` is `false`
(PRE_LAUNCH §3). The address is deliberately at a `.test` TLD, which is reserved
by RFC 2606 and can never route mail anywhere real.

It is seeded to exercise **every** branch of the cascade at once:

| Seeded | Why |
|---|---|
| Owns **QA Fixture Campaign**, with `ejcaldwell06` added as a player | the DM-deletion branch — this campaign must be destroyed **for its other member**, proving deletion affects other people's access |
| Player in **Main Tes** | the player branch — this campaign must **survive** |
| Character **"Fixture Hero"** in Main Tes | must vanish from someone else's campaign without harming it |
| An upload in its **own** campaign | erased by cascade |
| An upload in **Main Tes**, attached as Fixture Hero's portrait | **the critical case**: `media_assets.uploaded_by` is `ON DELETE SET NULL`, so without step 5 of the function this file would survive in another user's campaign, unattributable. A real portrait reference exists so the erasure is not merely theoretical |

### Baseline (measured immediately before deletion)

| Metric | Before | Expected after |
|---|---|---|
| campaigns total | 9 | **8** (fixture's campaign destroyed) |
| profiles total | 6 | **5** |
| characters in Main Tes | 3 | **2** |
| members of Main Tes | 5 | **4** |
| members of QA Fixture Campaign | 2 | **0** (campaign gone) |
| media_assets uploaded by fixture | 2 | **0** |
| storage objects total | 120 | **116** (2 assets × original + thumb) |

The storage number is the one worth watching: rows cascading is not the same as
files being deleted, and a bucket that keeps the files is an erasure that did not
erase.

### Result — **PASS** 2026-08-21

User ran [account-deletion-manual.md](account-deletion-manual.md) and reported all
steps pass. Server-side verification against the baseline, every metric asserted
rather than eyeballed:

| Check | After | Expected | |
|---|---|---|---|
| campaigns total | 8 | 8 | PASS |
| profiles total | 5 | 5 | PASS |
| characters in Main Tes | 2 | 2 | PASS |
| members of Main Tes | 4 | 4 | PASS |
| QA Fixture Campaign rows | 0 | 0 | PASS |
| members of QA Fixture Campaign | 0 | 0 | PASS |
| media_assets uploaded by fixture | 0 | 0 | PASS |
| **media_assets with a NULL uploader** | **0** | 0 | PASS |
| **storage objects total** | **116** | 116 | PASS |
| fixture profile row | 0 | 0 | PASS |
| fixture characters anywhere | 0 | 0 | PASS |
| files under the destroyed campaign's prefix | `[]` | none | PASS |
| the two fixture asset paths by id | `[]` | none | PASS |
| sign-in as the fixture | `400 invalid_credentials` | refused | PASS |
| **user's own data** — characters 6, media_assets 35 | unchanged | unchanged | PASS |

Three of these carry most of the weight:

- **storage objects 120 → 116.** The files are actually gone, not merely
  unreferenced. Rows cascading proves nothing about the bucket, and this is the
  difference between erasure and the appearance of it.
- **`media_assets` with a NULL uploader = 0.** The `ON DELETE SET NULL` path was
  never exercised, which is what step 5 exists to guarantee: the fixture's upload
  in *another user's* campaign was deleted before the user row, rather than
  orphaned there. This is the case that would have quietly failed.
- **The user's own totals are byte-identical.** Deleting a member's account did
  not touch the campaign they played in — the cascade is precise, not broad.

The GoTrue user is genuinely deleted, not disabled: authentication returns
`invalid_credentials` rather than any "account disabled" state.

### One step not exercised in the browser

**Step 3 (wrong-confirmation handling) was skipped** — the user deleted the
account before reading it. Partially covered: the server-side refusal is verified
in Area C (`400`, "Type your email address exactly"), which is the security-
relevant half. What remains unverified by a human is only UI behaviour — that the
button stays disabled on a mismatch and enables on a differently-cased email.
Both are client-side conveniences in front of a server check that is known to
work. **Worth a retest if another fixture is ever created; not worth creating one
for.**

**Blocked on a disposable fixture account, deliberately.** Every existing account
is either the DM of real test campaigns or a player in them, and deletion is
irreversible. Worse, a deleted account **cannot currently be re-created**:
`MAILER_AUTOCONFIRM` is `false` and Resend has no verified domain, so a signup
confirmation email is only ever delivered to `ejcaldwell06@gmail.com`
(PRE_LAUNCH §3).

**Plan:** create a throwaway account server-side via the GoTrue admin API with
`email_confirm: true` (no email involved), seed it with a campaign it DMs, a
character in someone else's campaign, and an uploaded image — then have the user
delete it through the UI and assert the cascade. That exercises every path
without risking a real account.

Not yet run.
