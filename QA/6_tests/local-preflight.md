# 6.1 — Local stack pre-flight

Runs the identical 7-service stack under Docker on the developer machine before
anything touches Railway or the live project. Everything here is automated; no
browser steps, so no user-run checklist accompanies this area.

Source under test:
- [railway/docker-compose.yml](../../railway/docker-compose.yml)
- [railway/init/00_roles_and_auth_helpers.sql](../../railway/init/00_roles_and_auth_helpers.sql)
- [railway/init/01_stack_login_roles.sh](../../railway/init/01_stack_login_roles.sh)
- [railway/scripts/90_grant_app_privileges.sql](../../railway/scripts/90_grant_app_privileges.sql)
- [railway/gateway/Caddyfile](../../railway/gateway/Caddyfile)
- [railway/functions/main/index.ts](../../railway/functions/main/index.ts)
- All 27 files in [supabase/migrations/](../../supabase/migrations/), unmodified

## Gates

| # | Gate | Why it matters |
|---|------|----------------|
| 1 | All 7 services reach `Up` | A crashlooping service fails the same way on Railway, where the loop is a deploy instead of seconds |
| 2 | `auth.users` and `storage.objects` exist **before** the migration replay | 18 FKs target `auth.users`, which GoTrue creates on first boot; nothing orders the replay after that |
| 3 | 27/27 migrations apply with `ON_ERROR_STOP=1` | 0008 is the one to watch — it policies `storage.objects` |
| 4 | Grant pass: both verification queries return no rows | Catches "no table privileges" and "granted but RLS off" |
| 5 | PostgREST schema cache reloads to non-zero relations | A zero-relation cache 404s writes and looks like a routing bug |
| 6 | `auth.uid()` resolves from `request.jwt.claims` | The linchpin for all 100 policies |
| 7 | Exactly 100 policies; every `public` table has RLS | The `get_advisors` substitute |
| 8 | Gateway returns no 404s on the five real prefixes | Catches `handle` vs `handle_path` |
| 9 | `npm run build` clean **and** the bundle contains the local origin | A build that silently used the old hosted URL passes gate 9's first half alone |
| 10 | End-to-end four-role matrix through the gateway | Subsumes 6–8; exercises GoTrue → JWT → PostgREST → RLS as one path |

---

## Run log

### 2026-08-18 — PASS (all 10 gates), after fixing 5 defects in the scaffolding

The scaffolding had never been run. Standing it up found five defects, all of
which would otherwise have surfaced as a mystery on Railway. Numbers below are
from the final clean rebuild (`down -v` → `up -d` → replay → grant → reload).

**Gate 1 — services.** All 7 `Up`, `postgres` healthy. Three needed fixes first:

- **`auth`, `rest`, `realtime` crashlooped on password auth.** Root cause:
  `supabase/postgres:15.8.1.060` does **not** match the compose file's
  assumptions. Verified against a fresh volume: its superuser is
  `supabase_admin`, there is **no `postgres` role at all**, and the pre-created
  `authenticator` has **no password** (`User "authenticator" has no password
  assigned`). Four services connect as `postgres://postgres:…` and PostgREST as
  `authenticator`, so all of them failed. Fixed by adding
  [`railway/init/01_stack_login_roles.sh`](../../railway/init/01_stack_login_roles.sh),
  which creates `postgres` and passwords `authenticator`. Fixed there rather
  than by repointing compose at `supabase_admin`, which would put four services
  on the image's own superuser and fork this stack from the documented Supabase
  self-host layout.
- **The healthcheck probed as `postgres`**, a role that does not exist during
  init, so the container reported unhealthy for the whole init window and took
  every dependent service down with it. Now probes `supabase_admin`.
- **`realtime` hard-failed with `(RuntimeError) APP_NAME not available`** before
  logging anything useful. `APP_NAME: realtime` added to compose.
- **First fix attempt failed on `psql -c "… password :'pw'"`.** psql only
  substitutes `:'var'` in scripts it parses; with `-c` the literal reaches the
  server. Rewritten to pass SQL on stdin. Noted because the symptom (a syntax
  error pointing at `:'pw'`) reads like a quoting problem in the password.

**Gate 2 — prerequisites.** `auth.users` and `storage.objects` both present
before the replay; `auth.uid()` returns NULL when signed out, as designed. This
gate is not in PLANNING.md and was added here: the FK dependency on GoTrue's
boot is real and nothing enforces the ordering.

**Gate 3 — migrations.** 27/27 applied, zero errors. 0008 applied cleanly.

