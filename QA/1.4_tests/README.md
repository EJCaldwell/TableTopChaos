# QA — Phase 1.4: Role-based app shell & navigation

Verifies the campaign workspace shell built in subphase 1.4: a role-filtered tab
bar, a campaign switcher, a DM/player indicator, and the Overview tab (roster +
DM invite codes + owner delete). Acceptance criteria from
[`PLANNING.md`](../../PLANNING.md) §1.4.3:

- The same account in two campaigns sees the correct role/tabs in each.
- A player never sees DM-only tabs in the UI (defense-in-depth atop RLS).

## Prerequisites (shared)

- Dev server running (`npm run dev`) against live project `fnykpoattheldxtkrozd`.
- **Two accounts** signed up (e.g. the two confirmed test users). Call them
  **Account A** and **Account B**.
- At least the ability to create campaigns and mint/redeem invite codes
  (delivered in Phase 1.3).

## Manual areas

| Area | File | What it covers |
|------|------|----------------|
| Role-based tabs | [role-based-tabs.md](role-based-tabs.md) | Correct tab set per role; players never see DM tabs |
| Campaign switcher | [campaign-switcher.md](campaign-switcher.md) | Switcher appears/switches; role/tabs update per campaign |
| Campaign deletion | [campaign-deletion.md](campaign-deletion.md) | Owner-only delete; DB cascade; disappears for all members |

## Automated coverage

See [automated-coverage.md](automated-coverage.md) — for this UI phase that is
the type-checker and build only (no test runner in the project yet — **Vitest
arrived in Phase 8.1**; this sentence records what covered 1.4 at the time).

## Pass criteria for the phase

All three manual area files pass, and `npm run typecheck` + `npm run build`
succeed.
