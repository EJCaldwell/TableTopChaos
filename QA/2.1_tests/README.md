# QA — Phase 2.1: Character record & flexible sheet

Verifies the player character workspace built in 2.1: the `characters`,
`sheet_sections`, and `sheet_fields` tables + their RLS (migration 0010), and the
`CharacterPanel` UI (creation, free-form sections/fields, debounced autosave with
optimistic UI, drag-to-reorder, portrait upload, starter layout). Acceptance
criteria are from [`PLANNING.md`](../../PLANNING.md) §2.1.3:

> - Player adds/renames/reorders sections & fields; everything persists on refresh.
> - DM can view (read-only) but a second player cannot.

## Architecture recap (what you're testing)

- **`characters`** — one row per character (owner, campaign, name, optional
  `portrait_asset_id` → `media_assets`). **`sheet_sections`** (character, title,
  `position`) and **`sheet_fields`** (section, label, value, `position`) hold the
  free-form notepad structure — **no fixed schema**.
- **RLS (0010):** owner has full read/write; the campaign **DM has read-only**;
  **other players have no access**. Enforced via SECURITY DEFINER predicates in
  the non-exposed `private` schema (`can_read_character` / `can_write_character`
  and their `…_section` wrappers), mirroring 0003's membership predicates.
- **UI** ([`CharacterPanel`](../../src/features/character/CharacterPanel.tsx)):
  rendered under the player-only **"My character"** tab. Autosave is **debounced
  ~600 ms per entity** and optimistic (local edits apply instantly). Reordering
  uses native HTML5 drag-and-drop and writes new `position` values.

## Prerequisites (shared)

- Dev server (`npm run dev`) against live project `fnykpoattheldxtkrozd`.
- **Account A** owns a campaign and is its **DM**.
- **Account B** is a **player** member of that campaign (redeem an invite code).
- **Account C** is signed up but is **NOT** a member of that campaign (for the
  "other player / non-member no access" test).
- A test image on hand for the portrait upload (PNG/JPEG).

> **Note — DM read-only surface.** RLS *allows* a DM to read a player's sheet, but
> the DM-facing UI to view it (the "Party" tab) ships in a later phase. So the
> "DM can view (read-only)" criterion is verified here at the **data layer** (a DM
> SELECT succeeds; a DM write is rejected), not through a DM screen. This is called
> out explicitly in [access-control.md](access-control.md).

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Sheet editing & persistence | [sheet-editing.md](sheet-editing.md) | Create character; add/rename/delete sections & fields; **drag-to-reorder**; autosave + optimistic UI; **starter layout**; portrait upload; **everything persists on refresh** |
| Access control (RLS) | [access-control.md](access-control.md) | Owner full read/write; **DM read-only** (SELECT ok, write rejected — data layer); a **second player / non-member has no access**; unauthenticated default-deny |
| Follow-up fixes | [followup-fixes.md](followup-fixes.md) | Delete **confirmations** for populated fields/sections; drag-to-reorder reaches the **last position** + **visual drop indicator**; offline saves **retried on reconnect** |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only (no
test runner yet), plus notes on why editing/RLS need manual verification.

## Pass criteria for the phase

A player can create a character and freely add, rename, reorder, and delete
sections and fields; all of it survives a page refresh. The campaign DM can read a
player's character/sheet but cannot modify it, and a player who is not the owner
(including a non-member) cannot read it at all.

## Phase result

**2026-07-09 — PASS (both areas).** All acceptance criteria met. RLS is exactly as
designed (owner read/write, DM read-only, other players/anon no access).

Three **non-blocking UX/robustness follow-ups** surfaced during sheet-editing and
have since been **fixed and re-verified** — see
[followup-fixes.md](followup-fixes.md):
1. ~~No delete confirmation for fields/sections that contain content.~~ **Fixed.**
2. ~~Can't drag a section/field to the last position; no visual drop indicator.~~ **Fixed.**
3. ~~Offline/failed autosaves aren't retried on reconnect.~~ **Fixed.**
