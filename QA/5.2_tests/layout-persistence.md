# Manual checklist — Saved layouts: recovery & staleness (Phase 5.2)

**Phase:** 5.2 — Mode-aware app shell
**Run by:** the user, in the browser on :5173.

The saved layout (`campaign:<id>:layout`) is **untrusted input** — not in the
attacker sense, but in the boring one: it can be written by an older build, saved
on a different-sized screen, or truncated mid-write, and the workspace has to cope
with whatever it finds. A corrupt *view preference* must never be able to break
the workspace.

**No console steps.** This file used to be five console snippets, which had no
path to completion. They are gone: the storage-parsing cases are now covered by
`npm run qa:checks` (30 assertions, see
[automated-coverage.md](automated-coverage.md)), and what remains here is only
what genuinely needs a human at the rendered UI.

## Design notes (why this file is short now)

- **Version field.** `saveLayout` stamps `LAYOUT_VERSION`; `loadLayout` discards
  any layout not carrying the current version. Stale schemas are dropped
  wholesale rather than pruned field-by-field forever. That retires the old
  per-key steps for `'billing'` (5.2.1b) and `drawerOpen` (5.2.1c) — one behavior
  now covers both, tested in step 1.
- **Automated instead of manual.** `loadLayout` and `clampRect` are pure
  functions over a string, so they are exercised directly in Node against a
  stubbed `localStorage` — corrupt JSON, stale/future schema versions, retired
  tab keys, role filtering, duplicates, non-finite numbers and the whole clamp
  geometry. That is better evidence than pasting a snippet: repeatable, one
  second, and it re-runs on every future change.
- **`clampRect`.** Fixed a real bug found while reviewing this file: `loadLayout`
  clamped coordinates at zero but had **no upper bound**, so a window saved near
  the right edge of a wide monitor restored off-screen in a narrow window — and
  the area is `overflow: hidden`, so it was invisible and unreachable. Windows
  are now clamped against the measured area whenever it is measured or resized.
  Step 2 is the regression test.
- **The removed "player injects a DM-only panel" step** was theatre and is gone.
  A player owns their own localStorage, so it demonstrated nothing about
  security; the DM-only tables return `[]` to them under RLS regardless. The
  chrome not offering the tab is tidiness, not an access control, and the honest
  place to test role gating is with a real player account —
  [workspace-shell.md](workspace-shell.md) step 25.

## Prerequisites

- Campaign **"Main Test"**; DM `ejcaldwell06`.
- A second campaign the DM owns, for step 4.

## Steps

- [ ] 1. **Stale schema is discarded.** Your browser still holds a layout written
      by an earlier build (no version stamp). The first time you open "Main Test"
      on this build, expect a **clean default workspace** — nothing open, rail
      **expanded on the right** — rather than a half-restored arrangement or a
      console error. Your previous arrangement being gone is the *correct*
      outcome here, not a bug.
- [ ] 2. **Off-screen windows are recovered.** ← *this is the regression test for
      the bug above; please don't skip it*
      1. With the browser **maximized**, open a section and drag its window to
         the **far right** of the workspace area.
      2. **Narrow the browser window** to roughly half width.
      3. The window should be **pulled back into view** as you resize — never
         vanishing off the right edge. (Before the fix it disappeared with no
         scrollbar to reach it.)
      4. **Reload** at the narrow size → it is still on screen and usable.
      5. Maximize again — it stays where it is. Clamping pulls windows *in*; it
         does not fling them back out.
- [ ] 3. **Layouts survive normal use.** Open three windows, drag/resize them to
      distinctive spots, move the rail to the left and collapse it. Hard-refresh
      → all three return at the same positions, sizes and stacking order, rail
      still collapsed on the left.
- [ ] 4. **Layouts are per campaign.** Open the second campaign → it has its own
      independent, default layout (nothing open, rail right). Return to "Main
      Test" → your arrangement is intact.
- [ ] 5. **A section never opens twice.** With a window already open, click its
      rail entry repeatedly and confirm you only ever get **one** window for it —
      it raises and closes, never duplicates. (A duplicate would mount the panel
      twice and run two copies of its queries and realtime subscriptions.)

## Pass criteria

A layout from an older build is discarded cleanly rather than half-restored;
windows can never end up off-screen and unreachable, whether from a smaller
viewport or a resize; arrangements persist across refresh and are per campaign; a
section never opens more than one window. Nothing errors in the console. (The
storage-parsing half of this area is proved by `npm run qa:checks`, not by these
steps.)

## Run log

**2026-08-07 — PARTIAL, against the superseded 5.2.1 build.** The user reported
the plain-persistence steps good (arrangement survived refresh, navigation, a
campaign switch and a mode round trip; per-campaign; player rail gating correct).
**Every console-snippet step was NOT RUN** — recorded as unverified, not passed.

> **Follow-up (2026-08-10).** Re-examining those unrun steps in order to explain
> them surfaced a **real bug**, not merely an untested path: `loadLayout` had no
> upper clamp on x/y, so a window saved on a wide viewport restored outside the
> `overflow: hidden` workspace area — invisible and unreachable, recoverable only
> via Close tabs, which closes it rather than retrieving it. Fixed with
> `clampRect`, applied on measure and on every resize, correcting state so the fix
> persists. `LAYOUT_VERSION` was added at the same time so stale schemas are
> discarded wholesale.
>
> **Follow-up 2 (2026-08-10).** On the user's instruction that console steps are
> not theirs to run, the last one was removed rather than left optional: the
> storage-parsing cases moved into `QA/tools/layout-checks.mts` (`npm run
> qa:checks`), which asserts them directly against stubbed storage — **30/30
> passing**, including the exact corrupt-JSON case the snippet covered. What is
> left below is only what needs a human at the UI. **The file is open and needs a
> fresh run.**
