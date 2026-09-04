# QA — HP & conditions (player)

**Phase:** 4.3. Verifies the player's HP/conditions tracker persists and is
owner-write / DM-read (`character_status`, migration 0025).

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
**player** (`ejcaldwell.test`) who has a character in "Test 1"; open **HP &
conditions**.

## Steps — behavior

- [x] No character case: a fresh player with no character sees a "create your
      character first" message (not an error).
- [x] Set **Max HP** = 30, **Current HP** = 30, **Temp HP** = 5. Indicator shows
      **Saving… → All changes saved**.
- [x] Enter **7** in the amount box → **− Damage** → temp HP drops to 0 first,
      then current HP falls by the remainder (30 → 28; temp 5→0, then −2).
- [x] Enter **100** → **+ Heal** → current HP caps at Max (28 → 30), not above.
- [x] **Death saves:** click success pip 3 → all three fill (tally = 3); click
      the 3rd again → drops to 2. Same for failures.
- [x] **Conditions:** toggle **Poisoned** and **Prone** on (chips highlight),
      toggle **Poisoned** off. Active set = {Prone}.
- [x] **Refresh** → current/max/temp HP, death-save tallies, and conditions all
      persist.

## Steps — access (RLS)

- [x] As the **DM** (`ejcaldwell06`), the player's HP is **readable** (data
      layer), but a DM write is refused:
      ```js
      // cid_char = the player's character id
      await supabase.from('character_status').select('*').eq('character_id', cid_char)          // → the row
      await supabase.from('character_status').update({ current_hp: 1 }).eq('character_id', cid_char).select()  // → [] / blocked
      ```
- [x] As a **different player / non-member**, `character_status` select for that
      character → `[]`; any write → blocked.

## Pass criteria

HP/temp/heal/damage math is correct (temp absorbs first; heal caps at max), death
saves and conditions toggle and persist, and only the owner can write while the
DM can read.

## Run log

**2026-07-29 — PASS.** Character `ffaa6212…` ("Test", owner player `f1fd154d`).

- Behavior 1–6 all good: max/current/temp HP set; damage ate temp HP first then
  current; heal capped at max; death-save pips; condition toggles; persisted on
  refresh (DB confirmed current 30 / max 30 / conditions present).
- Access (RLS): a DM browser `character_status` select returned `[]` — traced to
  a stale/non-DM console session (recurring artifact). Verified server-side by
  simulating the DM (`set role authenticated` + JWT claim): `can_read = true`,
  `can_write = false`, `visible_rows = 1`. So the DM reads but cannot write; the
  owner writes. **All pass.**
