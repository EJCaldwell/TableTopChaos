# Railway deploy sheet (Phase 6.3)

Per-service configuration for the 7 services. The local `docker-compose.yml` is
the reference implementation — anything here that disagrees with it is a bug in
one of them.

**Set the shared secrets as Railway _shared variables_** at the project level and
reference them per service, so `JWT_SECRET` has exactly one definition. If the
services drift onto different values, GoTrue signs tokens PostgREST cannot
verify and every request 401s with nothing in the logs explaining why.

**Generate fresh secrets for Railway.** Do not promote `railway/.env.stack` —
those were generated in an assistant transcript for a throwaway local stack.
Run `node railway/scripts/gen-keys.mjs` again and keep the output.

---

## Shared variables (project level)

| Variable | Source |
|---|---|
| `JWT_SECRET` | `gen-keys.mjs` |
| `ANON_KEY` | `gen-keys.mjs` (derived from `JWT_SECRET`) |
| `SERVICE_ROLE_KEY` | `gen-keys.mjs` (derived from `JWT_SECRET`) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `REALTIME_ENC_KEY` | `openssl rand -hex 8` — **exactly 16 chars** |
| `REALTIME_SECRET_KEY_BASE` | `openssl rand -hex 32` — **exactly 64 chars** |
| `SITE_URL` | where the frontend is served |
| `PUBLIC_URL` | the gateway's public domain |

---

## 1. `postgres`

| | |
|---|---|
| Image | `supabase/postgres:17.6.1.165` — same major as the hosted project |
| Volume | **`/var/lib/postgresql` — without this a redeploy wipes the database** |
| Domain | none (private) |
| Variables | `POSTGRES_PASSWORD`, `POSTGRES_DB=postgres` (**no `PGDATA`** — see below) |

**Set secrets with `railway variable --set-from-stdin KEY`, not `--set`
or `railway add --variables`.** Those echo the value back to the terminal, which
puts production credentials into scrollback, shell history and any transcript.
`--set-from-stdin` reads it from a pipe and prints nothing.

**Mount the volume at `/var/lib/postgresql`, NOT at `/var/lib/postgresql/data`.**
Railway volumes arrive containing a `lost+found`, and `initdb` refuses a
non-empty data directory. Setting `PGDATA` to a subdirectory does **not** fix it
for this image — `supabase/postgres` starts the server with a hardcoded
`-D /var/lib/postgresql/data`, so it initialises into the subdirectory and then
dies with `"/var/lib/postgresql/data" is not a valid data directory`. Mounting
one level up puts the data directory *inside* the volume, where `lost+found` is
a harmless sibling. (Both wrong paths were tried on 2026-08-19; this is the one
that works.)

Railway will not run `docker-entrypoint-initdb.d`, so **`railway/init/` does not
execute automatically**. Both files must be applied by hand, in order, against
the fresh database *before* any app migration.

**Connect as `supabase_admin`, not `postgres`.** On Railway this image ships
`postgres` as an ordinary, non-superuser role, so running the init as `postgres`
fails with `permission denied for schema auth` (that schema is owned by
`supabase_admin`) and `Only superusers can alter privileged roles`. This is the
reverse of the local compose stack, where `01_*.sh` creates `postgres` as a
superuser itself — so the same scripts need a different connection user
depending on where they run. `supabase_admin` accepts `POSTGRES_PASSWORD`.
Running `01_*.sh` as `supabase_admin` promotes `postgres` to superuser, after
which the other services can connect as `postgres` as designed.

```
ADMIN="postgres://supabase_admin:$POSTGRES_PASSWORD@<proxy-host>:<proxy-port>/postgres"
psql "$ADMIN" -v ON_ERROR_STOP=1 -f railway/init/00_roles_and_auth_helpers.sql
PSQL_DSN="$ADMIN" POSTGRES_PASSWORD=… bash railway/init/01_stack_login_roles.sh
```

`01_*.sh` takes `PSQL_DSN` for exactly this case; without it the script assumes
the container's local socket, which does not exist from a laptop.

### Reaching the database at all

`postgres` has no public domain, and Railway's private network is not reachable
from your machine. `railway run` only injects environment variables — it does
not tunnel — and `railway connect` wants a `DATABASE_URL` that custom-image
services do not get. A plain `railway domain` gives an **HTTP** endpoint on 443,
which cannot carry the Postgres wire protocol.

What works is a **TCP proxy**, which the CLI does not expose:

```
railway api 'mutation { tcpProxyCreate(input: {applicationPort: 5432,
  environmentId: "<env-id>", serviceId: "<service-id>"}) { domain proxyPort } }'
railway redeploy --service postgres   # required before it becomes active
```

