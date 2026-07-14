# QA — Phase 2.3: Lore, backstory & portrait

Verifies the character's narrative lore fields (2.3 backend/UI) and confirms the
portrait access model. Acceptance criteria from
[`PLANNING.md`](../../PLANNING.md) §2.3.3:

> - Upload a portrait; it displays for the owner and DM; non-members get no URL.

## Architecture recap (what you're testing)

- **Lore fields** — `characters.backstory / appearance / personality` (migration
  0014), plain-text columns edited on the **"Backstory"** tab
  ([`LorePanel`](../../src/features/lore/LorePanel.tsx)). Each has an Edit/Preview
  toggle; Preview renders an **XSS-safe markdown subset** (bold/italic/code/
  paragraphs) — the source is HTML-escaped before any tag is inserted
  ([safeMarkdown.ts](../../src/features/lore/safeMarkdown.ts)), so player prose
  can never inject markup/script into the DM's view. RLS is unchanged (0010
  columns): owner read/write, DM read-only, others none.
- **Portrait** — already built in 2.1 on the **"My character"** tab
  (`characters.portrait_asset_id`, uploaded through the 1.6 media pipeline and
  served from the private `media` bucket via short-lived signed URLs). The 2.3.3
  portrait test therefore exercises the character tab + the 0008 Storage RLS.

  > **Deviation from the plan (intentional):** the plan placed the portrait
  > uploader on this tab; it already lives on "My character" from 2.1, so it
  > wasn't duplicated here. The lore tab focuses on the narrative fields.

## Prerequisites (shared)

- Dev server against `fnykpoattheldxtkrozd`. Reuse the 2.1/2.2 data: campaign
  **"Test 1"**, DM `ejcaldwell06`, character owner `ejcaldwell000`, co-player
  `ejcaldwell.test`. The character already has a portrait from the 2.1 run.

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Lore editing & safe rendering | [lore-editing.md](lore-editing.md) | Edit backstory/appearance/personality; Edit↔Preview; safe markdown (bold/italic/code); **HTML/script is escaped, not executed**; autosave + persistence |
| Portrait access | [portrait-access.md](portrait-access.md) | Portrait displays for the **owner and DM**; a signed URL is obtainable by members but **not by a non-member** (0008 Storage RLS) |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — type-check + build only.

## Pass criteria for the phase

A player can write and format their backstory/appearance/personality (with a safe
Preview and no HTML injection), and it persists; a portrait uploaded on the
character displays for the owner and the DM, while a non-member cannot obtain a
URL for it.
