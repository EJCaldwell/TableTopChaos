# QA — Access control (character RLS)

**Phase:** 2.1. Verifies migration 0010's RLS: the **owner** has full read/write
over their character and sheet, the campaign **DM has read-only** access, and any
**other player (or non-member) has no access** — enforced by RLS, not just by
hidden UI.

**Prerequisites:** shared prerequisites in [README.md](README.md). You need:
- **Account A** — DM/owner of the campaign.
- **Account B** — player member of the campaign, who has created a character with
  at least one section and field (run [sheet-editing.md](sheet-editing.md) first).
- **Account C** — a signed-up user who is **NOT** a member of this campaign.
- Note B's character id (from the DB, or `characters` select as B) and one of its
  section ids for the write test.

All row-level checks run through the **normal client in the app console** while
signed in as the respective account (so RLS applies as it would in production —
the SQL editor runs as a superuser and bypasses RLS, so don't use it here).

## Steps — owner (Account B)

- [x] Signed in as **B**, the "My character" tab loads B's character and sheet
      normally (covered by [sheet-editing.md](sheet-editing.md)); reads and writes
      succeed. This is the baseline.

## Steps — DM read-only (Account A) — data layer

> The DM-facing *view* (the "Party" tab) isn't built yet, so verify the DM's
> **read-only** access at the data layer via the app console.

- [x] As **A (DM)**, read B's character — expect **the row returned**:
      ```js
      await supabase.from('characters').select('*').eq('id', '<B_char_id>')
      ```
- [x] As **A**, read B's sheet — expect **sections + fields returned**:
      ```js
      await supabase.from('sheet_sections')
        .select('*, sheet_fields(*)').eq('character_id', '<B_char_id>')
      ```
- [x] As **A**, attempt to **modify** B's character — expect **no rows affected**
      (RLS update policy is owner-only; the DM read does not grant write):
      ```js
      await supabase.from('characters')
        .update({ name: 'HACKED' }).eq('id', '<B_char_id>').select()
      // → data: []  (nothing updated)
      ```
- [x] As **A**, attempt to modify one of B's sections → also **no rows affected**:
      ```js
      await supabase.from('sheet_sections')
        .update({ title: 'HACKED' }).eq('id', '<B_section_id>').select()
      // → data: []
      ```
- [x] As **A**, attempt to **delete** B's character → **no rows affected**; refresh
      B's sheet to confirm it's untouched.

## Steps — other player / non-member no access (Account C)

- [x] As **C**, read B's character → **zero rows**:
      ```js
      await supabase.from('characters').select('*').eq('id', '<B_char_id>')
      // → data: []
      ```
- [x] As **C**, read B's sheet → **zero rows** for both sections and fields.
- [x] As **C**, attempt any update/delete on B's character/section → **no rows
      affected**.
- [x] *(C added as a player member of the campaign)* character read as C is still
      **zero rows**: a co-player is **not** a DM, so the DM-read branch doesn't
      apply and C is not the owner. Confirms "other players no access" holds even
      for fellow members, not just outsiders.

> **Note (2026-07-09):** during this run, Account C (`ejcaldwell.test`) was added
> as a **player member** of the campaign before the reads. So the results verify
> the **stronger** co-player case (a member who is neither owner nor DM still sees
> zero rows). A pure non-member is even more restricted — it also fails
> `private.is_campaign_member` — so it is logically covered by this stricter case.

## Steps — unauthenticated default-deny

- [x] Sign out (or use an anon client). Any select on `characters`,
      `sheet_sections`, or `sheet_fields` returns **zero rows** (the policies are
      `to authenticated`, so `anon` matches nothing).

## Pass criteria

The owner can read and write their character and sheet; the campaign DM can read
them but every write/delete affects zero rows; a non-owner player (member or not)
and an unauthenticated caller read zero rows and cannot write. All enforced by
RLS, observed through the normal client.

> Policies live in [`0010_characters_sheet.sql`](../../supabase/migrations/0010_characters_sheet.sql):
> `characters_select_owner_or_dm` (owner OR `private.is_campaign_dm`),
> owner-only `characters_update_owner` / `_delete_owner`, and the
> `sheet_sections_*` / `sheet_fields_*` policies backed by
> `private.can_read_*` / `private.can_write_*`.

## Run log

**2026-07-09 — PASS.** Run in-browser via `window.supabase` (dev helper) as each
account against campaign "Test 1" (character `51f4f8fe-…`, owner
`ejcaldwell000@gmail.com`).

- **Owner (B):** full read/write baseline (see sheet-editing run).
- **DM (A, `ejcaldwell06`):** character read → 1 row; sheet read → 4 sections;
  character update / section update / character delete → **0 rows each** (RLS
  filters the write silently, no error). DM read-only holds.
- **Co-player (C, `ejcaldwell.test`, added as a player member):** character read,
  sheet read, and update all → **0 rows**. Confirms a fellow member who is neither
  owner nor DM has no access (stronger than the pure-non-member case).
- **Unauthenticated (signed out):** character read → **0 rows** (`to authenticated`
  policies exclude `anon`). Default-deny holds.

No defects found in this area — RLS behaves exactly as designed in migration 0010.
