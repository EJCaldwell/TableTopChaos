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
| Volume | **`/var/lib/postgresql/data` — without this a redeploy wipes the database** |
| Domain | none (private) |
| Variables | `POSTGRES_PASSWORD`, `POSTGRES_DB=postgres`, **`PGDATA=/var/lib/postgresql/data/pgdata`** |

**`PGDATA` must point at a SUBDIRECTORY of the mount, not the mount itself.**
Railway volumes are formatted filesystems and arrive containing a `lost+found`
directory, so `initdb` refuses to use the mount point:

```
initdb: error: directory "/var/lib/postgresql/data" exists but is not empty
initdb: detail: It contains a lost+found directory, perhaps due to it being a mount point.
```

The service then crashloops. Setting `PGDATA` one level deeper gives initdb an
empty directory to own while the data still lives on the volume. (Hit on the
first deploy, 2026-08-19.)

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
STRIPE_WEBHOOK_SECRET=…        # 6.4 — NEW secret; the old one will not verify
STRIPE_PRICE_MONTHLY=…
STRIPE_PRICE_SEMIANNUAL=…
STRIPE_PRICE_ANNUAL=…
TRIAL_PERIOD_DAYS=14
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
