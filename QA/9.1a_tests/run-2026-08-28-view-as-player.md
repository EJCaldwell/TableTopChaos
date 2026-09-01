# Run log — DM "view as player" + test conveniences, 2026-08-28

**Server-side and build-level: PASS. Browser steps: NOT RUN** — handed to the
user in [view-as-player.md](view-as-player.md).

Migration **0051** (`private.dev_accounts` + `public.is_dev_account()`), the
`useDevAccess` gate, and `DevToolsBar`. The 8.2 matrix is now **101 assertions**.

## PASS — the gate

| | |
|---|---|
| `is_dev_account()` as **EJ** | `true` |
| `is_dev_account()` as **yrdy** | `false` |
| reading `private.dev_accounts` as authenticated | **42501** refused |
| **adding yourself** to `dev_accounts` | **42501** refused |
| `dev_accounts` policy count | **0** |
| `is_dev_account()` argument list | **empty** — cannot be asked about another user |

The last two are structural assertions in the matrix, so they fail the deploy if
someone later adds a policy or an overload.

**Not `profiles.is_dev`**, which was the obvious design: `profiles_update_own`
lets a user update their own row, so any account could set that flag on itself. A
permission flag anyone can grant themselves is worse than none, because it looks
like a control.

## FIXED — the tooling leaked into the production bundle

The first implementation passed every functional check and still failed the one
requirement that mattered. Static import, so the component shipped even though it
could never render:

```
View as player       -> 1 occurrence
Viewing as a PLAYER  -> 1 occurrence
real role            -> 1 occurrence
is_dev_account       -> 0   (the RPC call HAD been tree-shaken)
```

The RPC was dropped because `import.meta.env.DEV` folds to `false` and the branch
became unreachable — but `import { DevToolsBar }` at the top of the module is
unconditional, so Rollup kept the component regardless.

Fixed with a dev-gated lazy import, so in a production build the expression folds
to `null` and the module is dropped:

```ts
const DevToolsBar = import.meta.env.DEV
  ? lazy(() => import('../dev/DevToolsBar').then(m => ({ default: m.DevToolsBar })))
  : null
```

After:

```
View as player       -> 0
Viewing as a PLAYER  -> 0
real role            -> 0
is_dev_account       -> 0
dist/assets: index-*.css, index-*.js   (no stray dev chunk)
```

**This is the difference between HIDDEN and ABSENT**, and it is exactly why the
QA step says "grep the built bundle" rather than "check the button does not
appear". Absent code cannot be re-enabled from a console.

## Design notes

- **The override is one line.** Everything downstream — `tabsForRole`, `TabBody`,
  every panel — already keys off `isDm`, so `isDm = realIsDm && !viewAsPlayer` is
  the whole feature. No panel knows the mode exists.
- **`isOwner` follows it too**, or a DM inspecting the player view would still
  see the delete-campaign button.
- **Not persisted, and cleared when the campaign changes.** A mode that survives
  a reload is one you forget you are in; carrying it between campaigns would mean
  opening one and quietly seeing less of it than you have access to, with the
  cause two screens back.
- **The banner is not decoration.** A DM who forgets they are in player view and
  files a missing tab as a bug has been actively misled by the tool. It also
  states on screen that the mode does not prove RLS.

## The limit, restated because it is easy to over-trust

This shows what the UI would **render** for a player, not what RLS would
**return**. The queries still run as the DM and still come back with everything;
the view declines to draw some of it.

So it checks that tabs and controls are gated correctly, and it is **not**
evidence a player cannot reach the data — only
`railway/scripts/95_rls_matrix.sql` is that. The bug it specifically cannot see
is a mismatch between the two.

It also cannot replace a second browser for **realtime**: one session cannot
receive its own broadcast as another participant.

## Deferred with a reason — the character switcher

Specced, not built. Every character panel resolves its subject independently via
`getMyCharacter(campaignId, userId)`, which takes the earliest character. A
switcher means threading a selected character id through six panels
(Character, Inventory, Abilities, Spells, Journal, HP) and changing each one's
data loading — a refactor, not a tool. Out of scope for a testing convenience;
tracked as still open under 9.1a.2.

## 2026-08-28 (later) — character switcher added

The earlier deferral is withdrawn, and the reason it was wrong is worth keeping:
I claimed each panel "resolves its subject via `getMyCharacter()`", but that
function's signature is `getMyCharacter(campaignId, ownerId)` — the owner was
already a parameter, threaded from `currentUserId`. So there was no per-panel
data-loading change at all; one optional `characterUserId` prop, defaulted to
`currentUserId`, was the whole thing. I had described the call site from memory
instead of reading it.

- `npm run build` → clean, `✓ built in 1.24s`.
- `npx vitest run` → **129 passed**, unchanged.
- Production-bundle grep re-run with two NEW markers (`READ ONLY`,
  `another member's sheet`) alongside the original four → **0 occurrences each**,
  single chunk, no stray dev bundle. The switcher is absent from production, not
  hidden in it.

> **Not self-QA'd:** steps 10–12 are browser steps and are the user's. In
> particular step 11 (an inspected sheet must FAIL to save) is the one assertion
> that makes the read-only claim true rather than merely intended, and it is
> unrun.

## 2026-08-28 (later still) — inspected sheets became WRITABLE

Owner decision: edits made while inspecting another member's sheet should
persist. Implemented as migrations **0052–0054**. This is the one part of 9.1a
that could not be client-side — the database never sees `import.meta.env.DEV`,
so the permission had to exist server-side or the write is refused.

**The matrix earned its keep twice.** Both defects were mine, in 0052, and
neither would have been visible from the browser:

1. **Ownership reassignment was accepted.** The guard
   `with check (owner_id = private.character_owner(id))` was a tautology: WITH
   CHECK runs after the row is updated, so the function read back the NEW
   owner_id. A policy sees rows, not transitions. Moved to a BEFORE UPDATE
   trigger (0053), which is handed OLD and NEW.

   It surfaced as **8 failing assertions, not 1** — once the fixture character
   was reassigned to the DM, the player stopped owning their own character and
   four unrelated player assertions failed too. Count causes, not failures.

2. **The journal was NOT excluded**, despite 0052's header saying it was. 0052
   widened `can_write_character` as "the single chokepoint", which is exactly
   why it leaked: 0015 had borrowed that function as its *is this the owner?*
   READ test, with a comment saying "can_write_character is owner-only, so it's
   the right is-owner test here". True when written; silently false afterwards.
   0054 gives strict ownership its own name (`is_character_owner`) so the two
   meanings cannot be widened together again, and adds a structural assertion
   that fails if a journal policy ever mentions `can_write_character` again.

**Verification after 0054:** matrix **111/111 PASS**, including the negative
halves — a non-dev DM still cannot touch a player's sheet, and an ex-dev account
loses write the moment it leaves the allowlist. Build clean; 129 tests pass;
bundle grep still 0 for every dev marker.

> **Still not self-QA'd:** steps 10–12 remain the user's. Step 11 has INVERTED —
> it now asserts the save succeeds and persists. Step 12 (journal stays empty) is
> now the highest-signal step in the file, being a privacy guarantee.
