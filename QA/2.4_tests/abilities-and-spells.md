# QA — Abilities & spells editing

**Phase:** 2.4. Verifies the owning player can manage abilities/feats and spells,
that both persist, and that access matches the character (owner read/write, DM
read-only, others none).

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
character owner (`ejcaldwell000@gmail.com`), open campaign "Test 1".

## Steps — Abilities & Feats tab

- [x] Click **+ Add ability / feat**, then set a name (e.g. `Second Wind`), set **uses** to `1`, expand and type a
      description. Indicator shows **Saving… → All changes saved** (debounced).
- [x] Leave **uses** blank on a second ability → that's valid ("at-will").
- [x] **Drag** an ability by its `⠿` handle to reorder, incl. to the bottom.
- [x] Delete a pristine (blank) ability → no prompt; delete one with content →
      confirm prompt.
- [x] **Refresh** → names, uses, descriptions, and order all persist.

## Steps — Spells tab

- [x] Add a spell "at level" **1** using the picker → it appears under a **Level 1**
      group header.
- [x] Name a couple of spells; tick **Prep** on one; expand and add a description.
      Indicator debounces to **All changes saved**.
- [x] Change a spell's **level** via its selector (e.g. Cantrip → Level 2) → it
      **moves to the Level 2 group**; empty groups disappear.
- [x] Delete a pristine spell → no prompt; delete one with content/prepared →
      confirm prompt.
- [x] **Refresh** → spells stay grouped by level, prepared flags and descriptions
      persist.

## Steps — access control (RLS) — data layer

Run in the console (`window.supabase`) as each account. Use the owner's
`<char_id>`.

- [x] As the **DM** (`ejcaldwell06`), read both tables → **rows returned**:
      ```js
      await supabase.from('abilities').select('*').eq('character_id', '<char_id>')
      await supabase.from('spells').select('*').eq('character_id', '<char_id>')
      ```
- [x] As the **DM**, attempt to modify each → **0 rows**; insert → **403**:
      ```js
      await supabase.from('spells').update({ name: 'HACKED' }).eq('character_id', '<char_id>').select() // → []
      await supabase.from('abilities').insert({ character_id: '<char_id>', name: 'X' }).select()        // → 403
      ```
- [x] As the **co-player** (`ejcaldwell.test`), read either table → **0 rows**;
      write → rejected.
- [x] Signed out (anon), read either table → **0 rows**.

## Pass criteria

Abilities and spells add/edit/reorder(abilities)/regroup-by-level(spells) and
persist on refresh; the DM can read both but not write, and co-players/anon
cannot read them.

## Run log

- **2026-07-13** — PASS. Owner (`ejcaldwell000`), character
  `47ac79be-d1ac-4c40-93ea-2016a5a0fa33`, campaign "Test 1".
  - **Abilities** — add/name/uses (blank = at-will)/expandable description,
    debounced autosave, drag-reorder, delete-confirm, and persistence all verified.
  - **Spells** — add per level, level-change regroup, prepared toggle,
    description, delete-confirm, persistence verified.
  - **RLS (data layer)** — DM read: 2 abilities / 3 spells returned; DM update →
    `data: []`; DM insert → **403 Forbidden**. Co-player reads → `[]` (both
    tables). Anon reads → `[]` (both tables). Matches owner-r/w, DM read-only,
    others-none.

**Feature additions during 2.4 QA (all typecheck + build clean):**
- `AutoTextarea` — description/notes boxes grow to fit content across abilities,
  spells, inventory notes, and journal body (no fixed scroll box).
- **Within-level drag-reorder for spells**, locked to level (cross-level moves
  only via the level selector); order persisted to `spells.position` via
  `reorderSpells`; new spells append to the bottom of their level group.
