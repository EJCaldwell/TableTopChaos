# 6.2 — Data migration

Moves the contents of the hosted project `fnykpoattheldxtkrozd` onto the
self-hosted stack. Schema is **not** migrated — it comes from replaying the 27
migration files, so those stay the single source of truth. This subphase moves
data only.

## Pre-migration baseline (captured 2026-08-18, read-only)

Every number here is the expected post-migration value. Captured **before**
anything was dumped, which is the point: a count taken afterwards proves nothing
if there is nothing to compare it against.

### `public` — 29 tables, 262 rows

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| abilities | 5 | | media_reports | 0 |
| campaign_members | 12 | | npc_stat_fields | 41 |
| campaign_subscriptions | 2 | | npc_stat_sections | 20 |
| campaigns | 8 | | npcs | 12 |
| character_status | 2 | | profiles | 5 |
| characters | 6 | | quests | 6 |
| dm_notes | 7 | | schedule_rsvps | 4 |
| encounter_images | 0 | | schedule_sessions | 5 |
| encounter_npcs | 11 | | sessions | 9 |
| encounters | 6 | | shared_items | 1 |
| initiative_entries | 2 | | sheet_fields | 45 |
| inventory_items | 1 | | sheet_sections | 9 |
| invite_codes | 2 | | spells | 5 |
| journal_entries | 5 | | trial_redemptions | 1 |
| media_assets | 30 | | | |

### Auth and storage

| Metric | Value |
|---|---|
| `auth.users` | 5 |
| `storage.objects` | 106, all in the `media` bucket |
| `media` bucket | **private**, 10 MB limit, png/jpeg/webp/gif only |
| Database total | 14 MB |
| Media total | 2.9 MB |

### `private.campaign_storage_used()` per campaign

Three campaigns report **842,508 bytes / 10 assets each**; the other five report
zero. The identical figure across three campaigns looks alarming and is not —
the function definition filters correctly on `campaign_id`, and this is simply
the same 10-image QA fixture set uploaded to three campaigns during Phase 1.6
testing. Verified rather than assumed, because this function is what enforces
the storage quota behind billing.

| Campaign | Bytes |
|---|---|
| `d0e1fc8f-…a80fa` ("Main Test") | 842,508 |
| `caef3949-…c509a` | 842,508 |
| `b0f7fadb-…a08c52` | 842,508 |
| the other five | 0 |

## Finding: 46 of the 106 storage objects are orphans

**Each upload writes two objects** — `<campaign>/<asset>/original.webp` and
`.../thumb.webp` — and `media_assets.storage_path` records **only the
original**. The thumbnail is located by convention, not by a row. So:

| | Objects |
|---|---|
| Total in the `media` bucket | 106 (= 53 uploads × 2) |
| Belonging to the 30 tracked assets | 60 (30 originals + 30 thumbs) — **all live** |
| Genuinely orphaned | **46** (23 uploads) |
| Directories belonging to deleted campaigns | 2 of 5 |

**Correction, recorded because it nearly caused data loss:** the first pass at
this joined `media_assets.storage_path` directly against object names and
reported 76 orphans. That counted every thumbnail as an orphan. Had the
"skip the orphans" option been taken on that number, 30 thumbnails still in use
would have been dropped and every portrait and encounter image would have
rendered broken on the new stack. The corrected join compares *directories*.

Two of the five campaign directories belong to campaigns that no longer exist,
which suggests **deleting a campaign does not clean up its storage objects** —
a slow leak, and one that costs money once it runs on metered infrastructure.
Out of scope for 6.2; worth its own look (it points at Phase 12 / PRE_LAUNCH).

**Decision (2026-08-18): migrate all 106 faithfully.** The 46 dead objects are
~1–2 MB, so the storage argument is noise. What 6.2 buys is a rehearsal of the
dump-and-restore path before it runs at cutover, and every filtering rule added
is a place for the rehearsal to diverge from the real thing — as the 76-vs-46
error demonstrates. The orphans are removed anyway by the PRE_LAUNCH data wipe.

## Run log

### 2026-08-18 — baseline captured, migration NOT started

Read-only queries against the live project only. Nothing dumped, nothing
written, no credentials used beyond the existing MCP connection.

Blocked at the time on credentials and on the scope decision; both resolved
below.

### 2026-08-18 — database half PASS; media pending

**Gate: per-table row counts match the source — PASS.** All 29 tables, 262 rows,
compared by diffing counts captured from the source at dump time against counts
read from the target after restore (`counts.diff`, empty).

**Gate: 5 users with original UUIDs — PASS.** Compared id + `md5(encrypted_password)`
+ `email_confirmed_at` across both databases: identical for all 5. UUID
preservation is the property everything else hangs off — every FK in the app
points at `auth.users(id)` — and the hash comparison is the automatable half of
"existing passwords still authenticate". Actually signing in needs a password
only the user knows, so that remains a manual check.

**Referential integrity after restore:** zero orphans across
`campaigns.owner_id`, `campaign_members.user_id`, and `profiles.id`.

Four problems surfaced during the restore. The first is the significant one.

#### The hosted database had drifted from the migration files

