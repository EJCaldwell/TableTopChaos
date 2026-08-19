# 6.3 — Railway deploy & gateway

Stands the stack up on Railway and repeats the 6.1 gates against a public
domain. Configuration per service: [railway/DEPLOY.md](../../railway/DEPLOY.md).

## Status: in progress

Local preparation is **done and verified**; nothing has been deployed to Railway
yet. The remaining work needs a Railway project and SMTP credentials.

## Run log

### 2026-08-19 — Postgres repinned to 17.x, full sequence re-verified locally

**Why.** 6.2 was completed against `supabase/postgres:15.8.1.060` while the
hosted project runs **17.6** — two majors apart. It already cost one failure
(PG17's `pg_dump` writes `SET transaction_timeout` into the preamble, which 15
rejects, aborting the restore), and each new major adds more such differences.
A restore is the worst place to meet an incompatibility, since it is what you
reach for when something has already gone wrong.

`supabase/postgres:17.6.1.165` exists and matches the source exactly, so the fix
was cheap. Repinned in `docker-compose.yml` and `railway/README.md`.

**Verification — the entire 6.1 + 6.2 sequence re-run from an empty volume:**

| Check | Result |
|---|---|
| Server version | **PostgreSQL 17.6** — matches hosted |
| Migrations | **28/28** (27 + the recovered 0023) |
| Policies (`public` + `storage`) | **100** |
| `public` tables with RLS disabled | **0** |
| Columns in `public` | **231** — matches hosted exactly |
| Row counts vs source | **PASS**, 29 tables |
| `auth.users` restored | 5 |
| Storage objects | **106**, name and size identical to source |
| Gateway prefixes | 400 / 200 / 200 / 400 / 200 — no 404s |
| Signed-out read of `campaigns` | `[]` |

The `transaction_timeout` workaround is now inert. It was left in the restore
script but made **conditional on `pg_settings`** rather than unconditional, so
it only acts if the two ends drift apart again — and its "stripped N GUCs"
message no longer prints on a matched pair, where it would have been false.

### Finding: service boot order vs the migration replay

The first PG17 rebuild **failed at 7 of 28** with
`relation "storage.buckets" does not exist`.

Neither `auth.users` nor `storage.buckets` is created by our migrations — GoTrue
and storage-api each create their own schema on first boot — and nothing
sequences that against the replay. Migration **0008 inserts the `media` bucket**,
so it needs storage-api to have finished booting; 18 FKs need `auth.users` for
the same reason.

It did not surface in 6.1 only because storage-api happened to have booted by
the time the replay ran there. That is luck, and on Railway (where services
start independently and a cold image pull is slower) it is luck that will not
hold. The gate is now explicit — both `to_regclass()` checks must return true
before replaying — and [DEPLOY.md](../../railway/DEPLOY.md) step 3 was corrected;
it had storage coming up *after* the migrations, which cannot work.

### 2026-08-19 — deployed to Railway; all runnable gates PASS

Project **TableTopChaos**, environment `production`, 7 services, public domain
`https://gateway-production-85a0.up.railway.app` on the gateway only.

| Gate | Result |
|---|---|
| Migrations replayed | **28/28** |
| Policies (`public` + `storage`) | **100** |
| `public` tables with RLS disabled | **0** |
| Columns in `public` | **231** — matches hosted |
| `auth.uid()` from `request.jwt.claims` | resolves |
| Gateway prefixes (public domain) | `/healthz` 200 · `/auth/v1/settings` 200 · `/functions/v1/healthz` 200 · rest 400 · storage 400 · unknown **404** |
| Row counts vs source | **PASS** — 29 tables, 262 rows, 5 users |
| Objects | **106**, name + size identical, **3,044,130 bytes** |
| `campaign_storage_used()` | 842,508 × 3, matching baseline |
| **Redeploy preserves data** | **PASS** — 5/8/106 before and after redeploying postgres + storage |
| Media readable after redeploy | 200, 6,570 bytes, valid WebP |
| Four-role matrix via public domain | see below |

**Four-role matrix through the public gateway.** GoTrue cannot complete a signup
(autoconfirm is correctly off and SMTP does not exist yet), so the test user was
created through the **admin API** with `email_confirm: true` — which exercises
the same path without weakening the production posture. Removed afterwards,
along with its campaign.