**Gate 4 — grants.** *The most serious finding of the pre-flight.* Not one of
the 27 migrations issues a table `GRANT` — they grant `EXECUTE` on functions
only, because hosted Supabase supplies table privileges as project defaults.
On the self-hosted stack the result was that **every query failed**, signed-in
users included, with `permission denied for table campaigns`. Proven at both
layers: `set local role authenticated` + a real JWT claim still raised
permission denied in SQL, and REST returned `42501` for anon.

This is worth stating plainly: the stack booted green, all 7 services healthy,
100 policies in place — and the app would not have worked at all. RLS was never
reached, because Postgres checks table privileges first.

Fixed in two places, deliberately overlapping: `alter default privileges` in
`01_stack_login_roles.sh` (covers anything created later) and an explicit sweep
in [`90_grant_app_privileges.sql`](../../railway/scripts/90_grant_app_privileges.sql)
(covers what already exists, e.g. after a restore). Both verification queries —
"table without authenticated select" and "table granted but RLS disabled" —
returned **no rows**.

**Also fixed while here:** realtime was creating its internal tables (`tenants`,
`extensions`, `schema_migrations`) **in `public`**, where PostgREST serves them
and where the new grant pass would have handed `anon` read access to `tenants`,
which stores a tenant JWT secret. Those tables carry no RLS and never will.
Fixed with `create schema _realtime` plus `DB_AFTER_CONNECT_QUERY`. Confirmed
afterwards: zero realtime tables in `public`. Had the grants been added without
noticing this, the fix for one problem would have created a worse one.

**Gate 5 — schema cache.** PostgREST booted before the migrations ran and
cached `0 Relations`, answering `POST /rest/v1/campaigns` with a bare `404` and
`{}` while `GET` still returned `[]` — which looks exactly like a gateway
routing fault. `notify pgrst, 'reload schema'` → `34 Relations, 40
Relationships, 29 Functions`. Runbook step added.

**Gate 6 — `auth.uid()`.** Returns
`11111111-1111-1111-1111-111111111111` from `request.jwt.claims`;
`auth.role()` returns `authenticated`. The linchpin holds.

**Gate 7 — policy audit** (the `get_advisors` substitute):

| Metric | Measured | Expected |
|---|---|---|
| Policies in `public` + `storage` | **100** (99 + 1) | 100 |
| Tables in `public` | 29 | — |
| `public` tables **without** RLS | **0** | 0 |
| Tables with `rowsecurity = true` | **34** | PLANNING says 30 — see below |

PLANNING.md's 6.5.2 gate of "exactly 30 tables with `rowsecurity = true`" is an
estimate made before a stack existed. The real figure is 34: 29 in `public`
plus 5 in `storage`, all created and policed by storage-api. **Use 34.** The
count that actually matters, and the one to assert at cutover, is that zero
`public` tables have RLS disabled.

**Gate 8 — gateway routing.** No unintended 404s:
`auth /settings` 200 · `functions /healthz` 200 · `/healthz` 200 ·
`rest /` 400 · `storage /bucket` 400 · unknown path 404 (correct).
A 400/401 means the service answered — only a 404 indicates a prefix-strip
mistake. Realtime's WebSocket returns 403 to a plain HTTP GET without upgrade
headers, which is also "the service answered"; a genuine socket test needs a
browser and is deferred to the 6.3 Realtime regression against the Phase 4.4
run log.

**Gate 9 — build.** Clean, 147 modules, `built in 3.48s`, bundle 669.51 kB.
Verified the bundle *actually* contains `localhost:8000` and no
`*.supabase.co`, rather than trusting a clean exit — env vars were passed
inline so the dev server's `.env` on :5173 was never touched. `dist/` was
rebuilt afterwards with the normal env so no local-gateway artifact is left.

**Gate 10 — end-to-end four-role matrix through the gateway.** Two users signed
up via GoTrue, then with their real bearer tokens:

| Actor | Action | Result |
|---|---|---|
| user A | read own `profiles` row | 1 row — the signup trigger fired |
| user A | `POST` campaign | **201**, row returned, `game_mode` defaulted to `notetaker` |
| user A | read own campaign | 1 row |
| user B (non-member) | read campaigns | **`[]`** |
| signed-out (anon key) | read campaigns | **`[]`** |
| user B | `PATCH` A's campaign to "Hijacked" | **0 rows affected** |
| user B | read `dm_notes` | **`[]`** |

`[]` rather than `401` is the correct denial here and worth understanding: the
privilege exists, and the policy filtered every row. A `401` at this point would
mean the grants were missing again.

**Not covered by this area.** Realtime over a real WebSocket, Storage uploads
through the API, and the Edge Functions doing actual work — all three need
either a browser or credentials this subphase deliberately does not have
(Stripe is blank until 6.4). They are gated in 6.3.
