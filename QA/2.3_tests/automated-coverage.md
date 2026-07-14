# QA — Phase 2.3 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes the lore feature
  (`src/features/lore/*`) and the regenerated `characters` types (now with
  `backstory` / `appearance` / `personality`).
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **Safe-markdown rendering / XSS behavior** — that HTML/script author input is
  escaped and never executed is verified manually in
  [lore-editing.md](lore-editing.md). (The renderer escapes all input before
  inserting only its own fixed tags — see
  [safeMarkdown.ts](../../src/features/lore/safeMarkdown.ts).)
- **Portrait Storage RLS** — owner/DM get a signed URL, non-member does not —
  verified manually in [portrait-access.md](portrait-access.md).
- **Autosave / persistence** — behavior, verified manually.

## Notes

- No new RLS in 2.3: lore columns live on `characters` (0010 policies) and the
  portrait reuses the 0008 media Storage policy.
- If a hand-rolled safe-markdown renderer ever grows (links, images, tables),
  revisit whether a vetted sanitizer library is warranted rather than expanding
  the regex approach.