| Actor | Action | Result |
|---|---|---|
| user | log in, read own `profiles` row | 1 row |
| user | create own campaign | **201** |
| user | read it back | 1 row |
| user (non-member) | read other campaigns | **`[]`** |
| user (non-member) | read `dm_notes` / `characters` | **`[]`** |
| signed-out | read campaigns | **`[]`** |

**The TCP proxy was deleted afterwards and the closure verified** — `psql` to
`trolley.proxy.rlwy.net:49719` now fails, while the gateway, auth and functions
endpoints all still answer. The database is private again.

### Findings (all now in [railway/DEPLOY.md](../../railway/DEPLOY.md))

1. **Volume must mount at `/var/lib/postgresql`, not `.../data`.** Railway
   volumes contain `lost+found`, so `initdb` refuses the mount point. `PGDATA`
   pointing at a subdirectory does **not** help — `supabase/postgres` starts with
   a hardcoded `-D /var/lib/postgresql/data` and then dies with
   `is not a valid data directory`.
2. **`postgres` is not a superuser on Railway** (the reverse of the local image);
   `supabase_admin` is, and takes the same password. Running the init as
   `postgres` fails with `permission denied for schema auth`.
3. **`functions` needs an explicit `PORT=8000`.** Railway probes its injected
   port while edge-runtime binds a hardcoded 8000, so the deploy fails with
   `1/1 replicas never became healthy!` and **nothing in the service log** —
   it stops at `Starting Container`.
4. **`STORAGE_HOST` is 8080, not 5000** — storage-api honours Railway's `PORT`.
5. **`railway up` ignores the working directory.** Run from `railway/gateway/`
   it uploaded the repo root, found `package.json`, and deployed the Vite
   frontend as a static site — a convincing deploy of the wrong thing. Fixed by
   setting `rootDirectory`/`dockerfilePath` on the service instance.
6. **The CLI cannot create GitHub-linked services** (`Not Authorized` on every
   GitHub call, unaffected by re-login), and dashboard-created services stay as
   instance-less shells unless the staged change is applied.
7. **The CLI's state reporting is unreliable** — it showed a volume as detached
   and deleted while the API showed it attached and `READY`, and
   `railway service delete` silently no-op'd. The GraphQL API was correct every
   time.

**Credential handling note:** `railway add --variables "K=V"` **echoes the value
back to the terminal**. The database password was exposed that way on the first
attempt, and was rotated via `railway variable --set-from-stdin`, which prints
nothing. Every secret since has gone in through stdin.

### 2026-08-19 (later) — SMTP wired via Resend; **6.3 gates all PASS**

`auth` now sends through Resend (`smtp.resend.com`, user `resend`, key in
`railway/.env.stack.production`). Verified by the user receiving **both**:

1. a direct `POST https://api.resend.com/emails` connectivity check, and
2. a **password-recovery email generated by GoTrue** — the gate that matters,
   since it proves the whole GoTrue → SMTP → inbox path.

Recovery was used rather than signup deliberately: `ejcaldwell06@gmail.com` is
already one of the 5 restored users, so a signup would only have returned
"user already registered", and recovery exercises the identical mail path
without mutating data.

**Two failures worth recording, because both look like bad credentials:**

- **Railway blocks outbound SMTP 587 and 465.** Both time out; GoTrue reports
  `504 request_timeout` / `context deadline exceeded` after 10s and nothing more
  specific. **Port 2587 works** (Resend publishes 2587/2465 for hosts that filter
  the usual ports). Testing the API key directly against Resend's HTTP API first
  is what separated "the key is wrong" from "GoTrue cannot reach the server" —
  those are indistinguishable from the app's side.
- **Resend compares the recipient case-sensitively** while no domain is
  verified: `EJCaldwell06@gmail.com` was rejected with a 403 naming the
  lowercase form.

## 6.3 status: COMPLETE — all gates PASS

Two configuration values remain deliberately wrong and are now tracked in
[PRE_LAUNCH.md](../../PRE_LAUNCH.md) rather than here, because neither can be
fixed until something outside this phase exists:

- **No verified sending domain**, so mail reaches only the Resend account owner.
  Every other user's confirmation email is silently undelivered while
  `MAILER_AUTOCONFIRM=false` — and the signup still returns success, so the app
  shows no sign of it. A hard blocker on real users.
- **`GOTRUE_SITE_URL=http://localhost:5173`**, because the frontend has no
  deployed home. It is what confirmation and reset links are built from.
