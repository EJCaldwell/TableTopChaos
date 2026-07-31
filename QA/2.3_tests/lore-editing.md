# QA — Lore editing & safe rendering

**Phase:** 2.3. Verifies the owning player can write and format their character's
lore fields, that Preview renders a safe markdown subset, that HTML/script is
escaped (not executed), and that edits persist.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
character owner (`ejcaldwell000@gmail.com`), open campaign "Test 1", select the
**"Backstory"** tab.

## Steps — edit & autosave

- [x] Type text into **Backstory** (include a blank line to make two paragraphs).
      The indicator shows **"Saving…"** → **"All changes saved"** (debounced).
- [x] **Refresh** → all three fields persist exactly.

## Steps — safe markdown Preview

- [x] In Backstory type: `This is **bold**, this is *italic*, and this is ` +
      `` `code` ``. Click **Preview** → bold/italic/code render accordingly;
      paragraphs separate on blank lines.

## Steps — XSS safety (important)

- [x] In Appearance, type a literal HTML/script string, e.g.
      `<script>alert('x')</script>` and `<b onclick="alert(1)">hi</b>`.
- [x] Click **Preview** → the text appears **as literal characters** (you see the
      `<script>…</script>` text); **no alert fires**, no bold "hi", no clickable
      element. (The renderer HTML-escapes everything before adding only its own
      tags.)
- [x] Refresh and Preview again → still inert.

## Steps — offline retry (optional)

- [x] Network → **Offline**, edit a field → **"Save failed"**. Back to **Online**
      without editing → auto **"Saving…/All changes saved"**; refresh → persisted.

## Steps — preview-on-load (added during 2.3 QA)

- [x] With saved content present, **reload** the Backstory tab → each populated
      field opens in **Preview** (rendered), empty fields open in **Edit**. Toggle
      still works both ways.

## Pass criteria

All three lore fields edit with debounced autosave and persist on refresh; Preview
renders bold/italic/code and paragraphs; and any HTML/script the player types is
shown as inert text, never executed.

## Run log

- **2026-07-13** — PASS. All groups verified by the owner (`ejcaldwell000`) in
  campaign "Test 1": edit + debounced autosave + persistence; safe-markdown Preview
  (bold/italic/inline-code, blank-line paragraphs); XSS safety (HTML/script shown
  as inert literal text, no execution); offline-retry. Added a **preview-on-load**
  behavior during QA — populated fields now open in Preview after reload (empty
  fields open in Edit); verified PASS. Renderer safety re-confirmed at the code
  level (escape-first, then only fixed tags — [safeMarkdown.ts](../../src/features/lore/safeMarkdown.ts)).
