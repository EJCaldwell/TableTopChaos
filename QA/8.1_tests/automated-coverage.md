# Automated coverage — Phase 8.1

**This subphase IS the automated coverage.** Before it, "automated" meant `tsc`
plus one hand-rolled Node harness; there was no test runner and no way to assert
that a function returns the right answer.

## Toolchain

| | |
|---|---|
| Runner | **Vitest 3** (`npm test`, `npm run test:watch`) |
| DOM | **jsdom** |
| Component testing | **React Testing Library** + `@testing-library/jest-dom` |
| Coverage | **v8** (`npm run coverage` → text + HTML) |

Config lives in [vitest.config.ts](../../vitest.config.ts), kept separate from
`vite.config.ts`: one file describes how the app is BUILT, the other how it is
TESTED, and merging them means every production build parses test settings.

Tests sit next to the code they cover (`src/**/*.test.ts{,x}`) so a module and
its test move together and an untested module is visible in the file listing.

**`tsc -b` type-checks the test files too** — `tsconfig.app.json` includes all of
`src`. That is deliberate and it earned itself immediately: the build rejected two
unsound casts in the realtime test that Vitest had been happy to run.

## Results — 129 tests, 6 files, all passing

| Module | Tests | Stmt coverage |
|---|---|---|
| `features/dm/dice.ts` | 27 | **100%** |
| `features/status/hp.ts` | 26 | **100%** |
| `features/lore/safeMarkdown.ts` | 19 | **100%** |
| `features/profile/username.ts` | 27 | **100%** |
| `features/realtime` (`mergeById`) | 11 | — |
| `features/campaigns/OverviewPanel.tsx` | 7 | — |

**Whole-app statement coverage is 2.48%, and that number is honest.** The suite
covers the extracted pure logic and one component; the other ~40 panels have no
tests. Reporting a flattering figure by narrowing the coverage scope to only
tested files would make the metric useless for tracking 8.2/8.3.

## Three modules were EXTRACTED to make them testable

Not a refactor for tidiness — each was unreachable from a test:

- **`dm/dice.ts`** — `rollNotation` lived inside CombatPanel and called
  `Math.random` directly. Randomness is now injected, so tests assert **exact
  totals** instead of ranges. A range assertion ("between 2 and 12") passes just
  as happily when the code drops a modifier.
- **`status/hp.ts`** — damage/heal and death-save clamping lived inside
  HpConditionsPanel, tangled with state and a save call. This is the most
  consequential arithmetic in the app.
- Behaviour is unchanged in both; only the seam is new.

## What is NOT covered

- Every other panel, all data-access modules, and all Edge Functions.
- Anything requiring a real Supabase connection — that is **8.2** (RLS tests).
- Full user journeys in a real browser — that is **8.3** (Playwright).
- `extractNpcHp`, initiative sort and the import id-remap, named in PLANNING but
  not yet extracted from their components.
