# QA 6.5 — Cutover & decommission

Covers the move of the **running frontend** from hosted Supabase onto the
self-hosted Railway stack: backups in place, the `.env` flip, access-control
re-verification, and decommissioning the old project.

Per [PLANNING.md](../../PLANNING.md) Phase 6.5. Prior areas: 6.1–6.4 all **PASS**
(see [README.md](README.md)).

**Substitution, as required by this phase's README:** there is no
`get_advisors` for a self-hosted stack. Area C below replaces it with something
arguably stronger — a live per-table probe of what an unauthenticated caller can
actually read, rather than an inspection of whether policies exist.

---

## Area A — Backups (must exist *before* cutover)

Run by Claude, 2026-08-20. **PASS.**

| Check | Result |
|---|---|
| `backup` cron service deployed from [railway/backup/Dockerfile](../../railway/backup/Dockerfile) | PASS |
| Schedule `0 8 * * *`, only scheduled service in the project | PASS |
| Dedicated volume mounted at `/backups` | PASS |
| Forced run (temporary `*/5 * * * *`) produced a dump | PASS — **50,540 bytes** |
| Retention pruning to `BACKUP_KEEP=14` | PASS |
| Dumps whole DB (`auth`, `storage`, not just `public`) | PASS — by `pg_dump` of the database, no `-n` |
| Small-dump guard fails the deploy rather than succeeding silently | PASS — `exit 1` under 20,000 bytes |
| Schedule restored to `0 8 * * *` afterwards | PASS |

Three platform behaviours found, all now documented in
[railway/DEPLOY.md](../../railway/DEPLOY.md) §8:

1. `postgres:17-alpine` cannot be used directly — its entrypoint tries to
   initialise a cluster and exits before any command runs. Hence `ENTRYPOINT []`.
2. **Cron services do not run on deploy.** A forced short schedule is the only
   way to prove one works.
3. **`startCommand` cannot be unset once set** — `null`, `""` and a different
   path were all silently ignored. The service had to be deleted and recreated.

**Not covered, tracked in [PRE_LAUNCH.md](../../PRE_LAUNCH.md):** the dumps sit on
the same provider as the database (no protection against account/region loss),
and no dump has ever been restored. A backup that has never been restored is a
guess.

---

## Area B — Data refresh: assessed, then deliberately **skipped**

Run by Claude, 2026-08-20. **PASS (no action needed).**

The plan assumed a fresh dump would be required at cutover because the two
stacks had diverged since the 6.2 migration (2026-08-18). Measured rather than
assumed, and the assumption was wrong — **Railway already holds every real row.**

| Table | Hosted | Railway | Verdict |
|---|---|---|---|
| campaigns | 9 | 8 | hosted-only row is `Stripe Test` |
| campaign_members | 13 | 12 | that campaign's owner membership |
| campaign_subscriptions | 6 | 5 | that campaign's subscription |
| profiles | 5 | 5 | match |
| characters | 6 | 6 | match |
| `storage.objects` | 106 | 106 | match, newest 2026-07-29 |

A dynamic sweep of every `public` table with a `created_at`/`updated_at` column,
looking for writes after the migration, found **only billing tables**:
`campaigns` (1), `campaign_members` (1), `campaign_subscriptions` (4). No content
table — `characters`, `dm_notes`, `journal_entries`, `npcs`, `encounters`,
`quests`, `media_assets` — was touched.