It returns a host and port on Railway's own proxy — nothing binds locally.
**Delete it once the migration run is finished**; a permanently internet-facing
database is the one exposure that bypasses all 100 RLS policies.

`01_*.sh` is what creates the `postgres` role (this image ships `supabase_admin`
as its superuser and no `postgres` at all) and passwords `authenticator`.
Skipping it leaves `auth`, `rest`, `realtime` and `storage` crashlooping on
password authentication.

## 2. `rest` (PostgREST)

| | |
|---|---|
| Image | `postgrest/postgrest:v12.2.3` |
| Domain | none |

```
PGRST_DB_URI=postgres://authenticator:${POSTGRES_PASSWORD}@postgres.railway.internal:5432/postgres
PGRST_DB_SCHEMAS=public,storage
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET=${JWT_SECRET}
PGRST_JWT_AUD=authenticated
PGRST_DB_USE_LEGACY_GUCS=false
```

After migrations run, send `notify pgrst, 'reload schema'` — PostgREST caches the
schema at boot and will otherwise 404 every write with an empty `{}` body.

## 3. `auth` (GoTrue)

| | |
|---|---|
| Image | `supabase/gotrue:v2.170.0` |
| Domain | none |

```
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres.railway.internal:5432/postgres?search_path=auth
GOTRUE_API_HOST=0.0.0.0
GOTRUE_API_PORT=9999
GOTRUE_SITE_URL=${SITE_URL}
API_EXTERNAL_URL=${PUBLIC_URL}
GOTRUE_URI_ALLOW_LIST=${SITE_URL}/*
GOTRUE_JWT_SECRET=${JWT_SECRET}
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_EXP=3600
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_SMTP_HOST=smtp.resend.com
GOTRUE_SMTP_PORT=2587          # NOT 587 or 465 — see below
GOTRUE_SMTP_USER=resend        # the literal string, not an address
GOTRUE_SMTP_PASS=<resend API key>
GOTRUE_SMTP_ADMIN_EMAIL=onboarding@resend.dev
GOTRUE_SMTP_SENDER_NAME=TableTopChaos
```

**Railway blocks the standard SMTP submission ports.** Both **587 and 465 time
out** — GoTrue returns `504 request_timeout` with `context deadline exceeded`
after 10s and nothing more specific, which reads like broken credentials rather
than a blocked port. Resend publishes **2587** (STARTTLS) and **2465** (implicit
TLS) as alternates precisely for hosts that filter the usual ones. 2587 is
verified working here (2026-08-19).

Worth testing the API key with a direct `POST https://api.resend.com/emails`
before blaming SMTP: it isolates "the key works and delivery reaches the inbox"
from "GoTrue can reach the SMTP server", and those two fail identically from the
outside.

**Resend compares the recipient case-sensitively** while no domain is verified.
Sending to `EJCaldwell06@gmail.com` is rejected with a 403 naming
`ejcaldwell06@gmail.com`. Keep the address lowercased.

**`GOTRUE_MAILER_AUTOCONFIRM` must be `false` here.** It is `true` locally so QA
can create users freely; left on in production it means anyone can register as
any address, including one they do not control, with no verification step. That
turns email into a spoofable identity — and email is what identifies a user
across every one of the 100 policies.

Autoconfirm off **requires working SMTP**, or nobody can complete a signup.

## 4. `storage`

| | |
|---|---|
| Image | `supabase/storage-api:v1.11.13` |
| Volume | **`/var/lib/storage`** — without it, uploaded media is lost on redeploy |
| Domain | none |

```
ANON_KEY=${ANON_KEY}
SERVICE_KEY=${SERVICE_ROLE_KEY}
PGRST_JWT_SECRET=${JWT_SECRET}
DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres.railway.internal:5432/postgres
POSTGREST_URL=http://rest.railway.internal:3000
FILE_SIZE_LIMIT=52428800
STORAGE_BACKEND=file
FILE_STORAGE_BACKEND_PATH=/var/lib/storage
TENANT_ID=stub
REGION=stub
GLOBAL_S3_BUCKET=stub
```

storage-api creates `storage.buckets` / `storage.objects` itself on first boot,
which means they miss the `alter default privileges` from the init script and
arrive with **no grants**. Re-run `railway/scripts/90_grant_app_privileges.sql`
after this service's first successful start, or every upload fails with a
misleading `new row violates row-level security policy` that is really
permission denied on `storage.buckets`.

## 5. `realtime`

| | |
|---|---|
| Image | `supabase/realtime:v2.34.7` |
| Domain | none |

