# Run log — Test infrastructure + unit tests, 2026-08-27

**PASS.** `npm test` → **129 passed, 0 failed** across 6 files. `npm run build`
clean. `npm run qa:checks` still 62/62. Coverage report generates.

Full detail in [automated-coverage.md](automated-coverage.md).

## Two problems found while building the suite

### 1. `globals: false` silently disabled React Testing Library's cleanup

The first component test failed three ways at once: "Found multiple elements",
an assertion matching a previous test's output, and a query for text that was
never rendered.

Cause: RTL auto-registers `afterEach(cleanup)` **only when a global `afterEach`
exists**, and `vitest.config.ts` sets `globals: false` (chosen so the app's
tsconfig stays free of test-only ambient types). Without it, every `render()`
accumulated in the same document and queries started matching leftovers from
earlier tests.

Fixed by registering cleanup explicitly in
[src/test/setup.ts](../../src/test/setup.ts). Worth recording because the failure
mode is *tests passing against stale renders* — the direction that produces false
confidence rather than a visible error.

### 2. The build caught two unsound casts Vitest ran happily

`tsc -b` type-checks `src/**`, which now includes the test files:

```
mergeById.test.ts(91,23): error TS2352: Conversion of type
'Record<string, unknown>' to type 'Row' may be a mistake…
```

Vitest transpiles without type-checking, so those tests ran green. Keeping tests
inside the app's tsconfig is what caught it — and means a test asserting against
a shape the code no longer has will fail the build rather than rot quietly.

## Two of my own test assertions were wrong, not the code

Recorded because "the test failed" is not the same as "the code is broken", and
the difference matters when reading this later.

- `dm` and `gm` are reserved **and** two characters long. `validateUsername`
  returns the LENGTH message, not the reserved one. Both are true and the name is
  refused either way; pinning the wording made the test fail on a harmless
  ordering. Rewritten to assert refusal.
- A sanity check queried the campaign name inside OverviewPanel — which does not
  render it (it lives in the app header). Removed.

## Closes the Phase 7.4 rendering gap

7.4's server-side QA proved the DATA was right but could not prove React drew it.
[OverviewPanel.test.tsx](../../src/features/campaigns/OverviewPanel.test.tsx) now
asserts, in a real DOM:

| | |
|---|---|
| the roster reads `username (Character)` | ✅ |
| **identical output for a player and for the DM** | ✅ |
| a member with no character shows no empty brackets | ✅ |
| `(you)` marks the viewer without eating their character name | ✅ |
| the deleted "Unnamed adventurer" fallback never appears | ✅ |
| usernames still render when the character lookup **fails** | ✅ |

That fourth-from-last row is the point of migration 0041, and the last one
matters because the character lookup is a nicety while the roster is not — a
failure must degrade the line, never lose it.

**This is stronger than the manual check it replaces**: it re-runs on every
change, where a browser pass is true only on the day it happened.

## Still owed for 7.4

Areas A (party/schedule screens) and C (the rename form) have data-layer
verification but no component tests yet; area E stays blocked on Resend. The
roster — the part with a real access-control decision behind it — is now covered.
