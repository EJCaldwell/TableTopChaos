# Automated coverage — Phase 1.5

> **Dated record, not the current state.** This file says the project has no test
> runner. That was true when it was written; **Vitest arrived in Phase 8.1**, and
> since 2026-09-01 every unit of work adds unit tests for its pure logic. Left
> as written rather than rewritten — a coverage note describes what covered a
> phase AT THE TIME, and editing it to match today would erase the fact that this
> phase shipped without a runner.

**Phase:** 1.5 (Monetization).

This project still has **no test runner** (no Vitest/Jest/Playwright in
[`package.json`](../../package.json)). Automated verification is limited to static
checks:

| Check | Command | What it guards |
|-------|---------|----------------|
| Type-check | `npm run typecheck` (`tsc -b --noEmit`) | The billing API, `BillingPanel`, and the `BillingInterval`/`CampaignSubscription` types compile against the generated DB types (post-0005). |
| Production build | `npm run build` (`tsc -b && vite build`) | The billing tab builds with no unresolved imports or type errors. |

> The Edge Functions run on **Deno**, not the Vite toolchain, so `tsc`/`vite`
> here do **not** type-check `supabase/functions/**`. They were verified at
> author time and by a successful deploy (all three ACTIVE, v1). A future
> `deno check supabase/functions/**/*.ts` would be the way to add real static
> coverage for the function code.

## Source under test

- [`src/features/billing/api.ts`](../../src/features/billing/api.ts) — `getSubscription`, `startCheckout`, `openBillingPortal`, `PLAN_PRICING`.
- [`src/features/billing/BillingPanel.tsx`](../../src/features/billing/BillingPanel.tsx) — state derivation + actions.
- [`supabase/functions/create-checkout-session/index.ts`](../../supabase/functions/create-checkout-session/index.ts)
- [`supabase/functions/stripe-webhook/index.ts`](../../supabase/functions/stripe-webhook/index.ts)
- [`supabase/functions/create-billing-portal-session/index.ts`](../../supabase/functions/create-billing-portal-session/index.ts)
- `supabase/migrations/0005_billing.sql` — schema, RLS, entitlement functions.

## Why most billing logic stays manual

The core behaviors — trial vs immediate billing, signature verification, the
one-trial-per-card revoke, status transitions — are only meaningful against
**Stripe** (real sessions, webhook signatures, test clocks) and the **live DB**
(RLS, `SECURITY DEFINER` entitlement functions). They can't be exercised by a
pure unit test, so they live in the manual checklists.

## Future automated candidates

If a runner is added, the cheapest wins are the **pure** pieces:
- `deriveState(sub)` in `BillingPanel.tsx` — map each Stripe status (+ null) to
  the coarse UI state; today only covered by eyeballing the status card.
- `daysUntil(iso)` — trial-days-left math.
- `INTERVAL_BY_PRICE` / `isBillingInterval` in the function `config.ts` — price↔
  interval mapping and interval validation.

Signature verification and the anti-abuse branch would need mocked Stripe
fixtures and are better left to the manual + Stripe-test-clock passes.