```
PORT=4000
APP_NAME=realtime
DB_AFTER_CONNECT_QUERY=SET search_path TO _realtime
DB_HOST=postgres.railway.internal
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=${POSTGRES_PASSWORD}
DB_NAME=postgres
DB_ENC_KEY=${REALTIME_ENC_KEY}
API_JWT_SECRET=${JWT_SECRET}
SECRET_KEY_BASE=${REALTIME_SECRET_KEY_BASE}
ERL_AFLAGS=-proto_dist inet_tcp
DNS_NODES=''
RLIMIT_NOFILE=10000
SEED_SELF_HOST=true
RUN_JANITOR=true
```

`APP_NAME` is not optional — without it the service dies at boot with
`(RuntimeError) APP_NAME not available` before logging anything useful.
`DB_AFTER_CONNECT_QUERY` keeps realtime's own un-policied tables (`tenants`,
which holds a tenant JWT secret) out of `public`, where PostgREST would serve
them and the grant pass would expose them to `anon`.

### The gateway must rewrite `Host` for realtime (found 2026-08-21)

Realtime v2 is **multi-tenant**: it takes the **first label of the Host header**
as a tenant id and looks it up in `_realtime.tenants`. Caddy preserves the
client's Host, so it asked for `gateway-production-85a0` and rejected every
connection with `TenantNotFound`. The tenant that exists is created by
`SEED_SELF_HOST=true` and named from `SELF_HOST_TENANT_NAME`, **default
`realtime-dev`** (see `priv/repo/seeds.exs` in the image).

Fixed in the Caddyfile with `header_up Host realtime-dev.internal` on the
realtime upstream — **not** by setting `SELF_HOST_TENANT_NAME` to the Railway
subdomain, so that adding a custom domain later cannot break realtime again.
Only the first label is parsed; the suffix is never resolved.

**The symptom is a lag, not an outage.** Database writes succeed and a page
refresh shows the change, so it reads as "realtime is slow" rather than "realtime
is entirely dead." A healthcheck cannot catch it either — the tenant is resolved
per connection, not at boot.

Test the handshake with **`--http1.1`**. HTTP/2 forbids the `Connection` header,
so curl drops it and realtime answers `400 'connection' header must contain
'upgrade'`, which looks like a gateway fault but is an artefact of the test:

```sh
curl -s --http1.1 -o /dev/null -D - \
  "https://$GW/realtime/v1/websocket?apikey=$ANON_KEY&vsn=1.0.0" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
# expect: 101 Switching Protocols, and `project=realtime-dev` in the service log
```

## 6. `functions`

| | |
|---|---|
| Build | repo root, `railway/functions/Dockerfile` — the context must be the **repo root** so `supabase/functions/_shared` is included |
| Domain | none |
| Healthcheck | `/healthz` |
| **`PORT=8000`** | **required** |

**Set `PORT=8000` explicitly.** Railway injects its own `PORT` and probes *that*
port, but the Dockerfile's `CMD` starts edge-runtime with a hardcoded `-p 8000`.
Left alone, the container is healthy and serving while Railway probes a port
nothing listens on, so the deploy fails with
`1/1 replicas never became healthy!` and **no error in the service log** — the
logs just stop at `Starting Container`. Same class of mismatch as storage
listening on 8080 (below).

```
SUPABASE_URL=${PUBLIC_URL}
SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
APP_URL=${SITE_URL}
STRIPE_SECRET_KEY=…            # 6.4
STRIPE_WEBHOOK_SIGNING_SECRET=…        # 6.4 — NEW secret; the old one will not verify
STRIPE_PRICE_MONTHLY=…
STRIPE_PRICE_SEMIANNUAL=…
STRIPE_PRICE_ANNUAL=…
TRIAL_PERIOD_DAYS=30
```

## 7. `gateway`

| | |
|---|---|
| Build | `railway/gateway/` |
| Domain | **the only service with a public domain** |
| Healthcheck | `/healthz` (deliberately does not touch the database) |

```
PORT=8000
GATEWAY_DOMAIN=<your public domain>
AUTH_HOST=auth.railway.internal:9999
REST_HOST=rest.railway.internal:3000
STORAGE_HOST=storage.railway.internal:8080   # 8080, NOT 5000 — see below
REALTIME_HOST=realtime.railway.internal:4000
FUNCTIONS_HOST=functions.railway.internal:8000
```

Every other service must stay private. The gateway is not a trust boundary —
each service verifies the JWT itself — but a public PostgREST or GoTrue is an
unnecessary attack surface, and a public `postgres` is a disaster.

