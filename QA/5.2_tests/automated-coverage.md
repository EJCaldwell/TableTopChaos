# Automated coverage — Phase 5.2

No test runner in this project yet (Phase 8). "Automated" here means the
TypeScript build. **No migration shipped in 5.2**, so there is no `get_advisors`
run and no server-side access-control checklist — see the README for why.

## Commands

| Command | What it proves |
|---------|----------------|
| `npm run build` (`tsc -b` + `vite build`) | Whole app type-checks and bundles. `noUnusedLocals` / `noUnusedParameters` are on, so the panel imports CampaignPage shed when its inline chain moved into `TabBody` had to actually leave. |
| `npm run qa:checks` | **New in 5.2.1d.** Type-checks the harness (`tsconfig.qa.json`) then runs [QA/tools/layout-checks.mts](../tools/layout-checks.mts) — **40 assertions** over `loadLayout` / `saveLayout` / `clampRect` / `clampRailWidth` against a stubbed `localStorage`. |

## The layout harness (`npm run qa:checks`)

This is the project's **first real automated test** of behavior rather than
types, and it exists for a specific reason: the interesting failure modes of the
saved layout are all "what if storage holds something bad", which through the
running app means pasting snippets into a browser console — a step the user does
not run, so those paths sat permanently unverified.

None of that logic needs a browser. It is pure functions over a string, so the
harness stubs `localStorage` and calls them directly. That is *better* evidence
than a human pasting a snippet: repeatable, one second, and it re-runs free on
every future change. It is not a general test runner — the project still has none
(Phase 8) — just a dependency-light script with a hand-rolled `check()`.

What it covers, all of which used to be manual console steps or nothing at all:

- **Corrupt input** — bad JSON, `null`, a non-object, a non-array `floating`.
- **Schema versioning** — an unversioned (pre-5.2.1d) layout is discarded
  wholesale, and so is a *future* version rather than being partly trusted.
- **Retired tab keys** — a stored `billing` window is dropped.
- **Role gating** — the same stored blob gives a DM their `secretnotes` window
  and gives a player only the shared one.
- **Geometry** — negative coords clamped, sub-minimum sizes raised, non-finite
  numbers rejected outright, duplicate keys collapsed to one window.
- **`clampRect`** — the 5.2.1d bug: a far-off-screen window is pulled back with
  enough left to grab; an oversized one is shrunk to fit but never below the
  minimum and never shoved off the left edge; a viewport smaller than the
  keep-visible margin still yields non-negative coords; clamping is **idempotent**
  (which is what stops the correcting effect looping); an unmeasured area leaves
  the rect alone.
- **Rail width (5.2.1e)** — in-range widths pass through; too-narrow raised,
  too-wide capped, missing/non-numeric/NaN defaulted, fractions rounded; an
  out-of-range stored width clamped on load. Plus the additive-field case: a v1
  layout with **no** `railWidth` is **kept** (not discarded) and gains the
  default, since bumping the version over a field with a sensible default would
  throw away the user's arrangement for nothing.
- **Round trip** — a saved arrangement restores exactly, stacking order included,
  with the version stamped.

The harness is type-checked by its own `tsconfig.qa.json` before it runs, because
the app's tsconfig covers `src/` only. Without that it would rot silently: it
imports `CampaignLayout` and `WorkspaceTab`, so a field added to either would
leave the checks asserting against a shape that no longer exists — which is
exactly what `railWidth` would have done.

## What the build actually catches for 5.2

- **Every surface renders the same panels.** The `activeTabDef?.key === …` chain
  that used to live in `CampaignPage` is now the single `TabBody` component, which
  every floating window calls with the same props. A tab mapping to a different
  panel in one place than another is no longer *expressible*.
- **Role gating has one source.** `WorkspaceShell` takes `visibleTabs` from the
  one `tabsForRole(isDm)` memo in `CampaignPage`; the rail has no list of its own.
  `TabBody` additionally re-asserts each panel's `isDm` / `currentUserId` guard,
  so even a forced tab key falls through to `PlaceholderPanel`.
- **Billing left the catalog cleanly (5.2.1b).** Removing the `'billing'` tab and
  its `TabBody` branch would have left an unused `BillingPanel` import, which
  `noUnusedLocals` fails — so the move to `SettingsPanel` could not be half-done.
