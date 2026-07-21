# QA — Access control (DM-only)

**Phase:** 3.3. The headline 3.3.3 criterion: **NPCs and quests are invisible to
players.** The NPC half is verified in
[QA/3.2_tests/access-control.md](../3.2_tests/access-control.md); this file covers
**quests** — readable/writable by the campaign DM only, and the Quests tab absent
from the player UI.

**Prerequisites:** shared prerequisites in [README.md](README.md). Campaign id
`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`; as the DM, create at least one quest first.

## Steps — UI gating (defense-in-depth)

- [x] As the **DM** (`ejcaldwell06`): badge "You are the DM"; the **Quests** tab
      (and **NPCs**) present.
- [x] As a **player** (`ejcaldwell.test`): badge "You are a player"; **no** Quests
      (or NPCs) tab appears.

## Steps — data layer (RLS is the real gate)

- [x] As the **DM**, read + write work:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      const q = (await supabase.from('quests').select('*').eq('campaign_id', cid)).data
      q  // → rows
      await supabase.from('quests').update({ title: 'edited' }).eq('id', q[0].id).select()  // → row
      ```
- [x] As the **player** (member), read is empty and writes are blocked:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      await supabase.from('quests').select('*').eq('campaign_id', cid)              // → []
      await supabase.from('quests').insert({ campaign_id: cid, title: 'X' }).select()  // → 403
      await supabase.from('quests').update({ title: 'HACKED' }).eq('campaign_id', cid).select()  // → []
      ```
- [x] As a **non-member** (`ejcaldwell00`) and **signed out (anon)** — `quests`
      read returns **`[]`**.

## Pass criteria

The Quests tab is absent from the player UI; the DM has full CRUD on `quests`; and
players (members included), non-members, and anon can read nothing and write
nothing. Together with the 3.2 NPC checks, this confirms NPCs and quests are
invisible to players.

## Run log

- **2026-07-15** — PASS. "Test 1" (`d0e1fc8f-…`). UI: DM sees Quests (+ NPCs) tab;
  player sees neither. Data layer — DM: read 2 quests, update → 1 row. Player
  (member): quests read `[]`, insert → **403**, update → `[]`. Non-member + anon:
  quests read `[]`. With the 3.2 NPC checks, confirms NPCs and quests are invisible
  to players (migration 0021 is_campaign_dm policies).