**`STORAGE_HOST` is port 8080, not 5000.** storage-api honours Railway's injected
`PORT`, so it listens on 8080 here while the local compose stack has it on 5000.
Pointing the gateway at 5000 gives a 502 on every `/storage/v1/*` request, which
looks like a broken storage service rather than a wrong port.

### The gateway must answer CORS preflights (added 2026-08-20)

Hosted Supabase did this centrally in Kong. Caddy does not, and the backends
disagree about whose job it is: **PostgREST answers `OPTIONS` itself, but GoTrue
returns a bare `204` with no CORS headers, storage-api `404`s and edge-runtime
`400`s.** Since supabase-js sends a custom `apikey` header, every request is
non-simple and forces a preflight — so with no gateway handler, **sign-in is
impossible while data reads keep working.**

The symptom in the app is `Failed to fetch`, which is indistinguishable from a
wrong password to the user but is a network-layer failure: the request never
leaves the browser. A genuinely wrong password returns
`400 invalid_credentials`. **If auth breaks but `select` works, it is preflight.**

**Storage additionally needs CORS on its REAL responses** (found 2026-08-21).
storage-api sets none; PostgREST and the Deno functions set their own. The
Caddyfile therefore adds `Access-Control-Allow-Origin` +
`Access-Control-Expose-Headers` inside the **`/storage/v1/*` block only**.

Without it the browser blocks the *body* of `createSignedUrl`, supabase-js
returns `data: null`, and stored images render as though they were never
set — while **uploading still appears to work**, because `upload-media` returns
pre-signed URLs and sets its own CORS. The bug only shows after a reload.

Two rules when touching the `@cors_preflight` block in the Caddyfile:

1. **Keep it first.** `handle` and `handle_path` form one mutually-exclusive
   group evaluated in source order; below the routing blocks it never runs.
2. **Preflight only — never add CORS headers to real responses here.** The
   upstreams set their own, and a duplicate `Access-Control-Allow-Origin` is
   rejected by browsers. That would break `/rest/v1/*`, which already worked.

**`curl` does not preflight**, so this whole class of bug is invisible to
server-side verification. Test it explicitly:

```sh
curl -i -X OPTIONS "$GW/auth/v1/token?grant_type=password" \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: apikey,authorization,content-type'
# expect 204 with exactly ONE access-control-allow-origin
```

---

## Creating the services: what actually works

The CLI and the dashboard each fail differently here. What worked, in order:

- **`railway add --service X --image Y`** — reliable for the five image-based
  services, and the variables can be passed inline.
- **`railway add --service X --repo owner/name`** — **does not work.** Every
  GitHub-touching call from the CLI returns `Not Authorized`, including the
  `githubRepos` and `gitHubRepoAccessAvailable` queries. Re-running
  `railway login` does not fix it and neither does authorising the GitHub App;
  the public API simply does not serve GitHub integration to a CLI token.
- **Creating a repo service in the dashboard** — Railway *stages* the change, and
  it does not exist until you click **Deploy**. If the staged change is
  discarded, you are left with a service record that has **zero service
  instances**: it appears in `project.services` but not in
  `environment.serviceInstances`, and every operation against it fails with
  `Service Instance not found` or a bare `404` from `railway up`.
- **What finally worked:** `railway add --service X` with **Empty Service**,
  which does create a real instance, then `railway up --service X`.

**`railway up` ignores your working directory.** Run from `railway/gateway/`, it
still uploaded the repo root, found `package.json`, and built the Vite frontend
into a static Caddy site — a plausible-looking deploy of entirely the wrong
thing. Set `rootDirectory` and `dockerfilePath` on the service instance first:

```
railway api 'mutation { serviceInstanceUpdate(environmentId: "<env>", serviceId: "<svc>",
  input: {rootDirectory: "/railway/gateway", dockerfilePath: "Dockerfile",
          healthcheckPath: "/healthz"}) }'
```

There is no `DOCKERFILE` value in the `Builder` enum — setting `dockerfilePath`
is what selects it.

**Trust the API over the CLI for state.** During this deploy the CLI reported a
volume as "detached" and "deleted" while `environment.volumeInstances` showed it
attached and `READY`, and `railway service delete` silently did nothing. When
the two disagree, the GraphQL API has been right every time.

---

## 8. `backup` (cron)

| | |
|---|---|
| Build | `/railway/backup`, `Dockerfile` |
| Volume | `/backups` |
| Cron | `0 8 * * *` (02:00 MDT) |
| Restart policy | `NEVER` — a cron job that restarts on exit runs forever |
| Variables | `BACKUP_DB_URL` (internal DSN), `BACKUP_KEEP=14` |

