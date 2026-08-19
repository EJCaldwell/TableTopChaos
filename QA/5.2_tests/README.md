# QA — Phase 5.2: Mode-aware app shell (sidebar + pop-out)

Covers 5.2.1 and its two revisions. The design moved twice, so read this before
the checklists:

- **5.2.1** branched the chrome — `notetaker` kept the top tab bar,
  `playspace`/`rpg` got a sidebar shell. Run and passed, then superseded.
- **5.2.1b** dropped the branch: one chrome for every mode, the tab bar deleted,
  billing folded into Settings, all-edge resize, full-bleed layout.
- **5.2.1e** made the rail width draggable.
- **5.2.1f** pinned a permanent red **Close tabs** and **Settings** to the foot of
  the rail; took **Overview** out of the rail (it auto-opens on entry from the
  dashboard); gave **players a Settings tab** holding workspace preferences; and
  moved the **sidebar-side switch** out of the rail into Settings for both roles.
- **5.2.1h** folded **Scheduling into Overview** (it is no longer a tab) and put
  **Overview into the rail footer**, so it is reachable from anywhere — including
  a playspace campaign — rather than only on entry from the dashboard.
- **5.2.1c** removed the docked panel entirely. **Clicking a rail entry now opens
  that panel directly as a floating window**; the entry then toggles raise →
  close. The campaign title bar and the in-workspace campaign switcher are gone
  (the name moved to the app header's centre slot), and the rail is
  side-switchable, **starting on the right**.

Today's shell ([WorkspaceShell.tsx](../../src/features/campaigns/WorkspaceShell.tsx)):
a side-switchable, collapsible tab rail, and every open panel as a floating
window in the area beside it, filling the viewport. The only thing `game_mode`
still changes is what fills that area behind the windows — nothing in
`notetaker`, the Phase 9 battlemap in `playspace`/`rpg`.

## What you are testing

- **One chrome, three modes.** Every floating window renders the same
  [`TabBody`](../../src/features/campaigns/TabBody.tsx), which was
  extracted from CampaignPage's inline chain precisely so nothing can drift on
  which panel a tab maps to, or on who may see it.
- **Role gating is unchanged.** This is the access-control headline for 5.2 — but
  5.2 adds **no new data access whatsoever**: no migration, no new query, no new
  RLS policy. Every panel reaches the database exactly as it did in 5.1, so the
  server-side matrix from earlier phases still governs and there is nothing new
  to verify with the MCP. What *is* new is purely client-side: that the rail and
  a restored floating layout can never surface a tab the role shouldn't see.
- **One window per section.** Since 5.2.1c "open" is simply presence in the
  saved `floating` array, so the old "docked *or* floating, never both" invariant
  is now unrepresentable rather than merely satisfied. What still needs checking
  is that a rail entry can't open a *second* window for a section already open —
  that would mount the panel twice and run two copies of its queries and realtime
  subscriptions.
- **Layout persistence** — rail collapsed, which side it's on, and every window's
  position/size are a per-user, per-campaign **view preference** in
  localStorage (`campaign:<id>:layout`, see
  [layout.ts](../../src/features/campaigns/layout.ts)). Never campaign data, never
  synced between users. `loadLayout` is defensive: corrupt JSON, duplicates,
  panels for tabs the caller can no longer see, and any layout carrying an older
  `LAYOUT_VERSION` are all dropped rather than thrown, and `clampRect` keeps
  windows inside the visible area however the viewport changes.
- **Plan & billing is no longer a tab** (5.2.1b) — it moved into Settings as a
  section. A saved `activeTab` or floating entry of `'billing'` must degrade
  cleanly, since that key no longer exists in the catalog.
- **Settings is now shown to players** (5.2.1f), which makes it the one panel
  whose *contents* are role-split rather than the panel itself. Worth testing on
  its own terms: a player must see the Workspace section and **nothing else** —
  no campaign name, mode, billing, backup or danger zone. The `isDm` check there
  is UI convenience; `campaigns_update_dm` / `campaigns_delete_owner` remain the
  real gate, so this is defense-in-depth, not the control.
- **The rail footer vs the section list.** `railTabs` draws the main list;
  `railFooterTabs` draws Overview and Settings at the bottom. `tabsForRole` still
  returns everything either way — it stays the source of truth for *access*, so
  the drawing helpers can never accidentally turn a hidden tab into a forbidden
  one. `railHidden` remains supported but is currently unused (5.2.1h moved
  Overview from hidden to footer).

## Shared prerequisites

- Dev server on **:5173** against project `fnykpoattheldxtkrozd`.
- Campaign **"Main Test"** `d0e1fc8f-29d6-4381-9cd7-04c9214a80fa`
  (DM `ejcaldwell06`; players include `ejcaldwell.test`).
- You will switch this campaign's mode during the run; leave it on **Note taker**
  at the end.

## Areas

| Area | File | Who runs it | Status |
|------|------|-------------|--------|
| Workspace shell — rail, click-to-open, windows | [workspace-shell.md](workspace-shell.md) | User, in browser | **PASS** 2026-08-22 |
| Saved layouts: recovery & staleness | [layout-persistence.md](layout-persistence.md) | User, in browser | **PASS** 2026-08-20 (step 1 **N/A** — see its run log) |

**Phase 5.2 QA is complete.** It took six browser rounds between 2026-08-07 and
2026-08-22, each of which changed the feature rather than merely certifying it —
the shell was redesigned three times over that span. The final round produced no
follow-ups, which is what closed it. Every round's result is preserved in the run
logs; the earlier ones describe shells that no longer exist and are labelled as
superseded rather than deleted.

Both are browser areas. Unusually for this project there is **no server-side
checklist**, because 5.2 touches no data layer — see the note above. Claude's
contribution is the build plus the structural argument in
[automated-coverage.md](automated-coverage.md).

> The 5.2.1 `notetaker-regression.md` area (asserting the old top tab bar was
> untouched) passed on 2026-08-07 and was then **deleted**, because 5.2.1b
> deliberately removed the tab bar it was guarding. Its result is preserved in
> the run log in [workspace-shell.md](workspace-shell.md).
>
> **The console-snippet gap is closed** (2026-08-10). `layout-persistence.md` used
> to be five console steps with no path to completion. Rather than test around it,
> two cases were removed from the problem space: a **`LAYOUT_VERSION` stamp** makes
> stale schemas discard wholesale (retiring the per-key `billing` / `drawerOpen`
> steps), and **`clampRect`** fixes a real bug — windows saved on a wide viewport
> restored outside the `overflow: hidden` area, invisible and unreachable — which
> is now testable by just resizing the browser. The "player injects a DM-only
> panel" step was **deleted as theatre**: a player owns their own localStorage, so
> it proved nothing; RLS is the control, and role gating is tested with a real
> player account instead. One optional console step remains.

## Phase pass criteria

Every mode renders the rail (right by default, movable to the left, collapsible)
and opens a panel as a floating window on a single rail click; `playspace`/`rpg`
additionally reserve the area for the battlemap; the workspace fills the app
window with the campaign name in the header and no title bar or switcher; windows
drag and resize from any edge; role-based tab gating is identical in all modes and
cannot be bypassed via a saved layout; a section never opens twice; the
arrangement survives a refresh, a mode change and a campaign switch; and Plan &
billing is reachable only inside Settings.