The restore failed with `column "hp" of relation "initiative_entries" does not
exist`. Diffing every column in both schemas: the hosted database had **231**
columns, the migrations produced **228**. Missing were
`initiative_entries.hp`, `.max_hp` and `.npc_id`.

The hosted migration ledger lists **`0023_initiative_hp_npc`, applied
2026-07-20** — and there is **no `0023_*.sql` in the repo**, which jumps from
0022 to 0024. The migration was applied directly to the hosted project during
Phase 3.5 and the file was never committed.

Nothing could have surfaced this earlier. The hosted database had the columns,
so the app worked and Phase 3.5 QA passed honestly; `CombatPanel.tsx` reads
`hp` / `max_hp` / `npc_id` at eight sites. No environment had ever been built
from the migration files alone — which is exactly what this phase does for the
first time, and exactly why the pre-flight was worth doing on a copy rather than
discovering it at cutover.

**Left unfixed, a Railway deploy would have been missing the per-combatant HP
tracker entirely**, and the DM combat panel would have failed at runtime against
a schema that has no such columns.

Recovered as
[supabase/migrations/0023_initiative_hp_npc.sql](../../supabase/migrations/0023_initiative_hp_npc.sql),
with definitions read out of the live schema (`information_schema`,
`pg_constraint`, `pg_indexes`) rather than reconstructed from guesswork, and
written idempotently so it is a no-op on the hosted project that already has
them. Verified: applies clean, applies twice clean, and afterwards the two
schemas are **identical at 231 columns**.

#### Three mechanical fixes

- **`auth.users.confirmed_at` is a generated column** in GoTrue v2.170.0, and
  Postgres refuses to `COPY` into one. The column intersection now filters on
  `is_generated = 'NEVER'` rather than on names alone, so a future GoTrue that
  generates another column will not break it again. 34 columns carried over.
- **PostgreSQL 17 → 15 preamble.** The hosted database is **17.6**; this stack
  is pinned to **15.8**, so `pg_dump` emitted `SET transaction_timeout = 0`,
  which 15 rejects, aborting the restore on line 13. Stripped in the restore
  script — these are session GUCs in the header, not data. **This is a
  workaround, not a fix:** the stack should be repinned to a Postgres 17 image
  for parity. Raised for 6.3.
- **`handle_new_user` fired during the user restore**, creating `profiles` rows
  that then collided with the real ones (`duplicate key … profiles_pkey`). The
  trigger exists to bootstrap a *new signup*; during a restore the profile
  already exists and carries the display name, so letting it fire would both
  break the load and lose data. Triggers are now disabled around the
  `auth.users` copy, mirroring what `pg_dump --disable-triggers` does for the
  public tables.

### 2026-08-18 — media PASS; **6.2 complete, all gates green**

**Gate: object count is 106 — PASS.** All 106 uploaded, zero failures.

**Gate: byte-for-byte fidelity — PASS.** Every object name *and* size compared
against the source: identical, **3,044,130 bytes** on both sides. Stronger than
the count gate PLANNING asked for, and cheap once the list exists.

**Gate: `private.campaign_storage_used()` matches the pre-migration value —
PASS.** 842,508 on each of the same three campaigns, 0 on the other five.

**Integrity:** all 30 `media_assets` rows resolve to a real object.

Two more defects, both in the credential/permission layer:

- **Newer `sb_secret_…` keys are only accepted in the `apikey` header.** Sent as
  `Authorization: Bearer` they return **400 on every request** — which looks
  like a bad key, not a header problem, especially since the same key in the
  same form listed the bucket fine over a different endpoint. Legacy JWT-style
  `service_role` keys accept either, so the script now sends both headers and
  works with whichever kind of key a project issues.
- **The `storage` schema had no grants at all** — the same class of bug as the
  `public` grants in 6.1, and missed there because 6.1 never uploaded anything.
  storage-api creates `buckets` / `objects` itself on first boot, so they miss
  the `alter default privileges` set for `postgres` in the init script.

  The symptom is actively misleading and is worth remembering: every upload
  returned **`new row violates row-level security policy`**. That is not what
  happened. The storage-api log shows SQLSTATE **42501 on
  `select id, file_size_limit, allowed_mime_types from buckets`** — permission
  denied while merely *looking up the bucket* — which storage-api then reports
  as an RLS failure on objects. Anyone seeing that message will go hunting
  through migration 0008's policy and find nothing wrong with it.

  Fixed in `90_grant_app_privileges.sql`, with privileges mirroring the live
  project exactly (verified against it): full access on `buckets`/`objects` for
  all three roles, multipart tables writable only by `service_role`. Safe for
  the same reason as `public`: `storage.objects` has RLS on, and 0008 defines a
  member-only SELECT policy and **no** insert/update/delete policy, so an
  authenticated caller still cannot write objects directly.

## Summary — 6.2 gates

| Gate | Result |
|---|---|
| Per-table row counts match source | **PASS** — 29 tables, 262 rows |
| 5 users present with original UUIDs | **PASS** — ids + bcrypt hashes identical |
| Object count is 106 | **PASS** — plus name/size identity, 3,044,130 bytes |
| `campaign_storage_used()` matches | **PASS** — 842,508 × 3 |
| Existing bcrypt passwords authenticate | **hashes verified identical; an actual sign-in needs a password only the user knows — manual, deferred to 6.3** |
