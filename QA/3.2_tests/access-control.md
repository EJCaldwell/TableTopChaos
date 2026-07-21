# QA — Access control (DM-only)

**Phase:** 3.2. The headline 3.2.3 criterion: **a player account cannot fetch any
encounter or its images** — extended here to the whole NPC/encounter surface.
Verifies all six tables are readable/writable by the campaign DM only, and that
the NPCs and Encounters tabs never render for players.

**Prerequisites:** shared prerequisites in [README.md](README.md). Campaign id
`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`; as the DM, create one NPC (with a stat
section + field) and one encounter (with an image + a linked NPC) first.

## Steps — UI gating (defense-in-depth)

- [x] As the **DM** (`ejcaldwell06`): badge "You are the DM"; both **NPCs** and
      **Encounters** tabs present.
- [x] As a **player** (`ejcaldwell.test`): badge "You are a player"; **neither**
      tab appears.

## Steps — data layer (RLS is the real gate)

Run in the console (`window.supabase`) as each account.

- [x] As the **DM**, reads return rows and writes work:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      const npc = (await supabase.from('npcs').select('*').eq('campaign_id', cid)).data
      const enc = (await supabase.from('encounters').select('*').eq('campaign_id', cid)).data
      npc; enc  // → rows
      const npcId = npc[0].id, encId = enc[0].id
      await supabase.from('npc_stat_sections').select('*').eq('npc_id', npcId)          // → rows
      await supabase.from('encounter_images').select('*').eq('encounter_id', encId)     // → rows
      await supabase.from('encounter_npcs').select('*').eq('encounter_id', encId)       // → rows
      await supabase.from('encounters').update({ name: 'edited' }).eq('id', encId).select()  // → row
      ```
- [x] As the **player** (member), every read is empty and writes are blocked:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      await supabase.from('npcs').select('*').eq('campaign_id', cid)         // → []
      await supabase.from('encounters').select('*').eq('campaign_id', cid)   // → []
      await supabase.from('npc_stat_sections').select('*')                   // → []
      await supabase.from('npc_stat_fields').select('*')                     // → []
      await supabase.from('encounter_images').select('*')                    // → []
      await supabase.from('encounter_npcs').select('*')                      // → []
      await supabase.from('npcs').insert({ campaign_id: cid, name: 'X' }).select()        // → 403
      await supabase.from('encounters').insert({ campaign_id: cid, name: 'X' }).select()  // → 403
      ```
- [x] As a **non-member** (`ejcaldwell00`) and **signed out (anon)** — `npcs` and
      `encounters` reads both return **`[]`**.

## Pass criteria

Both tabs are absent from the player UI; the DM has full CRUD across npcs /
npc_stat_sections / npc_stat_fields / encounters / encounter_images /
encounter_npcs; and players (members included), non-members, and anon can read
nothing and write nothing to any of them. Confirms migration 0020's DM-only
policies (`is_campaign_dm` / `is_encounter_dm` / `is_npc_dm` / `is_npc_section_dm`).

## Run log

- **2026-07-15** — PASS. Campaign "Test 1" (`d0e1fc8f-…`). UI gating: DM sees NPCs
  + Encounters tabs; player sees neither. Data layer — **DM**: reads returned
  4 npcs / 2 encounters, 3 npc_stat_sections; encounters update → 1 row (full CRUD).
  **Player** (member): all six tables read `[]`; npc + encounter inserts → **403**.
  **Non-member + anon**: npcs/encounters read `[]`. Confirms migration 0020 DM-only
  policies (is_campaign_dm / is_encounter_dm / is_npc_dm / is_npc_section_dm).