All 8 real campaigns are present on Railway with **identical UUIDs and
`created_at` values**. The single hosted-only campaign (`4218fb13…` "Stripe
Test", created during 6.4) is already on the PRE_LAUNCH §4 wipe list, so
importing it would carry test data onto the new stack for no benefit.

### One genuine field-level divergence

`ef7a2a34…` ("Test idk") — `trial_blocked_reused_card` is `false` on hosted and
**`true` on Railway**.

Both webhook endpoints were enabled during 6.4, so the same Stripe event reached
both databases; but the reused-card check reads `trial_redemptions` **in its own
database**, and the card had already been redeemed on Railway. **Railway holds
the more correct value** — its anti-abuse path worked and hosted's did not
record the block. This is evidence *for* the stack being kept, and another
reason not to overwrite it from hosted.

---

## Area C — Access control on the live stack (replaces `get_advisors`)

Run by Claude, 2026-08-20, against
`https://gateway-production-85a0.up.railway.app`. **PASS.**

PostgREST's OpenAPI root reported **29 exposed tables**, matching the 29-table
`public` baseline in [README.md](README.md) — so nothing is exposed that
shouldn't be, and nothing expected is missing.

Each table was then counted three ways: as `service_role`, as `anon`, and with
**no API key at all**.

**Result: 29/29 tables returned rows to `service_role` and zero rows to both
`anon` and keyless callers.** The service-role column is what makes this
meaningful — an all-zeroes probe would otherwise be indistinguishable from a
broken test. Tables carrying data included `dm_notes` (7), `journal_entries` (5),
`campaigns` (8), `profiles` (5), `sheet_fields` (45) and `trial_redemptions` (2).

Writes were checked too, not just reads:

| Probe | Result |
|---|---|
| keyless `POST /campaigns` | **401**, `42501` — RLS refused the row |
| keyless `GET /storage/v1/bucket` | **400** — authorization header required |
| `/auth/v1/health` | 200 |

### Finding: the gateway does not require an `apikey` header

A keyless request returns **`200`, not `401`**. Hosted Supabase's Kong rejected
these outright; Caddy forwards them and PostgREST runs them as `anon`.

**Not a leak** — every table was probed keyless above and returned nothing, and
keyless writes are refused. But RLS is now the *only* barrier rather than the
second one: the outer fence that rejected anonymous traffic before it reached the
database is gone. Any future table shipped with RLS disabled, or an overly broad
`anon` policy, would be exposed to the open internet rather than merely to
key-holders. Logged as a decision in [PRE_LAUNCH.md](../../PRE_LAUNCH.md) §3 —
either add an `apikey` matcher to the Caddyfile, or accept it and treat the
"zero public tables with RLS disabled" gate as permanent.

### Gate note

PLANNING's 6.5.2 gate asks for a `pg_policies` audit. That needs a direct
database connection, which means a temporary TCP proxy on the `postgres`
service — deliberately absent at rest, since it exposes Postgres to the
internet. The probe above tests the same failure mode from the outside and is
better evidence: it measures what an attacker can actually read, not whether
policies are present. **The 100-policy / 34-table count remains verified only as
of the 6.2 local baseline** and should be re-asserted directly if a future
migration changes RLS.

---

## Area D — Frontend flip

Done by the user, 2026-08-20. Verified by Claude. **PASS.**

[.env](../../.env) now points at the gateway:

| Check | Result |
|---|---|
| `VITE_SUPABASE_URL` = gateway origin | PASS |
| No trailing slash, space or quotes on the URL | PASS — would break every derived sub-path |
| `VITE_SUPABASE_ANON_KEY` byte-identical to Railway's `ANON_KEY` | PASS |
| Old hosted pair retained as commented rollback | PASS |

Railway reuses the **same `JWT_SECRET`** as the local compose stack, so
`railway/.env.stack.production`'s `ANON_KEY` is the correct production value —
there is no separately generated Railway key to hunt for.

Note the two values must always move **together**: each stack signs JWTs with
its own secret, so a Railway URL with the hosted key (or the reverse) returns
`401` on every request.

---

## Bug found by the user at cutover: CORS preflight — **FIXED**

Reported 2026-08-20 as "the password failed to fetch" while signing in. Not a
credential problem: **"Failed to fetch" is a network-layer failure, so the
password never reached the server.** A wrong password returns a clean
`400 invalid_credentials`, confirmed directly against the endpoint.

**Root cause.** Hosted Supabase answered CORS preflights centrally in Kong.
Caddy replaced Kong and did not, and the backends disagree about whose job it
is. Measured per route:

| Route | `OPTIONS` before fix |
|---|---|
| `/rest/v1/*` | `200` + CORS — PostgREST answers preflight itself |
| `/auth/v1/*` | **`204`, no CORS headers** — GoTrue expects a gateway to do it |
| `/storage/v1/*` | **`404`** |
| `/functions/v1/*` | **`400`** |

supabase-js sends a custom `apikey` header, which makes every request
non-simple and forces a preflight. With no `Access-Control-Allow-Origin` on
that preflight the browser blocked the real request before sending it.

**The asymmetry is the diagnostic**: data reads worked while auth could never
work. Anything that breaks sign-in but not `select` is a preflight problem, not
a credentials or RLS problem.

**Why the server-side QA in Area C missed it entirely:** `curl` does not
preflight. Every probe there was correct and every one passed, because CORS is
enforced by the *browser*, not the server. This is a concrete instance of the
division of labour in CLAUDE.md — no amount of server-side verification
substitutes for the user opening the app, and the first genuinely browser-only
step found a total outage in under a minute.

**Fix** — a preflight handler in
[railway/gateway/Caddyfile](../../railway/gateway/Caddyfile), placed before the
routing blocks (`handle`/`handle_path` form one mutually-exclusive group
evaluated in source order, so it must come first to claim `OPTIONS`). Two
deliberate constraints:

- **Preflight only.** Real responses keep the upstream's own CORS headers —
  GoTrue, PostgREST and the Deno functions (via `_shared/cors.ts`) all set their
  own. Adding them at the gateway too would emit a **duplicate**
  `Access-Control-Allow-Origin`, which browsers reject outright: that would have
  broken `/rest/v1/*`, which already worked.
- **`Access-Control-Allow-Headers` echoes the request** instead of enumerating.
  The union across services is wide (`prefer`, `accept-profile`,
  `content-profile`, `range`, `x-upsert`, `x-client-info`) and one omission
  breaks a single feature quietly. Reflection cannot under-specify and leaks
  nothing: origin is already `*`, and clients authenticate with a bearer token
  rather than cookies.

**Verification after deploy — PASS.**

| Check | Result |
|---|---|
| `caddy validate` before deploy | PASS |
| Preflight on auth / signup / rest / storage / functions | **204 on all 5** |
| `Access-Control-Allow-Origin` count on each preflight | **exactly 1** — no duplicates |
| `Allow-Headers` echoes `apikey,authorization,content-type,x-client-info` | PASS |
| Real `POST` sign-in still single-ACAO | PASS — `400 invalid_credentials`, count 1 |
| Real `GET /rest/v1/campaigns` still single-ACAO | PASS — `200`, count 1 |

---

## Bug found by the user at cutover: realtime totally dead — **FIXED**

Reported 2026-08-21: an HP change needed a manual refresh before the DM saw it.
Not intermittent — **every** WebSocket connection was being rejected:

```
TenantNotFound: Tenant not found: gateway-production-85a0
```

**Root cause.** Realtime v2 is multi-tenant. It derives a tenant id from the
**first label of the Host header** and looks it up in `_realtime.tenants`. Caddy
preserves the client's Host by default, so it asked for the public domain's first
label — `gateway-production-85a0` — which does not exist. The tenant that *does*
exist is created by the image's own seed (`SEED_SELF_HOST=true`), named from
`SELF_HOST_TENANT_NAME` with a default of **`realtime-dev`** (read from
`priv/repo/seeds.exs` in `supabase/realtime:v2.34.7`, not guessed).

The 6.1 pre-flight created the `_realtime` schema but never asserted that a
usable tenant existed, and the publication `supabase_realtime` was fine
throughout (created in `railway/init/00_roles_and_auth_helpers.sql`, with
migration 0027 adding the five tables) — so nothing upstream of the tenant was
at fault. **Writes always worked; only the live channel was dead**, which is
exactly why a refresh showed the change and made this look like a lag rather
than an outage.

**Fix** — `header_up Host realtime-dev.internal` on the realtime upstream in
[railway/gateway/Caddyfile](../../railway/gateway/Caddyfile). Chosen over setting
`SELF_HOST_TENANT_NAME` to the Railway subdomain **deliberately**: it keeps the
tenant name independent of the public domain, so putting a custom domain in front
later cannot silently break realtime again. It is also what hosted Supabase's
Kong does. Only the first label is parsed; the suffix is arbitrary and never
resolved.

**Verification — PASS.** `101 Switching Protocols` on a handshake through the
gateway, and the realtime log switched from `TenantNotFound` to
`project=realtime-dev` with normal connection metrics.

> **Testing note:** the handshake must be tested with `--http1.1`. HTTP/2
> forbids the `Connection` header, so curl silently drops it and realtime
> answers `400 'connection' header must contain 'upgrade'` — which looks like a
> gateway fault and is purely an artefact of the test.

---

## Media: reported as "pictures didn't get ported over" — **not reproduced; nothing lost**

Investigated 2026-08-21 after the user noted images appeared to be missing.
**All media migrated correctly**, verified four ways:

| Check | Result |
|---|---|
| `storage.objects` byte total, Railway vs hosted | **3,044,130 = 3,044,130** exactly (after subtracting a new upload) |
| Objects with zero/missing size | **0** — no truncated re-uploads |
| `media_assets` paths (`storage_path` + `thumb_path`) resolving to a real file | **31/31 rows, 0 missing** |
| Dangling `portrait_asset_id` / `encounter_images.asset_id` references | **0 of 4 refs** |

The apparent absence is explained by hosted's own data, not by the migration:

| Reference | Hosted | Railway |
|---|---|---|
| `characters.portrait_asset_id` set | 3 of 6 | 3 of 6 (+1 new upload) |
| `npcs.portrait_asset_id` set | **0 of 12** | **0 of 12** |
| `encounter_images` rows | **0** | **0** |

**NPCs never had portraits and encounters never had images — on hosted either.**
Nothing was lost; there was nothing there to port. Half the character sheets
have no portrait for the same reason.

The 46 files with no owning `media_assets` row all sit under a deleted campaign
(`e3b1cf97…`) and are the **same 46 orphans identified in 6.2** — consistent, and
the reason the migration deliberately copied everything rather than filtering.

The upload path was separately proven healthy end to end (see below), and the
user confirmed uploading a photo in the app works.

### Upload path, verified server-side with a minted JWT

| Input | Result |
|---|---|
| 1×1 PNG | `422` — degenerate thumbnail; not a real-world case |
| 1200×900 (1.08 MP) | **200** in 1.07s → 8 KB WebP |
| 2048×2048 (4.19 MP, 6.8 MB) — the client's max output | **200** in 2.25s → 79 KB WebP |
| Signed-URL read back through the gateway | **200**, `image/webp` |

The `wall clock duration warning` / `early termination has been triggered` lines
in the functions log were a **red herring** — nothing timed out; the worker
limits in `railway/functions/main/index.ts` were never reached.

All test artefacts were removed afterwards: `media_assets` back to 10 in
`Main Tes`, bucket back to 106 objects. **Note the row delete does not cascade to
storage** — the four files had to be deleted separately. That is the orphan trap
to handle in any test-data wipe script.

> **Incidental access-control evidence:** a mistyped command issued a `DELETE`
> against `media_assets` with no credentials. It returned `204` and deleted
> **nothing** — RLS held against an unauthenticated write on live data.

---

## Bug: portraits vanish on reload — **ROOT CAUSE FOUND AND FIXED**

**Cause: storage-api sets no CORS headers on its REAL responses.** Hosted
Supabase's Kong added them. PostgREST sets its own and the Deno functions set
their own via `_shared/cors.ts` — **storage was the only route without them.**

Measured on the real (non-preflight) response before the fix:

| Route | `Access-Control-Allow-Origin` on real response |
|---|---|
| `/rest/v1/*` | present |
| `/functions/v1/*` | present |
| **`/storage/v1/*`** | **absent** |

The browser therefore blocked the response **body** of `createSignedUrl`.
supabase-js returned `data: null`, and `resolvePortraitUrl` maps null to "no
image" by design — so a perfectly good stored portrait rendered as an empty
upload prompt.

This accounts for every symptom that looked contradictory:

- **Upload works and the image appears** — `upload-media` returns freshly signed
  URLs and sets its own CORS, so nothing is re-signed at that moment.
- **Gone after reload** — the URL must be re-signed, and that call is blocked.
- **Both DM and player affected** — nothing to do with roles or RLS.
- **Every curl probe passed** — curl does not enforce CORS.
- **"As if never set"** — the deliberate null-to-no-image fallback.

**Fix** — `Access-Control-Allow-Origin` + `Access-Control-Expose-Headers` on the
**storage route only** in [railway/gateway/Caddyfile](../../railway/gateway/Caddyfile).
Scoped deliberately: adding it globally would duplicate the header on `/rest`
and `/functions`, which browsers reject outright, trading one bug for a worse one.

**Verification — PASS.** Asserted *counts*, not mere presence, so a duplicate
would fail rather than pass:

| Route | real response | preflight |
|---|---|---|
| `/rest/v1` | 200, ACAO ×1 | 204, ACAO ×1 |
| `/auth/v1` | 400, ACAO ×1 | 204, ACAO ×1 |
| `/storage/v1` (sign) | 200, ACAO ×1 | 204, ACAO ×1 |
| `/functions/v1` | 400, ACAO ×1 | 204, ACAO ×1 |
| storage image GET | 200, 9,824 bytes, `image/webp`, ACAO ×1 | — |

### The pattern worth remembering

Three separate outages this phase, all the same shape: **Kong was quietly doing
work the Caddy gateway had to be taught.** Auth preflights, the realtime tenant
Host header, and now storage response CORS. When something works via `curl` but
not in the browser on this stack, compare against what Kong used to add.

### Diagnostic note

`resolvePortraitUrl` returning `null` on *any* failure — a deliberate choice so a
missing portrait degrades gracefully — made this materially harder to find: a
blocked request and "no portrait was ever set" are indistinguishable, with
nothing surfaced to the user or any log. Worth revisiting so genuine failures are
distinguishable from absence.

### Original report (kept for the record)

Reported 2026-08-21 by the user, as `ejcaldwell.test@gmail.com`
(`f1fd154d…`, "Tester 1") on their character **Test** (`ffaa6212…`) in `Main Tes`.
After a reload the portrait slot shows the **upload prompt, as if none had ever
been set** — not a broken-image icon.

**Not a migration fault, and not an RLS fault.** Verified server-side against the
live stack using a JWT minted for that exact user:

| Layer | Result |
|---|---|
| `characters.portrait_asset_id` persisted | **yes** — `bbf2d599…`, written 14:29:50 |
| `getMyCharacter` uses `select('*')` | includes the column |
| `media_assets` lookup as that player | **200**, returns `thumb_path` |
| `createSignedUrl` as that player | **200** |
| Fetch of the signed URL | **200**, 9,824 bytes, valid WebP |
| Same for three **migrated** assets (`8814ed3c…`, `23aded95…`, `2a02ad78…`) | sign **200**, fetch **200** |
| storage-js 2.110.0 reads `data.signedURL` | matches what storage-api returns |

`resolvePortraitUrl` in `CharacterPanel.tsx` **deliberately degrades to `null`**
("so a missing portrait degrades to 'no image' rather than a broken one"), which
is why the failure presents as *never set* rather than as an error. That design
choice is also why nothing surfaces to the user or the logs — worth revisiting,
since it converts a diagnosable failure into a silent one.

Every server-side layer returns 200 for the exact account that sees nothing, so
the fault is client-side and **not reproducible with curl**. Next discriminating
steps handed to the user: whether the DM's Party view (same
`resolvePortraitUrl`) renders them, whether the image survives a tab switch
without a full reload, and whether a hard reload clears it (the dev server has
run across an `.env` change and two gateway deploys, so a stale Vite module
graph is not yet excluded).

