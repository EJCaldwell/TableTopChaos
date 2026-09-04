---
name: qa-testing
description: How to QA and test changes in THIS project (TableTopChaos — React/TypeScript + Supabase). Apply it whenever you build, change, or verify a feature here — after finishing any subphase, migration, Edge Function, panel, or bug fix, and whenever the user says test / QA / verify / "does this work" / "is it done". Covers the Build→QA loop, the Supabase RLS access-control matrix (DM / player / non-member / signed-out) verified SERVER-SIDE via the Supabase MCP, the stale-session caveat, the per-phase QA/ folder + run-log convention, and what "automated coverage" means here (Vitest + tsc/build + the qa:checks harness). This is the project-specific companion to the global phased-plan-and-qa skill — follow it even when not explicitly asked to test.
---

# QA & Testing — TableTopChaos

"Automated coverage" here is four things, and the first one is newer than most of
the QA folder:

1. **`npx vitest run` — the unit tests.** Vitest arrived in Phase 8.1 and **every
   unit of work since 2026-09-01 adds tests for the pure logic it introduces**,
   in the same change. Anything provable in Node must NOT appear on a manual
   checklist. See CLAUDE.md for what does and does not deserve a test.
2. **`npm run build`** (`tsc -b` + `vite build`), or `npm run typecheck`.
   `noUnusedLocals`/`noUnusedParameters` are on, so dead code fails the build.
3. **`npm run qa:checks`** — the bespoke Node harness under `QA/tools/` for the
   workspace-layout logic, which predates Vitest.
4. **The RLS matrix**, `railway/scripts/95_rls_matrix.sql`, run by the migrate
   job — the real test of every access-control rule, and of the movement and
   occupancy triggers.

Everything else is **manual QA against the live stack**, backed by server-side
verification. Testing is not optional or deferred: after building any unit, QA it
before calling it done — even if the user didn't ask.

> **Historical note, because the QA folder contradicts this.** Several
> `automated-coverage.md` files say "this project has no test runner". That was
> true when they were written (phases 1.4–7.x) and they are dated records, not
> current descriptions. Do not take them as the present state, and do not rewrite
> them either — see the banner each now carries.

> **A unit test is how you AVOID a browser step.** The owner runs the manual
> checklist; every case you can prove in Node is one they do not have to run, and
> it re-runs forever. Two real defects in `walls.ts` — an infinite loop and a
> 2.8s freeze — were caught by tests before any UI existed, and neither was
> reachable from a checklist.

This is the project-specific companion to the global **phased-plan-and-qa** skill
(which owns the generic QA-folder format and testing habits). Load that too for the
folder/file skeleton; this file adds the Supabase-specific method and fixtures.

---

## Who does what (READ THIS FIRST)

Testing here is a **collaboration**, not something you do entirely on your own. Do
not "self-QA" a feature and declare it passing.

**You (Claude) do the automated / server-side parts:**

- Type-check & build; `get_advisors` after migrations.
- **Server-side RLS verification** via the Supabase MCP (`execute_sql` with
  `set local role` + JWT claims; `pg_policies` audits). This is genuinely yours —
  you have the MCP, the user doesn't need a browser for it.
- **Author** each `QA/<phase>_tests/` manual checklist.
- Record results in the run log and tick the tracker.

**The user does the in-browser manual steps** — clicking through the running app,
uploads, visual checks, the two-session realtime tests. You cannot see or drive
their browser, so you **cannot** perform or pass these.

**Never hand the user a browser-console or devtools step.** They don't run them,
and a checklist they won't run isn't coverage — it's a permanently-open file. If
a behavior seems to need one, in this order:

1. **Test the logic directly.** Parsers, clamps, validators and reducers are pure
   functions; exercise them in Node with stubbed globals under `QA/tools/` (see
   `layout-checks.mts`, run by `npm run qa:checks`). Extend that harness rather
   than writing a console step. This is *better* evidence than a pasted snippet —
   repeatable, and it re-runs on every future change.
