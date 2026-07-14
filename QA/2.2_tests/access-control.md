# QA — Access control (inventory RLS)

**Phase:** 2.2. Verifies inventory is scoped to the owning character via migration
0012's RLS (which reuses the 0010 character predicates): the **owner** has full
read/write, the campaign **DM has read-only**, and any **other player (or
non-member / anon)** has no access.

**Prerequisites:** shared prerequisites in [README.md](README.md). The owner
(`ejcaldwell000@gmail.com`) has at least one inventory item (run
[inventory-editing.md](inventory-editing.md) first). You need the owner's
**character id** — grab it as the owner in the console:
```js
// signed in as the owner:
(await supabase.from('characters').select('id').single()).data
```
All row checks run through the **app console** (`window.supabase`, dev helper) as
the respective account, so RLS applies as in production (not the SQL editor).

## Steps — owner baseline

- [x] As the **owner**, the Inventory tab reads/writes normally (covered by
      [inventory-editing.md](inventory-editing.md)).

## Steps — DM read-only (Account A, `ejcaldwell06`)

- [x] As the **DM**, read the owner's items — expect **rows returned**:
      ```js
      await supabase.from('inventory_items').select('*').eq('character_id', '<char_id>')
      ```
      ✔ Returned 2 rows.
- [x] As the **DM**, attempt to modify an item — expect **0 rows affected**:
      ```js
      await supabase.from('inventory_items').update({ name: 'HACKED' }).eq('character_id', '<char_id>').select()
      // → data: []
      ```
      ✔ `data: []`.
- [x] As the **DM**, attempt to insert an item onto that character → **error / 0
      rows** (insert policy is owner-only):
      ```js
      await supabase.from('inventory_items').insert({ character_id: '<char_id>', name: 'X' }).select()
      ```
      ✔ **HTTP 403** (RLS `with check` violation) — nothing inserted.
- [x] As the **DM**, attempt to delete an item → **0 rows affected**. ✔ `data: []`.

## Steps — co-player / non-member (Account C, `ejcaldwell.test`)

- [x] As **C** (a co-player, not the owner), read the owner's items → **0 rows**:
      ```js
      await supabase.from('inventory_items').select('*').eq('character_id', '<char_id>')
      // → data: []
      ```
      ✔ `data: []`.
- [x] As **C**, attempt update/insert/delete on that character's items → **0 rows /
      rejected**. ✔ insert → **403**; update → `data: []`.

## Steps — unauthenticated

- [x] Signed out, any select on `inventory_items` returns **0 rows** (`to
      authenticated` policies exclude `anon`). ✔ `data: []`.

## Pass criteria

The owner reads/writes their inventory; the DM can read it but every write/delete
affects zero rows; a co-player, non-member, and anonymous caller read zero rows and
cannot write. Inventory access is exactly the character's access (migration 0012
reuses the 0010 predicates).

> Policies live in [`0012_inventory.sql`](../../supabase/migrations/0012_inventory.sql):
> `inventory_items_select_readable` (`private.can_read_character`) and owner-only
> insert/update/delete (`private.can_write_character`).

## Run log

**2026-07-09 — PASS.** Run in-browser via `window.supabase` against character
`51f4f8fe-…` (owner `ejcaldwell000`, 2 items) on campaign "Test 1".

- **DM (`ejcaldwell06`):** read → 2 rows; update → 0 rows; insert → **403** (RLS
  `with check`); delete → 0 rows. Read-only holds.
- **Co-player (`ejcaldwell.test`, member, non-owner):** read → 0 rows; insert →
  403; update → 0 rows. No access.
- **Unauthenticated:** read → 0 rows. Default-deny holds.

Inventory access exactly matches the character's (migration 0012 reuses the 0010
predicates). No defects found.