**Resolved by the storage-CORS fix above; awaiting the user's browser
confirmation before Area E can close.**

Also observed: replacing a portrait leaves the superseded asset **orphaned**
(two from 2026-08-21: `697bcaa6…`, `e95eec7e…`). Pre-existing, not a Phase 6
regression — it is what the deferred daily storage-cleanup cron in PRE_LAUNCH §1
exists to sweep.

---

## Area E — Browser manual pass — **PASS** 2026-08-21

Run by the user; results as reported. Claude cannot see the browser, so nothing
here is recorded without an explicit report.

| # | Step | Result |
|---|---|---|
| 1 | Sign in on the Railway stack | **PASS** 2026-08-21 (after the auth-preflight fix) |
| 2 | Campaign list + panel content | **PASS** — reported "everything looks to be fine" on the DM walkthrough |
| 3 | Upload a new image | **PASS** — "uploaded a photo into the app and it works fine" |
| 3b | **Existing/stored portraits render after reload** | **PASS** 2026-08-21 — "I can now see images under my character tab and under the DM's party tab", confirming the storage-CORS fix on both the player's own panel and the DM's Party view |
| 4 | Write + reload persistence | implicitly exercised (portrait link survived reload); not separately reported |
| 5 | **Player sees none of the 8 DM tabs** | **PASS** 2026-08-21 — user reported "all pass". The fail-open case (a DM tab visible to a player) did not occur. |
| 6 | **Realtime two-window HP change, no refresh** | **PASS** 2026-08-21 after the tenant fix — confirms subscriptions actually deliver row changes, not merely that the socket connects |
| 7 | Password-reset email | **PASS** — link points at `localhost:5173` as expected while `GOTRUE_SITE_URL` is unchanged (PRE_LAUNCH §3) |

