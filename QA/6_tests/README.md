# QA — Phase 6: Self-hosted backend migration (hosted Supabase → Railway)

Covers the move off hosted Supabase onto a self-hosted stack, per
[PLANNING.md](../../PLANNING.md) Phase 6 and the runbook in
[docs/RAILWAY_MIGRATION.md](../../docs/RAILWAY_MIGRATION.md).

**What makes this phase different from every earlier one:** no application code
changes. The frontend, the 27 migrations and the 7 Edge Functions are carried
over byte-identical. So there is nothing for `npm run build` to catch, and the
usual first line of defence is absent. Every gate here is a runtime assertion
against a running stack.

**`get_advisors` has no self-hosted equivalent.** The substitute is a direct
`pg_policies` + `pg_class.relrowsecurity` audit. Record that substitution in
every run log — it is the one place this phase's QA is weaker than the hosted
project's, and it should stay visible rather than be quietly dropped.

## Areas

| Area | File | Who runs it | Status |
|------|------|-------------|--------|
| 6.1 Local stack pre-flight | [local-preflight.md](local-preflight.md) | Claude, local Docker | **PASS** 2026-08-18 |
| 6.2 Data migration | [data-migration.md](data-migration.md) | Claude, local Docker | **PASS** 2026-08-18 |
| 6.3 Railway deploy & gateway | [railway-deploy.md](railway-deploy.md) | Claude + user (Railway dashboard) | **PASS** 2026-08-19 |
| 6.4 Stripe re-wiring | [stripe-rewiring.md](stripe-rewiring.md) | Claude + user (browser checkout) | **PASS** 2026-08-19 |
| 6.5 Cutover & decommission | [cutover.md](cutover.md) | Claude + user (browser) | **PASS** 2026-08-21 (A–E); decommission deferred |

## The failure mode this phase's QA actually caught

The `pg_policies` substitution above was the *anticipated* weak point. It was not
where the real risk lived. **Every outage in this phase was browser-only** —
three of them, all found in Area E of 6.5 within minutes of the user clicking
something, and all invisible to server-side verification because `curl` enforces
neither CORS nor preflight:

| Bug | Presented as | Real cause |
|---|---|---|
| Auth CORS preflight | "wrong password" | GoTrue returns no CORS on `OPTIONS` |
| Realtime tenant | "realtime is laggy" | tenant read from the Host header's first label |
| Storage response CORS | "image never uploaded" | storage-api sets no CORS on real responses |

One shape underlies all three: **hosted Supabase's Kong was quietly doing work
the Caddy gateway had to be taught.** When something works via `curl` but not in
the browser on this stack, that is the first thing to check.

The 29-table anon/keyless access-control audit was entirely green while the app
was unusable. Automated coverage cannot substitute for someone opening the app.

## The failure mode this phase's QA exists to catch

A table that arrives with **RLS disabled** fails *open*: the app looks completely
normal, and every DM-only note and private journal is readable by anyone signed
in. Nothing visibly breaks, so only an explicit assertion finds it. Both the
grant script and the 6.5.2 gate assert it directly; do not treat "the app works"
as evidence.

## Baseline numbers (measured 2026-08-18, local pre-flight)

Use these as the expected values in later subphases. **PLANNING.md's 6.5.2 gate
says "exactly 30 tables with `rowsecurity = true`"; the measured figure is 34.**
The estimate predated a real stack — 29 in `public` plus 5 in `storage`
(`objects`, `buckets`, `migrations`, `s3_multipart_uploads`,
`s3_multipart_uploads_parts`, all created and policed by storage-api).

| Metric | Value |
|---|---|
| Policies (`public` + `storage`) | **100** (99 + 1) |
| Tables in `public` | 29, **all** with RLS |
| Tables with `rowsecurity = true` | 34 (29 public + 5 storage) |
| Migrations replayed | 27/27 |
| PostgREST schema cache after reload | 34 relations, 40 relationships, 29 functions |
