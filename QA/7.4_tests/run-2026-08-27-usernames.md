# Run log — Usernames, 2026-08-27

**Server-side and automated halves: PASS. Manual/browser areas: NOT RUN** —
handed to the user, awaiting their reported results.

Migrations **0039** (rename, backfill, constraints, signup trigger), **0040**
(two allocator fixes), **0041** (member-readable character names). All applied
via `railway up --service migrate`; grant sweep, RLS assertion, function-privilege
assertion and erasure check clean on every run.

## PASS — the backfill

The riskiest step: `NOT NULL` and `UNIQUE` cannot be applied while rows are null
or colliding, so 0039 is strictly rename → backfill → constrain. Result across
all five existing accounts:

| username | provisional | email local-part |
|---|---|---|
| `ejcaldwell06` | yes | ejcaldwell06 |
| `Test_2` | no | ejcaldwell00 |
| `yrdy` | no | ejcaldwell000 |
| `ejcaldwelltest` | yes | ejcaldwell.test |
| `EJ_Test` | no | ejcaldwell04 |

Exactly the intended behaviour: the three accounts that had already chosen a
legal name **kept it and are not flagged**, and only the two that never had one
were generated from their email (note the dot stripped from `ejcaldwell.test`).

Invariants after: `nulls 0`, `invalid 0`, `case_insensitive_dupes 0`.

## PASS — the constraint matrix

Run as `authenticated` with JWT claims set, inside a rolled-back transaction, so
this also proves `authenticated` holds EXECUTE on the functions the CHECK calls.

| Attempt | SQLSTATE | |
|---|---|---|
| someone else's name, lowercased | **23505** | rejected |
| someone else's name, uppercased | **23505** | rejected |
| recasing your OWN name | — | **accepted**, correctly |
| reserved word (`Admin`) | **23514** | rejected |
| too short (2 chars) | **23514** | rejected |
| illegal character (`alex.c`) | **23514** | rejected |
| leading underscore (`_lead`) | **23514** | rejected |
| a legal, free name | — | accepted |

> **My first run of this was wrong and I nearly recorded a false FAIL.** The
> "collision" case updated `a1d42405` to `YRDY` — but that account *is* `yrdy`,
> so it was renaming its own row, which must succeed. The fixture was at fault,
> not the index. Re-run against another user's name, it behaves correctly.

The recasing case earns its place: without it, "rejects a case-variant" could be
satisfied by an index that refuses all case changes, including harmless ones.

## BUG FOUND AND FIXED — two defects in the signup allocator (0040)

Found by exercising `private.claim_username` directly, before any signup used
it.

**1. Reserved words were one digit away.** `claim_username('admin', …)` returned
**`admin2`**. The reserved check ran on the candidate, so a reserved word was
rejected and then immediately reused as the *base* for the suffix loop. Someone
asking for `admin` was handed `admin2` — precisely the impersonation the list
exists to prevent. The list stopped the literal string and nothing else.

**2. Short names lost the user's intent.** `claim_username('ab', …)` returned
**`player`**. Anything under three characters was discarded wholesale, even
though the suffix loop already turns `ab` into `ab2`.

After 0040:

| requested | before | after |
|---|---|---|
| `admin` (reserved) | `admin2` | **`realuser`** (from email) |
| `ab` (too short) | `player` | **`ab2`** |
| `___zz` | — | **`zz2`** |
| `YRDY` (taken) | `YRDY2` | `YRDY2` |
| `alex.c!` | `alexc` | `alexc` |
| `BrandNew_1` (free) | granted, not provisional | same |

Neither defect could affect an existing row — the backfill has its own inline
logic and had already run.

## PASS — signup never fails on a collision

Three real accounts created through the GoTrue admin API:

| requested | granted | provisional |
|---|---|---|
| `QaFreshName` (free) | `QaFreshName` | no |
| `yrdy` (taken, different case) | `yrdy2` | yes |
| `admin` (reserved) | `qauname3` | yes |

**All three signups succeeded.** That is the whole design goal: the profile row
is created by a trigger on `auth.users`, so a collision that aborted the insert
would fail the signup with GoTrue's opaque *"Database error saving new user"* —
a signup broken by a race the user can neither see nor fix. Instead the account
always exists and the UI reports what happened afterwards.

All three fixtures were deleted; the five original accounts remain.

## PASS — character names exposed, and nothing else (0041)

The roster shows "username (Character)", which needed a deliberate widening:
`private.can_read_character` is owner-or-DM, so a player could not read another
player's character name. Option 2 from PLANNING was taken — a function returning
`owner_id` + `name` only. Option 3 (widening the predicate) was rejected: it also
gates `sheet_fields`, inventory and lore, so it would have exposed a player's
whole sheet to put a name on a roster line.

Access:

| Caller | Result |
|---|---|
| member (player) | **200**, both characters |
| non-member | **403** `42501` "Not a member of this campaign" |
| anon | **401** `42501` |

And the assertion that actually matters — as that same player, against the
**other** player's character:

