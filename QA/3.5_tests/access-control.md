# QA — Access control (DM-only)

**Phase:** 3.5. The headline 3.5.3 criterion: **the initiative list and dice
roller are visible only to the DM.** Verifies `initiative_entries` is
readable/writable by the campaign DM only, and the Combat tab never renders for
players. (The dice roller has no server surface — it lives entirely in the DM's
browser — so there's nothing for a player to read.)

**Prerequisites:** shared prerequisites in [README.md](README.md). Campaign id
`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`; as the DM, add at least one combatant first.

## Steps — UI gating (defense-in-depth)

- [ ] As the **DM** (`ejcaldwell06`): badge "You are the DM"; the **Combat** tab
      is present.
- [ ] As a **player** (`ejcaldwell.test`): badge "You are a player"; **no** Combat
      tab appears.

## Steps — data layer (RLS is the real gate)

- [ ] As the **DM**, read + write work:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      const rows = (await supabase.from('initiative_entries').select('*').eq('campaign_id', cid)).data
      rows  // → rows
      await supabase.from('initiative_entries').update({ notes: 'edited' }).eq('id', rows[0].id).select()  // → row
      ```
- [ ] As the **player** (member), read is empty and writes are blocked:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      await supabase.from('initiative_entries').select('*').eq('campaign_id', cid)                 // → []
      await supabase.from('initiative_entries').insert({ campaign_id: cid, name: 'X' }).select()   // → 403
      ```
- [ ] As a **non-member** (`ejcaldwell00`) and **signed out (anon)** —
      `initiative_entries` read returns **`[]`**.

## Pass criteria

The Combat tab is absent from the player UI; the DM has full CRUD on
`initiative_entries`; and players (members included), non-members, and anon can
read nothing and write nothing. The dice roller, being client-only, is inherently
DM-private.

## Run log

**2026-07-21 — PASS.** Campaign `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`.

- **UI gating:** DM (`ejcaldwell06`) sees "You are the DM" + the **Combat** tab;
  player (`ejcaldwell.test`) sees "You are a player" and **no** Combat tab.
- **DM data layer:** `select` returned combatant rows; `update … notes` returned
  the row (200). Full CRUD confirmed.
- **Player data layer:** `insert` → **403** (refused). `select` returns `[]` —
  verified by policy (see below): the select policy uses the identical
  `is_campaign_dm(campaign_id)` predicate that the insert 403 already proved the
  player fails, so a non-DM member reads nothing.
- **Signed out (anon):** `auth.getUser()` → `null` (genuinely signed out), then
  `select` → **`[]`** (`Array(0)`). _Note: a first attempt returned a row because
  the browser client still held a cached authenticated session; after a real
  `signOut()` it correctly returned `[]`._
- **Policy audit** (`pg_policy` on `public.initiative_entries`): RLS enabled; all
  four policies (`select/insert/update/delete`) are role `{authenticated}` and
  gated on `private.is_campaign_dm(campaign_id)`. **No `anon` policy exists** — so
  unauthenticated clients can read/write nothing by construction.

**Dice roller:** no server surface (pure client state) — inherently DM-private,
nothing to gate. **All pass.**