Self-hosting gives up Supabase's automatic daily backups, and nothing else in
the stack notices their absence until a restore is needed. `backup.sh` dumps the
**whole** database — `auth.users` and `storage.objects` included, since a backup
that restores campaigns but not the users who own them is useless — gzips it to
the volume, and prunes to the newest 14.

**Do not set a `startCommand` on this service.** The image's `CMD` already runs
`backup.sh`. Once a `startCommand` has been applied, subsequent
`serviceInstanceUpdate` calls setting it to `null`, `""`, or a different path
**do not take effect** — the cron deployments keep using the first snapshot. The
only reliable fix found was deleting and recreating the service without ever
setting one (2026-08-20).

`postgres:17-alpine` cannot be used directly: its `ENTRYPOINT` is
`docker-entrypoint.sh`, which tries to initialise a cluster and exits with
*"Database is uninitialized and superuser password is not specified"* before any
command runs. Hence `ENTRYPOINT []` in the Dockerfile.

**Cron services do not run on deploy** — they wait for the schedule. To verify
one, temporarily set `*/5 * * * *`, watch the logs, then set the real schedule
back. An unverified backup is not a backup.

**Durability caveat:** the volume lives on the same provider as the database it
protects. That covers a bad migration or a dropped table, not the loss of the
Railway account or a region. Copying dumps off-platform is a PRE_LAUNCH item.

## 9. `migrate` (on-demand job)

| | |
|---|---|
| Build | `rootDirectory: "/"`, `dockerfilePath: railway/migrate/Dockerfile` |
| Trigger | **redeploying the service is the run** — no cron, no schedule |
| Restart policy | `NEVER` — a job that restarts on exit runs forever |
| Start command | **none.** It cannot be unset once set (see §8) |
| Variable | `MIGRATE_DB_URL` → `supabase_admin` over `postgres.railway.internal:5432` |
| Created | 2026-08-21, service `4ddeff7e-b382-4b58-a405-7ead912fdf9e` |

**Why it exists.** After the Phase 6 cutover, production is this stack, which has
no public database endpoint by design. Without a job service, every schema change
needs a TCP proxy opened by hand — a manual step in front of every migration,
which is precisely how migration 0023 came to be applied to hosted but never
committed (see `QA/6_tests/`). Phase 7 alone has four subphases of schema work.

**Usage:** add a file to `supabase/migrations/`, then

```sh
railway up --service migrate
```

Only new files run. `rootDirectory` is `/` because the Dockerfile copies both
`supabase/migrations/` and `railway/scripts/`, so it needs the repo root as build
context. Migrations are **baked into the image**, so the image *is* the schema
version: a deploy is reproducible and a rollback is redeploying an older image.

### Three things run on EVERY invocation, not only when a migration applies

1. **The grant sweep** (`railway/scripts/90_grant_app_privileges.sql`). No
   migration issues a table `GRANT` — hosted supplied them as project defaults —
   so a new table would arrive readable by nobody and the app would 401 on it.
   Unconditional, so a new table cannot ship ungranted. This is the §6.1 lesson
   encoded.
2. **An RLS assertion that fails the deploy.** A public table with RLS disabled
   fails **OPEN**: the app looks normal while every DM note is readable by anyone
   signed in. Nothing visibly breaks, so it is asserted rather than assumed. Any
   such table exits non-zero.

It also issues `notify pgrst, 'reload schema'` — without it a new table or column
404s with "relation does not exist" until PostgREST happens to restart, which
reads as a broken migration.

### Baselining — the one sharp edge

Tracking lives in `supabase_migrations.schema_migrations`, deliberately the same
table the Supabase CLI uses, so reaching for the CLI later agrees with what this
recorded instead of trying to replay everything.

The Railway database already had all 27 migrations applied **by hand** during
6.1/6.2, with nothing recording it. So when the tracking table is empty **and**
`public.campaigns` exists, the run treats the database as provisioned and
**records every existing file as applied without executing it** — re-running 27
migrations against live data is not something to leave to whether each one
happens to be idempotent. A genuinely empty database runs everything instead.
The decision is logged loudly in a banner, because silently picking the wrong
branch would be severe.

Both conditions are required, so it **cannot silently re-baseline** later: once
anything is recorded, that branch is unreachable.

**Verified 2026-08-21.** First run: `28 new, 0 already recorded`, all baselined,
both grant assertions returned 0 rows, RLS check OK. Immediate second run:
`0 new, 28 already recorded`, no baseline banner, grant sweep re-run, exit 0 —
so it is safe to redeploy at any time. (28 files, not 29: there is no `0018`,
which `0019_revert_encounters.sql` reverted.)

