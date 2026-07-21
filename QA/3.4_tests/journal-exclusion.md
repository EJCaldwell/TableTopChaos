# QA — Journal exclusion

**Phase:** 3.4. The headline 3.4.3 criterion: **the DM cannot see a player's
journal** from the Party view. Verifies both that the UI never surfaces the
journal and that, at the data layer, the DM reads only *shared* entries (the
Party view surfaces none of them either).

**Prerequisites:** shared prerequisites in [README.md](README.md). The owner
`ejcaldwell000` has a character (`47ac79be-d1ac-4c40-93ea-2016a5a0fa33`) with at
least one **unshared** journal entry. Sign in as the DM (`ejcaldwell06`).

## Steps — UI

- [x] On the **Party** tab, open the owner's character → the read-only sheet
      shows portrait / lore / sheet / inventory / abilities / spells and **no
      Journal section anywhere**.
- [x] Confirm there is no control, tab, or link on the Party view that would open
      a player's journal.

## Steps — data layer (as the DM)

- [x] The DM's `characters` read returns the whole party:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      (await supabase.from('characters').select('id, name, owner_id').eq('campaign_id', cid)).data  // → all characters
      ```
- [x] The DM reading the owner's journal returns **only shared entries**, never
      the unshared/private ones:
      ```js
      const charId = '47ac79be-d1ac-4c40-93ea-2016a5a0fa33'
      (await supabase.from('journal_entries').select('id, title, shared').eq('character_id', charId)).data
      // → only rows with shared = true (0 rows if the player has shared nothing)
      ```
- [x] The DM can still read the owner's sheet surfaces (proving the read scope is
      correct, not blanket-denied):
      ```js
      (await supabase.from('inventory_items').select('id').eq('character_id', charId)).data  // → rows
      (await supabase.from('abilities').select('id').eq('character_id', charId)).data         // → rows
      (await supabase.from('spells').select('id').eq('character_id', charId)).data            // → rows
      ```

## Pass criteria

The Party view shows no journal for any player; a DM `journal_entries` read
returns only entries the player marked `shared` (and the Party view surfaces even
those nowhere), while the DM's read access to the rest of the sheet works.

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), campaign "Test 1". UI: the Party
  read-only sheet shows no Journal section and no control to reach one. Data
  layer: DM `characters` read returned both party characters; `journal_entries`
  read for each character (`47ac79be…`, `69e08ab0…`) returned **`[]`** (neither
  player has shared any entry, so the DM sees nothing of the private journals),
  while the DM's reads of inventory/abilities/spells returned the expected rows
  (2/2/0 and 0/1/1 respectively) — confirming the read scope is correct, not
  blanket-denied. Confirms `journal_entries` select = owner OR (shared AND
  is_character_dm).
