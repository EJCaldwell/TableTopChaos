# QA — Local stack pre-flight

**Phase:** 6.1. Run entirely **locally** before any Railway service exists — the two
things most likely to be wrong (gateway prefix stripping and the `auth.uid()` claim
wiring) fail identically here, where the loop is seconds instead of a deploy.

Re-run this same checklist against the Railway domain as 6.3.2.

**Prerequisites**
- Docker running; `psql` v15+.
- `railway/.env.stack` filled from `railway/scripts/gen-keys.mjs` (the three secrets
  are cryptographically linked — hand-writing them is the most common cause of a
  stack where every request 401s).

---

## Steps

- [ ] **Stack boots.** All 7 services reach healthy:
      `docker compose -f railway/docker-compose.yml --env-file railway/.env.stack up -d`
- [ ] **Init ran before migrations.** Roles and helpers exist on the empty volume:
      ```sql
      select rolname from pg_roles
       where rolname in ('anon','authenticated','service_role','authenticator');
      select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'auth' and proname in ('uid','jwt','role','email');
      ```
      Expect 4 roles and 4 functions.
- [ ] **All 27 migrations apply, zero errors**, in filename order with
      `ON_ERROR_STOP=1`. Watch **0008** — it inserts the `media` bucket and defines
      the `storage.objects` policy, so it needs `storage-api` to have migrated its
      schema first. If 0008 fails, confirm the storage service came up.
- [ ] **`auth.uid()` resolves — the gate for all 100 policies.** Must return the
      UUID, not NULL:
      ```sql
      begin;
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
      select auth.uid(), auth.role();
      rollback;
      ```
- [ ] **Gateway routes with the prefix stripped.** No 404s (401 is fine — it means
      the service answered):
      ```
      curl -s -o /dev/null -w '%{http_code} rest\n'  "http://localhost:8000/rest/v1/?apikey=$ANON_KEY"
      curl -s -o /dev/null -w '%{http_code} auth\n'  http://localhost:8000/auth/v1/settings
      curl -s -o /dev/null -w '%{http_code} func\n'  http://localhost:8000/functions/v1/healthz
      curl -s -o /dev/null -w '%{http_code} store\n' http://localhost:8000/storage/v1/bucket
      ```
      A 404 here means `handle` was used instead of `handle_path` in the Caddyfile.
- [ ] **A real signed-in round trip.** Create a user via `/auth/v1/signup`, then use
      the returned access token for a `/rest/v1/` read. This is the only check that
      exercises GoTrue → JWT → PostgREST → RLS end to end.
- [ ] **All 7 Edge Functions boot.** Each responds (not 404) through
      `/functions/v1/<name>`; the router's allow-list rejects an unknown name with
      404 rather than booting an arbitrary directory.
- [ ] **`npm run build` clean** with `VITE_SUPABASE_URL=http://localhost:8000`.

## Pass criteria

Stack healthy, 27/27 migrations clean, `auth.uid()` non-NULL, zero 404s on the four
gateway paths, the signed-in round trip returns data, all 7 functions reachable, and
the build is clean.

**`auth.uid()` returning NULL is a stop-the-line failure** — every later result in
this phase would be meaningless, since all 100 policies would evaluate against a null
identity.

## Run log

_No runs yet._