> Railway interleaves container stdout with its own lifecycle lines, so log
> output can appear **out of order** — `0025`/`0026` printed after the summary on
> the first run. Read the summary line, not the ordering.

---

### The RLS access-control matrix (Phase 8.2)

`railway/scripts/95_rls_matrix.sql` seeds a DM, two players, a non-member and
anon, then asserts the full read/write matrix — 63 assertions — inside a
transaction that never commits. On failure it raises, which aborts the
transaction and exits non-zero, so **a migration that loosens a policy cannot
deploy.**

This is the third check in the same family and the only behavioural one. The
other two are structural: RLS is enabled, and five named functions are not
executable by `authenticated`. Neither says anything about what the policies
actually allow.

Safe against production because nothing commits — verified by user and campaign
counts being unchanged after each run. Proven to catch a regression rather than
merely to pass: granting `anon` SELECT on `campaigns`, and disabling RLS on
`journal_entries`, are both detected.

## 10. Restoring a backup — the runbook

**Read this before restoring anything.** A restore is the one operation that can
silently undo a right-to-erasure request, and the protection is not fully
automatic.

### The flaw the procedure exists to close

The tombstone table (`public.deleted_accounts`, migration 0032) lets the migrate
job re-delete accounts a restore resurrected. But **it lives inside the database**,
so a backup taken *before* a deletion does not contain it:

```
T0  nightly backup taken        -> contains the user, NO tombstone
T1  user deletes their account  -> tombstone written
T2  you restore the T0 backup   -> user is back, tombstone is GONE
```

That is exactly the restore anyone would actually perform. The sweep then matches
nothing, and the person is back — able to sign in with their old password. The
in-database tombstone alone covers only the narrower case where the tombstone
itself survived.

So the erasure record must come from **outside** the restored data. Two sources,
in order of preference:

| Situation | Best source | Currency |
|---|---|---|
| Database still reachable (bad migration, bad data, botched deploy) | **Export it live, right now, before restoring** | to the second |
| Database is gone (volume lost, region failure) | `/backups/deleted-accounts-latest.sql` on the backup volume | to the last nightly run — **up to 24h of deletions may be missing** |

### Procedure

**Step 0a — copy the NEWER dumps somewhere else first.**

After a restore, the dumps taken *after* the snapshot you are restoring are the
only surviving record of what the restore is about to erase: who signed up, what
they wrote, what they paid. `BACKUP_KEEP=14` prunes **by count**, so the nightly
runs that follow will quietly push them off the volume while you are still
working out how big the gap was.

```sh
# from the backup volume, before restoring anything
cp /backups/tabletopchaos-<newer>.sql.gz  ~/restore-evidence/
cp /backups/deleted-accounts-latest.sql   ~/restore-evidence/
```

**Step 0b — if the database is still reachable, capture the erasure record.**
Do this before anything destructive. It is the only moment the list is complete.

```sh
psql "$DB_URL" -tAX -f railway/scripts/92_export_tombstones.sql > tombstones.sql
wc -l tombstones.sql   # sanity: one INSERT per erased account
```

**Step 1 — restore the dump.**

```sh
gunzip -c tabletopchaos-YYYYMMDD-HHMMSS.sql.gz | psql "$DB_URL"
```

**Step 2 — run the migrate job.** This applies any migrations the restored
snapshot predates (including 0032 itself, if the backup is old enough that
`deleted_accounts` does not exist yet), re-applies the grant sweep, and asserts
RLS.

```sh
railway up --service migrate
```

**Step 3 — re-import the erasure record.** From step 0 if you have it, otherwise
from the backup volume. The statements are `ON CONFLICT DO NOTHING`, so this is
idempotent and an older export can never clobber a newer record.

```sh
psql "$DB_URL" -f tombstones.sql
```

**Step 4 — run migrate AGAIN.** This is the step that actually re-deletes the
resurrected accounts, and it is **mandatory, not optional**. Between the restore
and this run, those accounts are live and can sign in.

```sh
railway up --service migrate
```

Expect `RE-DELETED n account(s)` in the log if any were resurrected, and
`erasure check OK` at the end. The deploy **fails** if a tombstoned account is
still present, so a silent failure here is not possible.

### What a restore can never put back

- **Storage files.** Deleted at erasure time and never present in a `pg_dump`, so
  restored `storage.objects` rows point at missing bytes. Broken images, not
  leaked data. The sweep reports the count and deliberately does not delete those
  rows — deleting a row strands the file, because that table is storage-api's
  index rather than the bytes.