- `FloatRect` / `CampaignLayout` are shared by `layout.ts`, `WorkspaceShell` and
  `FloatingPanel`, so a rect field renamed on one side breaks the others.

## What the build explicitly does NOT catch

Everything about *placement and interaction*, which is most of 5.2's risk surface:
drag and resize behavior, the "a panel is docked **or** floating, never both"
invariant, z-order on focus, whether a restored layout actually lands on screen,
and whether the full-bleed frame actually fills the window. `loadLayout`'s
defensive parsing is likewise untyped input at runtime — the compiler has no
opinion on hand-edited localStorage. All of it is in the manual checklists.

## Source under test

- [src/features/campaigns/CampaignPage.tsx](../../src/features/campaigns/CampaignPage.tsx) — full-bleed `100dvh` frame, campaign name in the header's centre slot, title bar + switcher removed
- [src/components/AppHeader.tsx](../../src/components/AppHeader.tsx) — new optional `center` slot
- [src/features/campaigns/TabBody.tsx](../../src/features/campaigns/TabBody.tsx) — extracted panel chain (new)
- [src/features/campaigns/WorkspaceShell.tsx](../../src/features/campaigns/WorkspaceShell.tsx) — rail + docked panel + floating layer, all modes (new; was PlayspaceShell.tsx in 5.2.1)
- [src/features/campaigns/tabs.ts](../../src/features/campaigns/tabs.ts) — `'billing'` removed from the catalog
- [src/features/campaigns/SettingsPanel.tsx](../../src/features/campaigns/SettingsPanel.tsx) — new Plan & billing section
- [src/features/campaigns/FloatingPanel.tsx](../../src/features/campaigns/FloatingPanel.tsx) — draggable/resizable window (new)
- [src/features/campaigns/layout.ts](../../src/features/campaigns/layout.ts) — layout shape + localStorage load/save (new)

## Run log

**2026-08-07 — PASS.**
- `npm run build` → clean, 146 modules, `built in 2.66s`, no type errors.
  Bundle 650.63 kB → 659.90 kB (+8.3 kB for the new shell).
- No migration ran, so no advisor check was applicable.

**2026-08-10 — PASS (5.2.1b).**
- `npm run build` → clean, 146 modules, `built in 1.48s`, no type errors.
  Bundle 659.90 → 660.39 kB.
- Still no migration, so still no advisor check.
- Note what the build could NOT catch here: the layout nesting change (floating
  windows overlaying the whole content region rather than only the leftover
  space) and the eight resize handles are pure CSS/geometry. Both are manual.

**2026-08-10 — PASS (5.2.1c).**
- `npm run build` → clean, 146 modules, `built in 1.28s`, no type errors.
  Bundle 661.03 → 659.04 kB (the docked-panel and pop-out/dock code outweighed
  the new rail-side and header-slot code).
- Still no migration, so still no advisor check.
- What the build DID catch during this change: removing the docked panel left
  `activeTab` unused as a `WorkspaceShell` prop and `useNavigate` unused in
  `CampaignPage` once the switcher went — `noUnusedLocals`/`noUnusedParameters`
  failed both until they were removed, so no dead wiring survived the rework.
- What it did NOT catch: which side the rail renders on, whether the accent
  markers and divider flip with it, that the campaign name is visually centred,
  and the whole click-to-open toggle sequence. All manual.

**2026-08-12 — PASS (5.2.1e — draggable rail).**
- `npm run build` → clean, 146 modules, `built in 1.36s`. Bundle 659.58 → 660.45 kB.
- `npm run qa:checks` → **40 passed, 0 failed** (30 → 40 with the rail-width checks).
- Added `tsconfig.qa.json` + `@types/node` so the harness is type-checked before
  it runs; caught nothing today, but `railWidth` is precisely the kind of change
  that would have silently invalidated it.
- No migration, so no advisor check.

**2026-08-10 — PASS (5.2.1d).**
- `npm run build` → clean, 146 modules, `built in 1.33s`. Bundle 659.04 → 659.58 kB.
- `npm run qa:checks` → **30 passed, 0 failed** (first run of the new harness).
- `tsx` added as a devDependency to run it.
- Still no migration, so still no advisor check.