| Table | Rows visible |
|---|---|
| `characters` (whole row) | **0** |
| `sheet_sections` | **0** |
| `sheet_fields` | **0** |
| `inventory_items` | **0** |
| `journal_entries` | **0** |
| `abilities` | **0** |
| `spells` | **0** |
| the NAME, via the new RPC | 2 — what the roster needs |

A direct `select` on `characters` as that player returns only their own row,
confirming `can_read_character` was not touched.

## PASS — the short-name exception (0042, owner request)

The 3-character minimum stays for everyone; `EJ` is a named exception, and the
owner's account (`ejcaldwell06@gmail.com`) now holds it with the provisional flag
cleared.

| | |
|---|---|
| `EJ` | **legal** (excepted) |
| `ej` | legal — same name, uniqueness is case-insensitive |
| `AB` (another 2-char) | **rejected** — the floor is intact |
| `a` (1-char) | **rejected** |
| `me` (2-char, reserved) | **rejected** — the list buys a pass on length only |
| 20 characters | legal |
| 21 characters | **rejected** — the max was already enforced |

And another user attempting to claim `ej` → **23505**, rejected.

**Stated plainly because it is easy to misread:** the allowlist grants
*legality*, not *ownership*. `EJ` is protected only because that account holds it
and the unique index stops anyone else. **If that account ever renames away, `EJ`
becomes claimable by anyone.** A CHECK constraint cannot see other rows, so
"only this account may use this name" would need a trigger — not worth building
for one handle, but that is the reason this is an allowlist and not a grant. To
block it outright instead, move it to `private.is_reserved_username`.

The client mirror in `username.ts` was updated in step, with the exception
checked *before* the length rule — otherwise a listed name is rejected in the
browser and never reaches the database that would allow it.

## PASS — the language filter (0044/0045, owner request)

Profanity and slurs blocked by a trigger on `profiles` rather than the CHECK
constraint: a CHECK must be immutable and cannot read a table, and a word list
needs editing without a deploy. Both lists are tables in `private`.

**The first version had two false positives, and they are the reason to test
what should PASS rather than only what should fail:**

```
Scunthorpe -> BLOCKED (contains "cunt")
Shitake    -> BLOCKED (contains "shit")
```

The literal Scunthorpe problem, on the first run. Reviewing the rest of the
substring list for the same fault found four more that had not been tested:
`rape` inside Grape/Drape, `coon` inside Raccoon/Tycoon/Cooney, `spic` inside
Spicy/Suspicion, and `nazi` inside the given names Nazir, Nazia, Nazim, Shahnaz.
Had the test only asserted that `FuckFace` was rejected, this would have shipped
and the first report would have come from someone unable to register their own
surname.

Fixed in 0045 by two different mechanisms, because one does not cover both
shapes: demote to exact-match where innocent uses are open-ended (anything
containing "coon"), and allowlist where a term genuinely should match anywhere
but a few real words contain it (Scunthorpe, Penistone, Nazir).

**45/45 after**, across both directions:

| Blocked | Allowed |
|---|---|
| `FuckFace`, `xXfuckXx`, `xXcuntXx` | `Cassandra`, `Assassin`, `Classy` |
| `sh1thead`, `$hitlord`, `f_u_c_k` (leetspeak folded) | `Scunthorpe`, `Shitake`, `Penistone` |
| `N1gger`, `faggot99`, `Ret4rd`, `grammarnazi` | `Nazir`, `Shahnaz` |
| `ass`, `Anal`, `C0ck` (exact-only terms) | `Grape`, `Raccoon`, `Tycoon`, `Spicy`, `Suspicion` |
| `rapist`, `HitlerFan` | `Cockburn`, `Dickens`, `Hellen`, `Titan`, `Cucumber` |

End-to-end:

| | |
|---|---|
| profane rename over PostgREST | **400** `23514` "That username is not available. Please choose another." |
| `Scunthorpe` rename | accepted |
| an unrelated update to an existing row | accepted — the trigger only fires when the username actually changes |
| allocator: profane request | falls through to the email-derived name, flagged provisional |
| allocator: profane *email* | falls through to `player` |

That third row matters more than it looks: `profiles` is updated by the avatar
upload, legal acceptance and the lapse sweep. Without the `is not distinct from`
guard, a term added to the list later would have started failing writes on rows
that had held their name for months.

### Scope narrowed by the owner (0046)

*"I just don't want swears out in the open. If people get creative with them it's
fine."* The leetspeak folding added in 0044 was doing more than asked, and every
fold is also a new source of false positives. Normalisation is now **case only**,
and the message says *"isn't allowed"* rather than "not available" — the latter
reads like a collision and sends people trying variations of a name that will
never be accepted.

Re-verified 28/28 after the change:

| Still blocked | Now allowed (by design) |
|---|---|
| `FuckFace`, `xXfuckXx`, `shithead`, `xXcuntXx` | `sh1t`, `$hitlord`, `f_u_c_k` |
| `BigBitch`, `Nigger99`, `faggot99`, `HitlerFan` | `N1gger`, `Ret4rd`, `C0ck` |
| `ass`, `Anal` (exact-only terms) | `Scunthorpe`, `Shitake`, `Cassandra`, `Grape`, `Nazir` … |

