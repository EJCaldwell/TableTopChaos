# Migrating off hosted Supabase to a self-hosted stack on Railway

**Goal:** eliminate the $25+/mo hosted Supabase bill by running the same stack on an
already-paid-for Railway plan, without discarding the access-control work.

**Decision (Option A):** keep PostgREST + GoTrue. The alternative — bare Postgres
with a hand-written API — would have meant rewriting 45 query call sites and
reimplementing 100 RLS policies in TypeScript, a 3–5 week job and a security
regression for a multi-tenant DM/player app. This path is ~1 week and preserves the
policies verbatim.

Infrastructure lives in [railway/](../railway/); read
[railway/README.md](../railway/README.md) for the architecture and the one-origin
constraint that makes it work.

---

## What actually changes

Measured against the current tree:

| Area | Count | Change required |
| --- | --- | --- |
| `supabase.from()` call sites | 45 | **None** |
| `.rpc()` calls | 3 | **None** |
| `supabase.auth.*` call sites | 9 | **None** (GoTrue is the same server) |
| `supabase.storage` call site | 1 | **None** (`storage-api` is the same server) |
| Realtime channels | 2 | **None** |
| `functions.invoke` call sites | 8 | **None** (gateway serves `/functions/v1/*`) |
| RLS policies | 100 | **None** — applied unchanged |
| Migrations | 27 files / 2,898 lines | **None** — plus one new prerequisite file |
| Edge Function source | 7 functions | **None** — `edge-runtime` runs them as-is |
| **Frontend code** | 32 files | **None** |
| `.env` values | 2 vars | `VITE_SUPABASE_URL` → gateway domain; `VITE_SUPABASE_ANON_KEY` → new key |

**The frontend requires zero code changes.** That is not luck — it holds because
[src/lib/supabase.ts](../src/lib/supabase.ts) constructs exactly one client and
[src/lib/env.ts](../src/lib/env.ts) centralises both variables. The existing var
names stay accurate: this is still a Supabase stack, just one you host.

**Real work is all infrastructure and verification:** standing up 7 Railway
services, the gateway routing, data migration, and re-running the access-control
matrix. Budget most of the week for that last item.

---

## Prerequisites

- Railway project created, on your existing plan
- Docker locally (for the pre-flight in Phase 1)
- `psql` / `pg_dump` v15+
- Stripe test-mode keys
- The hosted project is currently on the **free** plan (14 MB DB, 3 MB storage /
  106 objects). It **pauses after 7 days idle** — if it is paused when you start,
  unpause it before Phase 2.

---

## Phase 1 — Local pre-flight (do not skip)

Verifying locally is the difference between a one-day cutover and a week of
deploy-and-guess. The two things most likely to be wrong — gateway path stripping
and the `auth.uid()` claim wiring — fail identically here.

1. **Generate the linked secrets.**
   ```
   cp railway/.env.stack.example railway/.env.stack
   node railway/scripts/gen-keys.mjs
   ```
   Paste `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` into `railway/.env.stack`, then
   add `POSTGRES_PASSWORD`, `REALTIME_ENC_KEY` (16 chars), and
   `REALTIME_SECRET_KEY_BASE` (64 chars).

2. **Bring the stack up.**
   ```
   docker compose -f railway/docker-compose.yml --env-file railway/.env.stack up -d
   ```
   `railway/init/00_roles_and_auth_helpers.sql` runs automatically on the empty
   volume, creating the roles and `auth.uid()` **before** any app migration.

3. **Apply the 27 migrations in order.**
   ```
   for f in supabase/migrations/*.sql; do
     psql "postgres://postgres:$POSTGRES_PASSWORD@localhost:54322/postgres" -v ON_ERROR_STOP=1 -f "$f" || break
   done
   ```
   **Gate:** all 27 apply with zero errors. Migration 0008 is the one to watch — it
   inserts the `media` bucket and defines the RLS policy on `storage.objects`, so it
   needs the `storage` schema to exist (it does; `storage-api` migrates on boot —
   if 0008 fails, confirm the storage service came up first).

