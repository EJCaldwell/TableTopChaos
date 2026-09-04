# Automated coverage — Phase 7.3

> **Dated record, not the current state.** This file says the project has no test
> runner. That was true when it was written; **Vitest arrived in Phase 8.1**, and
> since 2026-09-01 every unit of work adds unit tests for its pure logic. Left
> as written rather than rewritten — a coverage note describes what covered a
> phase AT THE TIME, and editing it to match today would erase the fact that this
> phase shipped without a runner.

There is still no general test runner in this project. "Automated" here means
`npm run build` (`tsc -b` + `vite build`), the purpose-built Node harness
`npm run qa:checks`, and server-side verification run directly against the
production database over `railway ssh … psql`.

## `npm run build` — clean

Covers the whole 7.3 surface: `CredentialsSection`, `AvatarSection`, the
`resetAllLayouts` wiring, `uploadAvatar`, and the `profiles.avatar_url` read.
`noUnusedLocals` / `noUnusedParameters` are on, so dead code fails the build.

## `npm run qa:checks` — 62 passed, 0 failed (was 53)

Nine new checks for `resetAllLayouts` / `selectLayoutKeys` in
[../tools/layout-checks.mts](../tools/layout-checks.mts).

**Why these are worth having.** The risk in "reset all layouts" is not the
deletion, it is the **matching**: it runs across the user's entire
localStorage, so a pattern one character too greedy takes out their tab
selections, their rail-side preference, or another app's data on the same
origin. That is invisible in a browser until someone complains that every
campaign reopened on the wrong tab.

| Check | |
|---|---|
| selects only exact `campaign:<id>:layout` keys | PASS |
| reports how many layouts it removed | PASS |
| both campaign layouts are gone | PASS |
| `activeTab` survives — "where was I" ≠ "how was it arranged" | PASS |
| the per-campaign `view` survives | PASS |
| the account-level `prefs:railSide` survives | PASS |
| an unrelated key containing "layout" is untouched | PASS |
| a campaign reloads to the DEFAULT layout afterwards | PASS |
| running it again is a harmless no-op | PASS |

The harness stubs `localStorage` including `length`/`key(i)`, which is the
enumeration API `resetAllLayouts` uses — deliberately, rather than
`Object.keys`, so the stub and a real browser cannot diverge.

## Server-side — avatar access control (migration 0038), 6/6 PASS

Run as `authenticated` with JWT claims set, against synthetic
`storage.objects` rows, inside a rolled-back transaction. See the run log.

## Server-side — the deployed avatar upload path, 7/7 PASS

Live HTTP calls against the production gateway with a manually minted HS256
JWT. See the run log.

## NOT covered automatically

Everything a browser does: the forms submitting, the re-authentication prompt,
the preview rendering, and whether a confirmation email actually arrives. Those
are in [profile-account.md](profile-account.md) and are the user's to run.