- **Stripe subscriptions.** Cancelled at Stripe and not restorable. A restored
  `campaign_subscriptions` row can therefore claim `active` while Stripe says
  `canceled`, and no webhook will correct it. Harmless while `enforce_active` is
  false; **after that flip a restored campaign would get full access with no
  subscription behind it.** Reconcile every row against Stripe before flipping.

### Step 5 — reconcile Stripe in BOTH directions

The direction above (database says active, Stripe says cancelled) costs you
nothing but a wrong entitlement. **The opposite direction costs a customer
money**, and it is the one a restore creates when it predates an account or a
campaign:

| Direction | Symptom | Consequence |
|---|---|---|
| Row exists, Stripe cancelled | campaign looks paid | free access after the `enforce_active` flip |
| **Stripe active, no row** | nothing in the app at all | **the customer keeps being charged for something they cannot see** |

The second case is now recorded rather than lost: the webhook writes it to
`public.orphaned_subscriptions` (migration 0033) instead of swallowing the
foreign-key failure. Check it after any restore:

```sql
select stripe_subscription_id, stripe_customer_id, campaign_id, status,
       reason, seen_count, last_seen_at
from public.orphaned_subscriptions
order by last_seen_at desc;
```

A **rising `seen_count`** means Stripe is still sending events for it — the
subscription is live and still billing. For each row: cancel it in Stripe, and
refund what was taken after the restore. There is no automatic path, because
only you can decide between cancel, refund, or reinstate the campaign.

Then list active subscriptions in the Stripe dashboard and check every one has a
matching `campaign_subscriptions` row. `orphaned_subscriptions` only catches
subscriptions Stripe has sent an event about **since** the restore; a quiet
annual subscription may not emit one for months.

> **This is not only a restore problem.** `deleteCampaign` performs a plain
> database DELETE with **no Stripe cancellation**, so any DM who deletes a
> campaign while subscribed leaves a live subscription behind — the same orphan,
> arriving through the front door. Tracked in PLANNING; until it is fixed,
> `orphaned_subscriptions` will accumulate rows in normal use, not just after a
> restore.

### Residual gap, stated plainly

If the database is lost entirely, deletions made since the last nightly export
are unrecoverable as records — those accounts would come back and stay back. The
window is bounded by the backup schedule (`0 8 * * *`). Closing it further means
exporting more often than nightly; worth revisiting if real users are relying on
erasure.

---

## 11. `cleanup` (cron) — lapsed-campaign sweep

| | |
|---|---|
| Build | `railway/cleanup`, `Dockerfile` |
| Volume | none |
| Cron | `0 9 * * *` (daily, an hour after `backup`) |
| Restart policy | `NEVER` — a cron job that restarts on exit runs forever |
| Variables | `CLEANUP_URL`, `CLEANUP_SECRET`, `CLEANUP_DRY_RUN` |

**Created and verified 2026-08-26** (service `9bb84bc1-24e6-407a-81c6-95ad86018bdf`),
running daily in **dry-run with deletion disarmed**. Cron firing confirmed by
temporarily setting `*/5 * * * *`, watching one run, then restoring `0 9 * * *`:

```
cleanup: POST https://gateway-…/functions/v1/cleanup-campaigns (dryRun=true)
cleanup: HTTP 200
 dryRun=true deleteEnabled=false refreshed={"started":0,"cleared":0}
 onClock=0 dueForDelete=0 warned=[] deleted=[] skipped=[] errors=[]
cleanup: done
```

All three deletion switches remain off, so this reports and changes nothing.

This is the half of Phase 7.2 that makes the Refunds page true: *"a campaign that
has been read-only for three months is permanently deleted, and we email the
owner 30, 7 and 1 days before."* Until it runs, that sentence describes nothing,
which is why the page carries a DRAFT banner.

Scheduled **after** `backup` on purpose. If the sweep ever deletes something it
should not have, the most recent dump is from that morning and predates it.

### Why a cron service and not `pg_cron`

The work is not SQL. It cancels Stripe subscriptions, deletes Storage objects
and calls Resend — none of which Postgres can reach. The database holds only the
clock (`campaigns.read_only_since`, migration 0036); the `cleanup-campaigns` Edge
Function does everything that touches the outside world. `cleanup.sh` is one
`curl` and a status check, kept dumb enough that "the cron is wrong" is never a
plausible diagnosis.

### The clock never runs retroactively

