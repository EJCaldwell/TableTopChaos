# QA — Phase 3.5 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes `CombatPanel` (initiative
  tracker + dice roller), the `initiativeApi` module, and the regenerated
  `initiative_entries` type.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS / DM-only access** — that players and anon can read/write no
  `initiative_entries` — verified per account in
  [access-control.md](access-control.md).
- **Dice parsing / initiative sort / step-through** — behavior, verified in
  [combat-tools.md](combat-tools.md).

## Notes

- `initiative_entries` enforces access on `is_campaign_dm(campaign_id)` for all
  four operations (migration 0022). Advisors reported no new findings after 0022.
- The **dice roller is entirely client-side** — no table, no network. The plan's
  optional `dm_dice_log` was intentionally omitted, so "visible only to the DM"
  for dice is inherent (it never leaves the DM's browser).
