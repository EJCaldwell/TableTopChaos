# QA — Notes editing

**Phase:** 3.1. Verifies the DM can manage secret notes — create, edit, tag,
filter, reorder, delete — that everything autosaves and persists, and that the
tags input accepts comma- and space-separated values while typing.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open campaign **"Test 1"**, **Secret notes** tab.
(Access control is covered separately in [access-control.md](access-control.md).)

## Steps — editing

- [x] Click **+ New note**, give the note a title and body → indicator debounces
      to **All changes saved**.
- [x] Add a **second** note with a different title/body.
- [x] Delete a pristine (blank) note → no prompt; delete one with content →
      confirm prompt ("Delete this note?").
- [x] **Refresh** → remaining notes, their titles, and bodies persist.

## Steps — tags typing (the comma/space fix)

- [x] In a note's tags input, type `goblins, forest, chapter 2` **including the
      commas and spaces** → the text appears exactly as typed (commas and spaces
      are **not** stripped away mid-typing).
- [x] **Refresh** → the tags input shows the cleaned stored form
      (`goblins, forest, chapter 2`); duplicate or empty tags are dropped.
- [x] Confirm at the data layer (as the DM):
      ```js
      await supabase.from('dm_notes').select('title, tags').eq('campaign_id', '<campaign_id>')
      // tags → ['goblins', 'forest', 'chapter 2']
      ```

## Steps — tag filter bar

- [x] With at least two notes carrying **different** tags, the filter bar shows
      an **All** chip plus one chip per distinct tag (sorted).
- [x] Click a tag chip → only notes carrying that tag are listed; the chip is
      highlighted.
- [x] Remove the last note carrying the active filter's tag (delete or retag it)
      → the filter automatically falls back to **All** (no "nothing matches a
      tag that's gone" dead end).

## Steps — drag-reorder

- [x] With **All** selected (no tag filter), drag a note by its `⠿` handle to a
      new position, including to the bottom → an insertion bar marks the drop gap.
- [x] **Refresh** → the new order persists.
- [x] With a tag filter **active**, confirm the drag handle is **absent** (reorder
      only applies to the full, unfiltered list).

## Pass criteria

Notes create/edit/delete with debounced autosave and persist on refresh; the
tags input accepts commas and spaces while typing and stores a clean, de-duped
list; the tag-filter bar narrows and resets correctly; and drag-reorder persists
(and is disabled while filtered).

## Run log

- **2026-07-15** — PASS. DM (`ejcaldwell06`), campaign "Test 1"
  (`d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`). Editing (create/edit/delete-confirm/
  persist), tags typing (commas + spaces survive; clean de-duped storage), tag
  filter bar (narrow/reset/auto-fallback), and drag-reorder (persists; handle
  hidden while filtered) all verified in the running app.
