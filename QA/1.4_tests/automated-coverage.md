# Automated coverage — Phase 1.4

**Phase:** 1.4 (Role-based app shell & navigation).

This project has **no test runner** (no Vitest/Jest/Playwright in
[`package.json`](../../package.json)). Automated verification for this phase is
therefore limited to static checks:

| Check | Command | What it guards |
|-------|---------|----------------|
| Type-check | `npm run typecheck` (`tsc -b --noEmit`) | Props/types across the new shell, panels, and tab config compile; the `TabAudience` union and `WorkspaceTab` shape are respected. |
| Production build | `npm run build` (`tsc -b && vite build`) | The workspace shell builds with no unresolved imports or type errors. |

## Source files under test

- [`src/features/campaigns/tabs.ts`](../../src/features/campaigns/tabs.ts) —
  tab catalog + `tabsForRole(isDm)` gating helper.
- [`src/features/campaigns/CampaignPage.tsx`](../../src/features/campaigns/CampaignPage.tsx) —
  the shell (loading, role derivation, switcher, tab bar, panel routing).
- [`src/features/campaigns/OverviewPanel.tsx`](../../src/features/campaigns/OverviewPanel.tsx) —
  Overview tab (roster, DM invite codes, owner danger zone).
- [`src/features/campaigns/PlaceholderPanel.tsx`](../../src/features/campaigns/PlaceholderPanel.tsx) —
  coming-soon body for unbuilt tabs.

## Future automated candidate

`tabsForRole(isDm)` in `tabs.ts` is a **pure function** and is the natural first
unit test when a runner is added: assert a DM's tab set contains `secretnotes`
and excludes `character`, and a player's set is the inverse. This is the logic
behind the "a player never sees DM-only tabs" criterion, so covering it in code
would let the manual check in [role-based-tabs.md](role-based-tabs.md) shrink to
a spot-check.
