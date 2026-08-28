# QA — Usernames (Phase 7.4)

> **2026-08-27 — the DATA LAYER behind areas A, C and D is verified** without a
> browser (see the run log): the roster composes identically for DM and player,
> every member resolves to a username, no fallback string is reachable, and every
> rename rejection returns the right SQLSTATE over the same HTTP path the form
> uses. **The rendering is still unverified** — these boxes stay unticked, because
> a component that fetched correctly and drew the wrong thing would pass all of
> that.

**Manual, in-browser. The user runs these.** The server-side half is done and
recorded in [run-2026-08-27-usernames.md](run-2026-08-27-usernames.md) — the
backfill, the constraints, the signup allocator and the character-name exposure
are all verified there. Do not re-run those.

**Prerequisites**

- Dev server on **5173**. **Hard-reload** — the column was renamed, so a stale
  bundle will error on every profile read.
- Signed in as the DM, whose username is now **`EJ`** (migration 0042).
- A second browser signed in as the player, now **`QA`** (migration 0043).

**Current usernames:** `EJ` (the DM), `QA` (player fixture), `Test_2` (member of
no campaigns — the non-member fixture), `yrdy`, `EJ_Test`.

> **Area B can no longer be run as written.** Every account has now been renamed
> deliberately, so none is flagged provisional and the banner has nothing to
> show. To test it, flag one account
> (`update public.profiles set username_is_provisional = true where …`), run
> area B, then clear it again.

---

## Area A — Nothing is called "Unnamed" any more

The point of the whole subphase. `display_name` was nullable and usually NULL.

- [ ] **A1.** Campaign overview roster: every member shows a real username. No
      "Unnamed adventurer" anywhere.
- [ ] **A2.** Party panel (as DM): every entry shows a username.
- [ ] **A3.** Schedule → RSVP tallies show usernames rather than "Someone".

## Area B — The provisional prompt

- [ ] **B1.** With an account temporarily flagged provisional, on any page
      except Profile, a banner says you're showing up as that name — one we
      picked — with a link to change it.
- [ ] **B2.** The banner is **not** shown on the Profile page itself (the fix is
      already on screen there).
- [ ] **B3.** There is no dismiss button, and navigating around does not shake it
      off. It should follow you until the name is actually changed.
- [ ] **B4.** Profile → Account shows the same warning next to the Username field.
- [ ] **B5.** Signed in as the **DM (`EJ`)**, there is **no** banner anywhere —
      that account was deliberately assigned its name, so it must not be nagged.

## Area C — Renaming yourself

- [ ] **C1.** Change your username to something free and legal. Expect "Profile
      saved."
- [ ] **C2.** **The banner is gone** immediately, without a manual reload. This
      is the one that proves the provisional flag was actually cleared rather
      than just hidden.
- [ ] **C3.** Try `Test_2` — a name another account holds. Expect *"That username
      is already taken — including in a different capitalisation."*
- [ ] **C4.** Try `test_2` (different case). **Expect the same rejection.** If
      this one succeeds, case-insensitive uniqueness is broken and everything
      else in this area is meaningless.
- [ ] **C5.** Try `admin` → reserved. Try `ab` → too short. Try `alex.c` →
      illegal character. Try a 21-character name → too long. Each should give a
      message naming *that* rule, not a generic failure.
- [ ] **C5b.** Try an obviously profane username. Expect *"That username is not
      allowed. Please choose another."* — deliberately vague, since naming the
      matched word would confirm the filter's contents one probe at a time.
- [ ] **C5c.** Try `Scunthorpe` (contains "cunt") — must be **accepted**. This is
      the false-positive guard; if it is refused, the allowlist has regressed.
- [ ] **C6.** As the DM, confirm you can still save `EJ` — it is under the
      3-character minimum but explicitly excepted (0042). If the form rejects it,
      the client mirror in `username.ts` has drifted from the database.
- [ ] **C7.** Reload. The new username persisted, and the roster in your
      campaigns shows it.

## Area D — The roster pairing

- [ ] **D1.** Campaign overview as the **DM**: members read `username (Character)`
      for anyone who has a character.
- [ ] **D2.** Same campaign as a **player**. **The pairing must look identical.**
      This is the whole reason migration 0041 exists — before it, a player could
      not read another player's character name and the roster read inconsistently.
- [ ] **D3.** A member with no character yet shows just their username, with no
      empty brackets.
- [ ] **D4.** As the player, confirm you still **cannot** open another player's
      sheet, inventory or journal. Verified server-side already; this is
      confirming the UI did not quietly gain a route to it.

## Area E — Signup

> **BLOCKED as of 2026-08-27 — do not attempt.** Signup fails for **every**
> address, the owner's included. Resend rejects the confirmation email with
> `550 You can only send testing emails to your own email address`, so GoTrue
> returns 500 and rolls the account back. Reproduced directly; plus-addressing
> (`…+tag@gmail.com`) does not help. Unblocks when the Resend sending domain is
> verified (PRE_LAUNCH §3).
>
> The trigger behind E3 **is** verified server-side — three accounts created
> through the admin API, including one requesting a taken name and one requesting
> `admin`, all succeeded with the right allocations (see the run log). What
> remains untested is the signup FORM, not the logic behind it.

- [ ] **E1.** The signup form asks for a **Username**, not a Display name, and
      explains the allowed characters.
- [ ] **E2.** Entering `ab`, `alex.c` or `admin` is rejected **before** the form
      submits, naming the rule.
- [ ] **E3.** Signing up with a username that already exists (`yrdy`) **must
      still create the account** — and then tell you it was taken and what you
      were called instead. It must NOT show a database error.

---

## Pass criteria

Every box ticked, with **C4**, **D2** and **E3** carrying the most weight — each
is a case where a plausible-looking pass hides a real failure.

## Known gaps, stated rather than hidden

- **Renaming is not tracked anywhere.** Nothing references usernames yet (no
  mentions, no history, no audit), so a rename is invisible to other users beyond
  the roster changing. That is fine today and will need thought before any
  feature stores a handle rather than a user id.
- **There is no rename rate limit.** A user can change their username as often as
  they like, and a freed name is immediately claimable by anyone.
- **The 23505 path is a narrow enumeration oracle:** an authenticated user can
  probe one username per write. That is the accepted trade-off (PLANNING 7.4.1) —
  the alternative, an availability RPC, would let anyone enumerate accounts
  without even writing.