2. **Design the case away.** A schema-version stamp that discards stale saved
   state wholesale beats one test step per retired key.
3. **Find a UI path.** Resizing the browser window tests off-screen clamping with
   no console at all.
4. Only if none of those work, mark it optional and record it **NOT RUN** when
   skipped — never quietly PASS.

Be honest about the limit: you cannot execute anything in the user's browser, so
"I'll run the console steps" is never literally true. Delivering on it means
routes 1–3.

**So for the manual part, hand it over like this:**

1. **Say what you already did.** Lead with the server-side/data-layer results you
   ran yourself (e.g. "the access-control matrix is PASS via the MCP — DM 1 row,
   player/non-member 0, anon can't read…") so the user knows that part is done and
   they don't need to touch it.
2. **Inline the concrete steps into chat** — don't just point at the file. Write
   them as a numbered, top-to-bottom flow the user can execute without opening
   anything, condensed to the **high-signal** checks (skip cosmetic wording unless
   the copy itself is under test).
3. **Order the steps so app state flows** — sequence them so each leaves the app in
   the right state for the next (e.g. "do section A first; it ends on Note taker,
   clean for B"). Note which browser/role each part needs (DM in one profile,
   player in a second) up front.
4. **Ask for a per-section report format** — tell them how to report back, e.g.
   `"A: 1–12 good"` or `"A8: the down-copy was wrong: …"`, and to paste any console
   output or errors.
5. **STOP and wait.** Do not proceed, and do not write the run log, until they
   report. **Never mark a manual step PASS without the user's reported result, and
   never assume/fabricate a browser outcome** — a passing server-side RLS check is
   evidence about the policy, not proof the UI behaves.
6. **Record what they reported** into the run log (verbatim observations, dated),
   log any bug + fix as a `> Follow-up`, **tick the CHECKBOXES in the manual file
   itself**, then tick the PLANNING tracker box.

**Tick the checkboxes, not just the run log.** This drifted badly and silently:
every phase from 3.5 onward had a dated PASS run log while every `- [ ]` in the
same file stayed unchecked, so 123 steps the owner had personally run and passed
read as never attempted. It was caught by the owner browsing old QA pages, not by
me. The run log is the evidence; the checkbox is the summary — a reader scans the
boxes first, and boxes that never move make a passing phase indistinguishable
from an abandoned one.

Three rules keep the two honest:

- Tick **in the same edit** that writes the run-log entry, never "later".
- Tick **only what the owner reported passing**. A file with a partial run keeps
  its unrun steps unchecked; that is the file doing its job, not drift.
- A deferred or withdrawn step stays unticked and says so in prose. Unticked must
  mean "not passed", and it can only mean that if it always does.

If some areas were already run (e.g. a server-side checklist marked PASS), say so
and only hand over the ones still **open**.

## The loop

Build one subphase → QA it → only then move on. Don't batch several features and
test at the end. For each unit:

1. **Type-check / build** — `npm run build` (or `npm run typecheck`) must be clean.
   `noUnusedLocals`/`noUnusedParameters` are on, so unused code fails the build.
   *(You do this.)*
2. **Run `get_advisors`** (Supabase MCP) after any migration — security +
   performance advisors must be clean for the new objects (note any by-design
   exceptions, e.g. the `redeem_invite_code` DEFINER RPC). *(You do this.)*
3. **Server-side access-control checks** via the MCP (the matrix below). *(You.)*
4. **Manual QA** — author the `QA/<phase>_tests/` checklist, then hand the steps to
   the user and wait for their observed results. *(User runs; you record.)*
5. **Record results** in the run log, then tick the PLANNING tracker box. *(You,
   from the user's reported results.)*

Do **not** start a dev server — the user runs their own on **port 5173**. Never run
git — the user does all git operations.

---

## What to test (high-signal only)

Cover what would actually catch a real bug; skip what the build already guarantees.
Priorities, in order:

1. **Access control** — the headline for almost every feature here. Run the full
   role matrix (next section).
2. **Core behavior** — the main thing the feature does, on the happy path.
3. **Persistence** — reload and confirm it survived (autosave, optimistic UI).
4. **Edges that plausibly break** — boundary values (HP caps, death-save 0..3,
   level 0–9), empty states, invalid/blank input, XSS-safe markdown, offline/retry,
   realtime merge idempotency.

Skip cosmetic label checks, "the form appears" wiring, and framework defaults. If a
step wouldn't change your ship decision, leave it out.

---

## Access-control matrix (RLS is the real gate)

For every access-controlled feature, exercise **all four** perspectives and assert
both the allowed AND the denied paths:

| Role | Expected |
|------|----------|
| **DM** (`ejcaldwell06`) | full CRUD on their campaign's data |
| **Player / member** (`ejcaldwell.test`) | own data only; DM-only tables read `[]` and writes → **403** |
| **Non-member** (`ejcaldwell00`) | reads `[]`, writes blocked |
| **Signed out (anon)** | reads `[]`, writes blocked |

A denied write must **error or match zero rows** — never silently succeed. UI
gating (hidden tabs/buttons) is defense-in-depth, **not** the test; the data layer
is.

### Verify SERVER-SIDE, not just in the browser

The UI and even a browser console can lie (see stale sessions below). Confirm the
policy directly with the Supabase MCP `execute_sql`, simulating the role + JWT:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','<user-uuid>','role','authenticated')::text, true);
-- now run the exact select/insert/update the client would, and check row counts
select count(*) from public.<table> where campaign_id = '<cid>';
rollback;
```

Also audit the policies themselves when it matters:

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public' and tablename='<table>';
```

Confirm each policy is `{authenticated}` and gated on the right predicate
(`private.is_campaign_dm`, `can_read_character`, `is_campaign_member`, …), and that
**no `anon` policy exists** where anon should see nothing.

### Stale-session caveat (this has bitten us repeatedly)

If a browser-console read returns rows you didn't expect (e.g. a "signed-out" tab
returns `Array(1)`), **suspect a cached/stale Supabase session before suspecting
RLS.** Confirm identity first:

```js
await supabase.auth.getUser()   // is this actually who you think? null when anon?
```

A real `signOut()` (or a fresh incognito tab) usually makes the unexpected rows
disappear. Don't file an RLS bug until `getUser()` proves the identity.

---

## Realtime features

Test with **two concurrent sessions** (two browsers/profiles). A change in one must
appear in the other **live (~1–2 s), per-row** (no full-panel reload, no flicker /
focus loss). Also confirm a signed-out / non-member tab receives **nothing** (RLS
gates realtime events too), and that channel teardown is clean on tab switch.

---

## The QA/ folder

One subdirectory per phase, `QA/<phase>_tests/`, mirroring PLANNING numbering. Per
the global skill: a phase `README.md` (index + manual-area table), an
`automated-coverage.md` (here: the Vitest files, the build, `qa:checks` and the
RLS matrix), and one
manual-checklist file per area. Manual files: **Prerequisites → Steps (checkboxes +
expected results) → Pass criteria → Run log**. Run log entries are dated and
**preserved forever** — never rewrite past results:

```
**YYYY-MM-DD — PASS/FAIL.** <campaign/record id>
- <what was checked> → <observed result>
- <bug found + fix, if any>
```

Record bugs and their fixes inline (as `> Follow-up` notes), not just passes.

---

## Standard test fixtures

- **Supabase project:** `fnykpoattheldxtkrozd`.
- **Campaign "Test 1":** `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`.
- **DM / owner:** `ejcaldwell06`. **Player (has a character):** `ejcaldwell.test`.
  **Non-member:** `ejcaldwell00`.
- **Wipe test data afterward** so fixtures don't accumulate (especially billing /
  Stripe test-clock data and uploaded media).

When a feature needs other fixtures, note them in that area's **Prerequisites** and
reuse these accounts for the role matrix.

---

## Report faithfully

State results plainly: if a step failed or was skipped, say so with the observed
output; only mark an area **PASS** once actually verified. When a browser result
and a server-side check disagree, trust the server-side check and explain why.