End-to-end over PostgREST: **400** `23514` *"That username isn't allowed. Please
choose another."*

### Letters-only matching (0047, owner request)

*"Make it so the underscore is also not allowed — track just letters, and if the
letters spell out a swear it gets blocked."* Normalisation now strips digits,
underscores and punctuation before comparing.

**30/30**, both directions:

| Blocked | Allowed |
|---|---|
| `f_u_c_k`, `F_U_C_K`, `s_h_i_t`, `B_i_t_c_h`, `n_i_g_g_e_r` | `sh1t` → `sht`, `C0ck` → `cck`, `N1gger` → `ngger` |
| `Fuck123` (digits stripped), `FuckFace`, `xXfuckXx` | `Thorin_Oak`, `Big_Dragon`, `The_Rogue`, `Dungeon_Master99` |
| `a_s_s` (exact term, by letters) | `Scunthorpe`, `Shitake`, `Cassandra`, `Grape`, `Nazir` |

All five existing accounts still pass, and a blocked rename still returns
`23514` *"That username isn't allowed. Please choose another."*

**A new class of false positive comes with this**, and it was found by testing
rather than by reasoning:

```
Magic_Untold  ->  magicuntold  ->  contains "cunt"  ->  BLOCKED
```

Nobody wrote a swear; `magi(cunt)old` appeared when the underscore was removed.
Worse than Scunthorpe, because it cannot be predicted from reading the name —
both words are innocent and only their junction is not. Allowlisted, and the
mitigation generalises: the allowlist is a table, so the next one is one INSERT.

> **Flagged for the owner, not decided here:** the loosening applies to the SLUR
> entries as well as the swear ones, so `N1gger` and `Ret4rd` now pass. A
> leetspeak slur is arguably a different category from a leetspeak swear. Keeping
> the folding for the slur list only is a small change if that is wanted.

**Stated plainly: this is a speed bump, not moderation.** `Scunthorpe_Fan` is
still blocked (the allowlist is exact-match), and no word list survives someone
determined. What makes that acceptable is that usernames are only visible inside
a campaign you were invited to, and the owner can rename any account.

## BLOCKED — area E (signup form)

Signup is impossible for any address until the Resend domain is verified. Resend
rejects the confirmation email at SMTP time (`550 You can only send testing
emails to your own email address`), GoTrue returns 500 and rolls the account
back. Reproduced against three addresses including the owner's own,
plus-tagged — Resend means one exact string.

Not caused by anything in 7.4: the same 550 blocks password resets and the 7.3
email-change flow, and the username trigger itself is verified through the admin
API path, which skips email entirely.

## DATA LAYER VERIFIED — areas A, C, D (rendering still unverified)

The user asked whether these could be checked without them driving a browser.
Most of each area can, and was. **What cannot** is stated at the end; it is not
padding.

I ran the exact queries the components run, as each role, with minted JWTs.

**Area D — the roster pairing.** `listMembers` + `campaign_character_names`,
composed the way OverviewPanel composes them:

```
as the DM (EJ)          as the PLAYER (yrdy)
  EJ                      EJ
  yrdy (EJ)               yrdy (EJ)
  QA (Test)               QA (Test)
  EJ_Test                 EJ_Test
  profiles withheld: 0    profiles withheld: 0
```

**Byte-identical between the two roles** — which is the entire point of migration
0041 (D2), and it also covers D1 and D3: `EJ` and `EJ_Test` have no character and
correctly produce no bracket.

**Area A — no "Unnamed".** Every member resolved to a username for both roles,
zero profiles withheld by RLS. A `grep` confirms the only remaining member-name
fallback anywhere in `src` is the RSVP `'Someone'`, and the schedule path was
checked separately: as a player, every RSVP author resolved (`EJ`, `QA`), zero
unresolved. So no fallback string can be reached with the current data.

**Area C — renaming.** Already covered above via PostgREST: collisions →
`23505`, case-variant collisions → `23505`, format/reserved → `23514`, blocked
language → `23514` with the friendly message, `EJ` (excepted short name) accepted.
That is the same HTTP path the Profile form uses.

### What this does NOT prove

**That React draws any of it.** Every check above verifies the data reaching the
component, not the pixels leaving it. A component that fetched correctly and then
rendered `m.displayName` (now undefined), dropped the character bracket, or threw
on mount would pass every assertion here and be visibly broken.

The `tsc` build removes some of that risk — `username` is typed `string` and
`displayName` no longer exists, so a stale field reference is a compile error, not
a blank line. But layout, conditional rendering and error states are untyped by
nature.

**Honest status: the data layer is verified; the UI is not.** These areas stay
unticked in [usernames.md](usernames.md). Closing them properly needs either the
user in a browser, or component tests — which is Phase 8.1, and is exactly the
gap 8.1 exists to fill.

## NOT RUN — manual areas

[usernames.md](usernames.md) has been handed to the user. Nothing is ticked and
nothing will be recorded here until they report back.
