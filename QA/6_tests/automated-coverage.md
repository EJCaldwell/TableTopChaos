# Automated coverage — Phase 6

> **Dated record, not the current state.** This file says the project has no test
> runner. That was true when it was written; **Vitest arrived in Phase 8.1**, and
> since 2026-09-01 every unit of work adds unit tests for its pure logic. Left
> as written rather than rewritten — a coverage note describes what covered a
> phase AT THE TIME, and editing it to match today would erase the fact that this
> phase shipped without a runner.

This project has **no test runner** (see [`../README.md`](../README.md)). "Automated"
here means the TypeScript compiler, the production build, and the server-side SQL
assertions I can run without a browser.

---

## What the toolchain covers

| Check | Command | What it actually proves for this phase |
| --- | --- | --- |
| Type check + build | `npm run build` | Only that the frontend still compiles. **Near-zero signal here** — Phase 6 changes 0 frontend files, so this passes whether or not the backend works. Do not treat it as evidence. |
| Migration replay | `psql -v ON_ERROR_STOP=1 -f` over `supabase/migrations/*.sql` | All 27 migrations apply against a fresh self-hosted Postgres — the strongest automated signal in the phase. |
| Caddyfile validation | `caddy validate` (runs at image build) | Gateway config parses; catches syntax errors before a crash-loop. Does **not** catch `handle` vs `handle_path` mistakes — only the curl checks in [`stack-preflight.md`](stack-preflight.md) do. |

## Server-side SQL assertions (my half of the QA)

Run via the Supabase MCP against the source, and `psql` against the target.

| Assertion | Expected | Lives in |
| --- | --- | --- |
| Policy count (`public` + `storage`) | 100 | [`access-control-matrix.md`](access-control-matrix.md) |
| Tables with `rowsecurity = true` | 30 | same |
| Policied-but-RLS-disabled tables | **0 rows** | same |
| `service_role` has `bypassrls`; `anon`/`authenticated` do not | — | same |
| Four-role matrix (allowed **and** denied paths) | — | same |
| `auth.uid()` / `auth.role()` resolve from claims | non-NULL | [`stack-preflight.md`](stack-preflight.md) |
| Roles + `auth.*` helpers exist pre-migration | 4 + 4 | same |
| Per-table row counts vs source | match | [`data-migration.md`](data-migration.md) |
| `auth.users` UUID set difference | 0 rows | same |
| `storage.objects` count | 106 | same |
| `campaign_storage_used()` per campaign | matches source | same |
| Realtime publication membership | intended tables only | [`media-and-realtime.md`](media-and-realtime.md) |

## Explicit gap: `get_advisors`

`get_advisors` is a hosted-Supabase feature with **no self-hosted equivalent**. Every
prior phase used it as a security gate. From Phase 6 onward it is unavailable, and
the `pg_policies` + `rowsecurity` + `bypassrls` audit above is its replacement.

This substitution must be stated in the phase run log. It is a genuine reduction in
coverage — the advisors also flagged things like `SECURITY DEFINER` misuse and
function `search_path` issues, which the replacement audit does not check. Worth
adding a one-off manual review of the `redeem_invite_code` DEFINER RPC (a known
by-design advisor finding) after cutover, since nothing will flag it again.

## Not covered by anything automated

Delegated to the browser checklists — no tooling in this project reaches them:
signed-URL rendering, cross-campaign media denial, WebSocket upgrade, two-session
realtime propagation, Stripe redirects and signature verification, and session
persistence across a reload.
