# Automated coverage — Phase 8.3 (CI half)

**[.github/workflows/ci.yml](../../.github/workflows/ci.yml)** — runs on every
push to any branch and every PR into `main`.

| Step | |
|---|---|
| `npm ci` | exact lockfile install; fails on package.json / lockfile drift |
| `npm run build` | `tsc -b && vite build` — typecheck **and** bundle |
| `npm test` | 129 unit + component tests |
| `npm run qa:checks` | 62 workspace-layout checks |

Everything here is **hermetic**: no database, no network, no browser. That is
exactly the set that can block a merge honestly.

## Verified, not assumed

The workflow was simulated locally before being written off as correct: the real
`.env` was swapped for the CI placeholders, the three commands run, and the real
one restored.

```
build       ✓ built in 1.24s
test        129 passed (6 files)
qa:checks   62 passed, 0 failed
```

This mattered. `src/lib/env.ts` **throws at module load** when
`VITE_SUPABASE_URL` is missing, and the component tests import modules that reach
that assertion — so a CI run without config would have failed on import, not on
anything real. The workflow writes a placeholder `.env` for that reason; the
values are never used, since no test makes a network call.

## Deliberately excluded

- **The RLS matrix (8.2).** It needs the production database, because there is
  no test database. Putting those credentials in GitHub secrets would place a
  superuser path into the live database inside a third-party service — to
  duplicate a check that already gates every schema change from the `migrate`
  job. The gating property is not improved; only the blast radius is.
- **Browser end-to-end tests.** Signup returns 500 for every address until Resend
  has a verified domain (PRE_LAUNCH §3), and e2e writes to production with no way
  to roll back.
- **`npm audit`.** Four pre-existing high-severity advisories (react-router,
  postcss, nanoid), none from the test toolchain. A gate that is red on arrival
  gets ignored, and an ignored gate is worse than none.

## Not yet true

**"Block merge on failure" is a branch-protection setting, not a workflow
setting.** The workflow reports status; GitHub does not enforce it until required
status checks are enabled on `main` in the repo settings. Until then this is a
signal, not a gate.