4. **Grant table privileges, then reload the PostgREST schema cache.** Both are
   easy to miss and both fail in ways that look like a broken app rather than a
   missing step:
   ```
   psql "$DB" -v ON_ERROR_STOP=1 -f railway/scripts/90_grant_app_privileges.sql
   psql "$DB" -c "notify pgrst, 'reload schema'"
   ```
   - **Grants:** none of the 27 migrations issues a table `GRANT` — hosted Supabase
     supplies those as project defaults. Without them every query returns
     `permission denied for table campaigns`, for signed-in users as well as anon,
     because table privileges are checked *before* RLS is consulted.
   - **Schema cache:** PostgREST builds its cache at boot. It came up before the
     migrations ran, so it has zero relations and answers writes with a bare
     `404` and an empty `{}` body — which reads like a routing bug, not a cache
     one. The `notify` is instant.

   **Gate:** the two verification queries at the bottom of
   `90_grant_app_privileges.sql` both return **no rows**, and the PostgREST log
   line reads `Schema cache loaded 34 Relations` (not `0 Relations`).

5. **Verify `auth.uid()` actually resolves.** This is the linchpin for all 100
   policies. Confirm the claim plumbing directly, per the `qa-testing` skill:
   ```sql
   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
   select auth.uid();  -- must return that UUID, not NULL
   rollback;
   ```
   **Gate:** returns the UUID. If NULL, nothing downstream is trustworthy — stop and
   fix before continuing.

6. **Verify gateway routing** (catches `handle` vs `handle_path` mistakes):
   ```
   curl -s -o /dev/null -w '%{http_code} rest\n'  "http://localhost:8000/rest/v1/?apikey=$ANON_KEY"
   curl -s -o /dev/null -w '%{http_code} auth\n'  http://localhost:8000/auth/v1/settings
   curl -s -o /dev/null -w '%{http_code} func\n'  http://localhost:8000/functions/v1/healthz
   curl -s -o /dev/null -w '%{http_code} store\n' http://localhost:8000/storage/v1/bucket
   ```
   **Gate:** no 404s. A 401 on storage/rest is fine — it means the service answered.

7. **Point the frontend at it.** Rather than editing `.env` (which would disturb
   the dev server on :5173), pass the two vars inline — Vite picks up prefixed
   process env at build time:
   ```
   VITE_SUPABASE_URL=http://localhost:8000 VITE_SUPABASE_ANON_KEY="$ANON_KEY" npm run build
   ```
   **Gate:** build clean **and** the bundle actually contains the local origin —
   `grep -c localhost:8000 dist/assets/*.js` returns non-zero with no
   `*.supabase.co` left in it. Without that second half the gate passes on a
   build that silently used the old hosted URL.

8. **End-to-end through the gateway** — the gate that subsumes the rest, because
   it exercises GoTrue → JWT → PostgREST → RLS as one path rather than three
   parts in isolation. With `MAILER_AUTOCONFIRM=true`, sign up two users via
   `/auth/v1/signup`, then with their bearer tokens: user A creates a campaign
   (expect `201`), reads it back (expect one row), and user B plus a signed-out
   caller read the same endpoint (expect `[]` from both), and user B's `PATCH`
   affects zero rows.
   **Gate:** every allowed path returns data and every denied path returns `[]`.
   An empty array — not a `401` — is the correct denial: the privilege exists,
   the policy filtered the rows.

---

## Phase 2 — Data migration

At 14 MB this is fast; the ordering is what matters.

1. **Dump from hosted**, roles and ownership excluded (the target has its own):
   ```
   pg_dump "$HOSTED_DB_URL" --data-only --no-owner --no-privileges \
     --schema=public --schema=storage -f dump.sql
   ```
   Schema comes from replaying the migrations, not from the dump — that keeps the
   migration files the single source of truth.

2. **`auth.users` needs separate handling.** GoTrue owns that table and its schema
   differs across versions, so do **not** bulk-copy it. Export only the columns you
   need (`id`, `email`, `encrypted_password`, `created_at`,
   `email_confirmed_at`) and insert them into the new `auth.users`.
   The `id` values **must be preserved exactly** — every `auth.uid()` comparison and
   all of `campaign_members` keys on them. A regenerated id silently orphans a user
   from their campaigns. **Gate:** 5 users on the target (current hosted count), each
   with its original UUID.

   Passwords carry over as-is: both sides use bcrypt in `encrypted_password`, so
   existing logins keep working. If any hash fails to transfer, that user needs a
   password reset — which requires SMTP to be configured (Phase 3, step 5) first.

3. **Restore, then re-verify counts** table by table against the source.

