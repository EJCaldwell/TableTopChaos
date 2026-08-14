# QA — Access control after the backend migration

**Phase:** 6.5 (the headline area for this phase). Server-side halves are mine to
run; the browser halves are yours.

**Why this is the headline:** the migration swaps *what enforces* RLS (hosted
PostgREST → self-hosted PostgREST) while leaving all 100 policies textually
identical. If the swap is subtly wrong, data is exposed with no visible symptom.

**Prerequisites**
- Phase 6.1 and 6.2 passed — in particular `auth.uid()` resolving non-NULL.
- Four test identities against the target stack: a **DM** (campaign owner), a
  **player** member of that campaign, a **non-member** signed-in user, and a
  signed-out client.
- A second campaign owned by someone else, to test cross-tenant reads.

---

## Steps — server-side audit (run first)

These are the `get_advisors` replacement. Run against the **target** stack.

- [ ] **Policy count.** Expect exactly **100**:
      ```sql
      select count(*) from pg_policies where schemaname in ('public','storage');
      ```
- [ ] **RLS actually enabled.** Expect exactly **30**:
      ```sql
      select count(*) from pg_tables t
        join pg_class c on c.relname = t.tablename
       where t.schemaname = 'public' and c.relrowsecurity;
      ```
- [ ] **No policied-but-unprotected table.** Must return **zero rows** — this is the
      fails-open case and the single most important assertion in the phase:
      ```sql
      select t.tablename
        from pg_tables t
        join pg_class c on c.relname = t.tablename
       where t.schemaname = 'public'
         and exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.tablename)
         and not c.relrowsecurity;
      ```
- [ ] **Policy set matches source, not just in count.** Diff policy names per table
      between hosted and target; a renamed or missing policy can keep the count at
      100 while changing who can read what.
- [ ] **`storage.objects` policy present** (migration 0008). Its absence means every
      campaign's media is readable by any authenticated user.
- [ ] **`service_role` has `bypassrls`**, and `anon`/`authenticated` do **not**:
      ```sql
      select rolname, rolbypassrls from pg_roles
       where rolname in ('anon','authenticated','service_role','authenticator');
      ```

## Steps — four-role matrix (server-side, per the `qa-testing` skill)

For each role, wrap in a transaction, set the role and JWT claims, assert, roll back.
Assert **both** the allowed and the denied path — a denied write must error or affect
zero rows, never silently succeed.

- [ ] **DM** — reads own campaign's DM-only tables (`dm_notes`, `session_log`, NPCs,
      encounters, quests); reads every member's sheet; **cannot** read another
      campaign's rows.
- [ ] **Player** — reads/writes own character, inventory, journal; reads shared
      items; **cannot** read any DM-only table (expect 0 rows, not an error);
      **cannot** read another player's journal; **cannot** write another player's
      sheet.
- [ ] **Non-member** (signed in, not in the campaign) — 0 rows from every
      campaign-scoped table; every write denied.
- [ ] **Signed-out** (`anon`) — 0 rows everywhere except whatever is genuinely
      public; every write denied.
- [ ] **Journal privacy specifically** (Phase 2.4 / 3.4 invariant): the DM's Party
      view excludes player journals. Confirm the DM's read returns 0 journal rows.

## Steps — browser (yours)

- [ ] Sign in as DM: every DM tab loads; Party view shows each player's sheet;
      journals absent.
- [ ] Sign in as player: own workspace loads and saves; no DM tabs visible.
- [ ] As player, hit a DM-only URL/tab directly — denied, not merely hidden.
- [ ] Sign out, load a campaign URL — redirected to auth, no data flash.
- [ ] Reload after a mutation as each role: change persisted, still correctly scoped.

## Pass criteria

All three server-side audit gates hit their exact numbers (100 / 30 / zero rows),
the policy-name diff is empty, every role's allowed **and** denied paths behave as
specified, and the browser checks confirm the same through the real UI.

**If the policied-but-unprotected query returns any row, the phase FAILS
outright** — do not proceed to cutover regardless of other results.

> Stale-session caveat: if a client read returns unexpected rows, confirm
> `auth.getUser()` before concluding a policy is broken. A stale login is far more
> common than a real policy bug — and after a backend swap, every client is holding
> a token issued by the *old* GoTrue. Sign out and back in before investigating.

## Run log

_No runs yet._