`read_only_since` is set to `now()` the first time a sweep **observes** a
campaign as read-only. It is not derived from when the subscription actually
lapsed. This is load-bearing: while `enforce_active` is `false` every campaign is
"active", so the first sweep after the launch flip starts a fresh 90-day clock
for everybody — instead of finding a year of accumulated lapse and deleting the
entire database on day one.

### Three switches, all of which must be on

| Switch | Where | Default |
|---|---|---|
| `enforce_active` | `private.billing_config` | `false` |
| `lapse_delete_enabled` | `private.billing_config` | `false` |
| `CLEANUP_DELETE_ENABLED` | `functions` service env | unset |

Three rather than one because running this early is unrecoverable and running it
late costs nothing. With deletion off, clocks still tick and the in-app countdown
still shows — it says plainly that nothing will be deleted — so a full cycle can
be watched in production before anything irreversible is armed.

### The delivered-warning interlock

A campaign is never deleted unless its **final** warning was recorded, and
`lapse_warned_days` is written **only after Resend accepts the message**. So if
mail is broken, `due_for_delete` never becomes true and the sweep warns forever
without deleting anything.

That is not a theoretical safeguard. Until a sending domain is verified, Resend
delivers only to the Resend account owner's own address (PRE_LAUNCH §3) — every
other warning is silently dropped. Deleting somebody's campaign after a warning
that was never delivered is the exact failure this design exists to prevent.

### Variables

```
CLEANUP_URL=https://<gateway-domain>/functions/v1/cleanup-campaigns
CLEANUP_SECRET=<long random string>   # must match the functions service
CLEANUP_DRY_RUN=true                  # start here; false only after a full cycle
```

Unlike `backup` and `migrate`, this service builds from `railway/cleanup` with
`dockerfilePath: Dockerfile` — it needs nothing outside its own directory, and
giving a cron container a database URL it never uses is a credential lying
around for no reason.

Set on the **`functions`** service (done 2026-08-26):

```
CLEANUP_SECRET=<the same string>
CLEANUP_DELETE_ENABLED=false
RESEND_API_KEY=<resend key>
RESEND_FROM="TableTopChaos <notices@yourdomain>"
```

Set secrets with `railway variables --set-from-stdin`, never `--set` — the
latter echoes the value into the shell history and the deploy log.

`cleanup-campaigns` authenticates on `x-cleanup-key` (constant-time compare)
rather than a JWT: the caller is a cron container, not a user. An unset
`CLEANUP_SECRET` denies **every** request rather than allowing them — a
mass-delete endpoint has to fail closed.

### Verifying it

Cron services do not run on deploy. Temporarily set `*/5 * * * *`, watch, then
restore the schedule. With `CLEANUP_DRY_RUN=true` a run reports exactly what it
would have done and changes nothing except the clocks themselves (which is not
destructive, and a dry run against stale clocks tells you nothing).

A non-200, or a 200 carrying a non-empty `errors` array, fails the deploy. That
second case is the important one: undelivered warnings must not scroll past as a
green run.

## Order of operations

1. `postgres` with its volume → wait healthy
2. Apply `railway/init/00_*.sql`, then `railway/init/01_*.sh`
3. Bring up **`auth` and `storage`**, and **wait for both to finish migrating
   their own schemas** before going further. Verify explicitly:
   ```sql
   select to_regclass('auth.users')      is not null as auth_ready,
          to_regclass('storage.buckets') is not null as storage_ready;
   ```
   Both must be `t`. Neither table is created by our migrations — GoTrue and
   storage-api each create their own on first boot, and nothing sequences that
   against the replay.

   **This is not optional and the failure is confusing.** 18 FKs target
   `auth.users`, and migration **0008 inserts the `media` bucket into
   `storage.buckets`**, so replaying early dies with
   `relation "storage.buckets" does not exist` — which reads as a broken
   migration rather than a race. (Observed 2026-08-19 on the PG17 rebuild: the
   replay reached 0008 before storage-api had booted and stopped at 7 of 28.)
4. Replay all 28 migrations in order
5. Run `railway/scripts/90_grant_app_privileges.sql` — after storage exists, so
   one pass now covers both `public` and `storage`
6. `rest`, `realtime`, `functions`, `gateway`
7. `notify pgrst, 'reload schema'`
8. Repeat the 6.1.2 gates against the public domain

## Gates (6.3.2)

- The five gateway prefixes return no 404s.
- `auth.uid()` resolves from `request.jwt.claims`.
- 100 policies; **zero** `public` tables with RLS disabled.
- Healthchecks green on `gateway` and `functions`.
- **A redeploy preserves data** — the check that proves the volumes are real.
  Deploy twice and confirm the row counts survive.
