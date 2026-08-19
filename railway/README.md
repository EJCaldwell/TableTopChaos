# Self-hosted Supabase stack on Railway

Owns: the infrastructure definition for running this project's backend on Railway
instead of hosted Supabase, at ~zero marginal cost given an existing Railway plan.

**Why this shape:** the app's real access-control layer is 100 Row-Level Security
policies across 27 migrations, keyed on `auth.uid()` (30 references). Those policies
only work if something authenticates each request and sets `request.jwt.claims` on
the Postgres connection. Hosted Supabase does that via PostgREST + GoTrue; so does
this stack. Rewriting to a bare Postgres + hand-written API would discard all 100
policies and the four-role QA matrix that validates them — see
[docs/RAILWAY_MIGRATION.md](../docs/RAILWAY_MIGRATION.md) for the trade-off.

## The critical constraint: one origin

`@supabase/supabase-js` derives every sub-path from the single URL it is given:

| Client call | Path it requests |
| --- | --- |
| `supabase.from(...)` | `/rest/v1/*` |
| `supabase.auth.*` | `/auth/v1/*` |
| `supabase.storage.*` | `/storage/v1/*` |
| `supabase.channel(...)` | `/realtime/v1/*` |
| `supabase.functions.invoke(...)` | `/functions/v1/*` |

So the five backend services **must sit behind one gateway on one hostname**. That
gateway is the whole reason the frontend needs no code changes. Hosted Supabase uses
Kong; this stack uses Caddy ([gateway/Caddyfile](gateway/Caddyfile)) because it is a
single small container with automatic TLS and no separate declarative config to
maintain.

## Services

Create these as separate Railway services in one project, on a shared private network.

| Railway service | Image | Notes |
| --- | --- | --- |
| `postgres` | `supabase/postgres:17.6.1.165` | Matches the hosted project's **PostgreSQL 17.6** — keep these majors in step (see below). **Not** Railway's stock Postgres — this image ships the `anon` / `authenticated` / `service_role` roles, the `auth` and `storage` schemas, and the extensions the migrations assume (`pgcrypto`, `uuid-ossp`, `pg_graphql`). Attach a volume at `/var/lib/postgresql/data`. |
| `gateway` | build from [gateway/](gateway/) | **The only service with a public domain.** Everything else stays private. |
| `rest` | `postgrest/postgrest:v12.2.3` | Serves all 45 `supabase.from()` call sites. Enforces RLS. |
| `auth` | `supabase/gotrue:v2.170.0` | Issues the JWTs that make `auth.uid()` resolve. |
| `storage` | `supabase/storage-api:v1.11.13` | Required — see "Why not plain S3" below. |
| `realtime` | `supabase/realtime:v2.34.7` | Backs `useRealtimeRefresh.ts`. |
| `functions` | build from [../supabase/functions/](../supabase/functions/) | The 7 Edge Functions as one Deno service. |

Pin these tags. Floating `latest` on a self-hosted stack means an unannounced
breaking change lands during a deploy you did not intend as an upgrade.

### Keep Postgres on the same major as the source

This originally specified `15.8.1.060` while the hosted project ran **17.6**.
The gap surfaced immediately in the 6.2 restore: PostgreSQL 17's `pg_dump`
writes `SET transaction_timeout = 0` into every dump's preamble, and 15 rejects
it as an unrecognised parameter, aborting the restore on line 13. That
particular one is easy to strip, but each new major adds more preamble GUCs and
more type/catalog differences, so the workaround is a recurring tax with a
growing failure surface — and a restore is the *worst* place to discover an
incompatibility, because it is the step you reach for when something has already
gone wrong.

Repinned to `17.6.1.165` on 2026-08-19 to match. If the hosted project is ever
upgraded before cutover, move this tag with it.

### Why not plain S3/R2 for media

[migration 0008](../supabase/migrations/0008_media_pipeline.sql) puts an **RLS policy
on `storage.objects`**, joining back to campaign membership. Media access control is
enforced in Postgres, not in app code. Swapping in raw S3 would silently drop that
policy and expose every campaign's images to any authenticated user who can guess a
path. `storage-api` keeps the policy in force.

`storage-api` can still use R2 as its *backing store* (`STORAGE_BACKEND=s3` with an
R2 endpoint) while continuing to enforce the policy — that is the cheap option if
media volume ever grows. Current usage is 3 MB across 106 objects, so a Railway
volume (`STORAGE_BACKEND=file`) is fine for now.

## Secrets

One shared `JWT_SECRET` (≥32 chars) ties the stack together: GoTrue signs with it;
PostgREST, Storage, and Realtime verify with it. `ANON_KEY` and `SERVICE_ROLE_KEY`
are **not** random strings — they are JWTs signed with that same secret, carrying
`{"role": "anon"}` and `{"role": "service_role"}`. Generate all three with
[scripts/gen-keys.mjs](scripts/gen-keys.mjs).

Set them as Railway **shared variables** so every service references one value.
Rotating `JWT_SECRET` invalidates both keys and every live session — plan it as a
deliberate, all-services redeploy.

## Local verification first

[docker-compose.yml](docker-compose.yml) brings the identical stack up locally. Run
the migrations and the access-control matrix there before you touch Railway or DNS —
the gateway routing and the `auth.uid()` wiring are the two things most likely to be
wrong, and both fail identically in either environment.

Per project convention this repo's dev server is yours to run on port 5173; the
compose stack binds the backend to 8000 and touches nothing on 5173.