4. **Migrate the 106 storage objects.** Download from the hosted `media` bucket and
   re-upload through the new Storage API (not directly onto the volume — the API
   writes the `storage.objects` rows the RLS policy and
   `private.campaign_storage_used()` depend on). **Gate:** object count is 106 and
   `private.campaign_storage_used()` matches the pre-migration value for each
   campaign.

---

## Phase 3 — Railway deploy

1. Create 7 services per the table in [railway/README.md](../railway/README.md).
2. Set the secrets as **shared variables**.
3. **Public domain on `gateway` only.** If any other service gets one, PostgREST and
   Storage become directly reachable, bypassing nothing security-wise (they still
   check JWTs) but breaking the single-origin assumption and complicating CORS.
4. Attach volumes: `postgres` → `/var/lib/postgresql/data`, `storage` →
   `/var/lib/storage`. **Without these, a redeploy wipes the database.**
5. Set `MAILER_AUTOCONFIRM=false` and real SMTP credentials. Leaving autoconfirm on
   in production lets anyone sign up as any email address.
6. Healthcheck path `/healthz` on `gateway` and `functions`.
7. Repeat Phase 1 steps 3–5 against the Railway domain.

---

## Phase 4 — Stripe re-wiring

Billing is the piece most likely to break, because the endpoint URL changes.

1. Register a new webhook endpoint at
   `https://<gateway-domain>/functions/v1/stripe-webhook`.
2. Set the **new** signing secret — the old one will not verify.
3. Confirm the raw body reaches the function intact. The Caddyfile deliberately adds
   no body-rewriting directives for this reason; if you edited that block,
   `constructEventAsync()` will reject every event.
4. **Gate — live test-mode run:** checkout → trial start → webhook received →
   `campaign_subscriptions` row written. Then the reused-card path, which must
   cancel without charging.

---

## Phase 5 — QA (the real cost of this migration)

Per [CLAUDE.md](../CLAUDE.md) and the `qa-testing` skill, RLS is the access-control
layer — so changing what enforces it means re-verifying all of it. Nine phases of
checklists in [QA/](../QA/) exist for exactly this.

**I can do server-side:**
- `npm run build` clean
- `pg_policies` audit — **gate: exactly 100 policies** across `public` + `storage`,
  and **exactly 30 tables with `rowsecurity = true`** (both verified against the
  live hosted DB on 2026-08-04; capture them again just before cutover in case the
  schema moves)
- The DM / player / non-member / signed-out matrix via `set local role authenticated`
  + JWT claims, asserting **both** allowed and denied paths
- Confirming every table with policies also has `rowsecurity = true` — a table that
  restored without RLS enabled is the highest-risk failure mode of this whole
  migration, and it fails **open**

**You must do in-browser** (I cannot see or drive your browser):
- Sign-up / sign-in / session persistence across refresh
- The four-role matrix through the real UI
- Media upload + signed-URL display (verify a player cannot load another campaign's
  image via a guessed path)
- Two-session realtime test — a **regression** check: Phase 4.4 is built and passed
  on 2026-07-29, so re-run its four scenarios against its run log as the baseline
- Campaign export/import round-trip
- The Stripe flows from Phase 4

Record results in a dated run log under `QA/railway_migration_tests/`. Note that
`get_advisors` is a hosted-Supabase feature with no self-hosted equivalent — the
`pg_policies` + `rowsecurity` audit replaces it, and that substitution should be
written into the run log.

---

## Rollback

Keep the hosted project alive until Phase 5 passes. Rollback is reverting two `.env`
values and redeploying the frontend — so long as you have not deleted the hosted
project or let it pause past recovery. **Do not cancel anything until QA is green.**

## Known trade-offs

| Lost | Mitigation |
| --- | --- |
| Automatic daily backups | `pg_dump` on a Railway cron; **must be set up before cutover** |
| `get_advisors` security linting | `pg_policies` + `rowsecurity` audit in the QA gate |
| Managed upgrades | Pinned image tags; upgrade deliberately |
| Supabase Studio | `psql`, or run `supabase/studio` as an 8th service |
| Log retention / dashboards | Railway logs (shorter retention) |

## Cost expectation

7 containers on Railway will exceed a bare Postgres. Against a 14 MB database and
3 MB of media the compute is small, but **verify actual usage after a few days**
before assuming this beat $25/mo — Railway bills by usage and idle containers still
accrue. If it lands close to $25, the cheaper answer was deleting the unused
`Art-Randomizer` project and staying on hosted Pro.
