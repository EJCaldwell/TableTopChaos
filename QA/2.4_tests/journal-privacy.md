# QA — Journal privacy

**Phase:** 2.4. Verifies the personal journal edits/persists and — the headline
2.4.3 criterion — is **invisible to the DM by default**, becoming DM-readable for
a single entry only when the player shares it, and never readable by other
players. The DM can never write.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
character owner (`ejcaldwell000@gmail.com`), open campaign "Test 1", **Journal**
tab. Have the owner's `<char_id>` handy.

## Steps — editing (owner)

- [x] Add an entry; give it a title and body. Indicator debounces to **All
      changes saved**.
- [x] Add a **second** entry. Leave one entry **unshared** and toggle
      **Share with DM** ON for the other.
- [x] **Refresh** → both entries, their text, and the shared toggle states persist.
- [x] Delete a blank entry → no prompt; delete one with content → confirm prompt.

## Steps — DM visibility (the key check)

Note the two entries' ids (as owner):
```js
await supabase.from('journal_entries').select('id, title, shared').eq('character_id', '<char_id>')
```

- [x] As the **owner**, that select returns **both** entries (shared and not).
- [x] Sign in as the **DM** (`ejcaldwell06`) and run:
      ```js
      await supabase.from('journal_entries').select('*').eq('character_id', '<char_id>')
      ```
      → returns **only the shared entry** (the unshared one is **not** present).
- [x] As the **DM**, attempt to read the unshared entry directly by id →
      **0 rows**:
      ```js
      await supabase.from('journal_entries').select('*').eq('id', '<unshared_entry_id>')
      // → data: []
      ```
- [x] As the **DM**, attempt to update/delete the shared entry → **0 rows**
      (the DM can read a shared entry but never write it):
      ```js
      await supabase.from('journal_entries').update({ body: 'HACKED' }).eq('character_id', '<char_id>').select()
      // → data: []
      ```

## Steps — other player & anon

- [x] As the **co-player** (`ejcaldwell.test`), read the journal → **0 rows**
      (even the shared entry — sharing exposes it to the DM only, not co-players).
- [x] Signed out (anon), read the journal → **0 rows**.

## Steps — un-share hides again

- [x] Back as the **owner**, toggle the shared entry **OFF**.
- [x] As the **DM**, re-run the select → now **0 rows** (un-sharing re-hides it).

## Pass criteria

The journal is invisible to the DM by default; only an entry the player marks
`shared` is readable by the DM (and un-sharing hides it again); the DM can never
write; co-players and anonymous callers can read nothing.

## Run log

- **2026-07-14** — PASS. Owner (`ejcaldwell000`), character
  `47ac79be-d1ac-4c40-93ea-2016a5a0fa33`, campaign "Test 1". Two entries:
  `The stamp KM-04` (unshared, `fa132c34…`) and `Debt collected` (shared,
  `66bf3f12…`).
  - **Editing/persistence** — create, edit, share-toggle, refresh-persist, and
    delete-confirm all verified in the UI.
  - **DM visibility** — owner sees both; DM sees only the shared entry; DM read
    of the unshared id → `[]`; DM update → `data: []` (never writes).
  - **Other/anon** — co-player read → `[]`; anon read → `[]` (even the shared
    entry — sharing exposes to the DM only).
  - **Un-share re-hides** — owner toggled `Debt collected` OFF; DM re-read → `[]`.
  Confirms migration 0015 (`journal_entries_select_owner_or_shared_dm` +
  `private.is_character_dm`).

**Feature additions during 2.4 QA (typecheck + build clean):**
- Journal entry **drag-reorder** (persisted to `position` via `reorderEntries`).
- Body box switched to `AutoTextarea` (`minRows` 2) — no excess empty lines on load.
- **Sort selector** — Manual (drag) / Newest first / Oldest first / Title A–Z /
  Title Z–A. Non-manual sorts are view-only (operate on a copy), so the manual
  drag order in `position` always persists and is restored on switching back.
- Subtle per-entry **"Added <timestamp>"** line from `created_at`.