**Area E closed.** Steps 5 and 6 are the two that server-side testing could not
substitute for: role-level tab gating needs a signed-in session, and realtime
needed a real subscription rather than a bare handshake.

Claude cannot drive the browser. Steps in
[cutover-manual.md](cutover-manual.md); record results here when reported.

---

## Verdict

**Phase 6.5 QA: PASS** (Areas A–E), 2026-08-21. The app runs entirely on the
self-hosted Railway stack: Postgres, PostgREST, GoTrue, storage-api, realtime,
edge-runtime and Caddy, with nightly backups.

**Three browser-only outages were found and fixed during this area**, all the
same shape — *Kong was quietly doing work the Caddy gateway had to be taught*:

| Bug | Presented as | Real cause |
|---|---|---|
| Auth CORS preflight | "wrong password" | GoTrue returns no CORS on `OPTIONS` |
| Realtime tenant | "realtime is laggy" | tenant read from the Host header's first label |
| Storage response CORS | "image never uploaded" | storage-api sets no CORS on real responses |

**Every one was invisible to server-side verification**, because `curl` enforces
neither CORS nor preflight. The 29-table access-control audit in Area C was
entirely green while the app was unusable. That is the concrete case for the
division of labour in CLAUDE.md: the automated half cannot stand in for someone
opening the app.

Not covered here, deliberately: decommissioning hosted and repointing the
**live**-mode Stripe webhook. Both are tracked in
[PLANNING.md](../../PLANNING.md) 6.5.1 and [PRE_LAUNCH.md](../../PRE_LAUNCH.md) §3.

---

## Rollback

Trivial until the hosted project is deleted: restore the two commented `.env`
lines and restart the dev server. Vite reads `.env` only at startup, so a hot
reload will not pick up either direction.

**Do not decommission hosted, and do not repoint the live-mode Stripe webhook,
until Area E is green.**
