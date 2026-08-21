# QA 6.5 Area E — cutover browser pass (user-run)

**You run these; I cannot see or drive your browser.** Report what you observe
and I will record the results in [cutover.md](cutover.md).

**Before you start:** restart your dev server on port 5173. Vite reads `.env`
only at startup, so a running server is still talking to hosted Supabase and
every result below would be meaningless.

The app is now pointed at the self-hosted Railway stack. Everything you see is
served by Postgres, PostgREST, GoTrue, storage-api and realtime running on
Railway behind the Caddy gateway — not by Supabase.

**If something fails, stop and tell me rather than working around it.** Rollback
is two commented lines in [.env](../../.env) and takes seconds; there is no
pressure to push through a broken step.

---

## 1. Sign in — does auth work at all?

The single highest-value step. This exercises GoTrue, the JWT secret, the
gateway routing and PostgREST all at once.

1. Load the app at `http://localhost:5173`.
2. Sign in as `ejcaldwell06`.

| Expect | Why it matters |
|---|---|
| Sign-in succeeds | GoTrue on Railway is signing tokens the API accepts |
| The dashboard lists your campaigns | your JWT is reaching PostgREST and `auth.uid()` resolves |
| **8 campaigns**, including `Main Tes` and both `Test 1 (imported)` | the migrated data is intact and complete |

`Stripe Test` will **not** be there. That is expected and correct — it was
created on hosted after the migration and is on the wipe list.

**A `401` on everything here** means the URL and key are mismatched. Tell me; do
not re-edit `.env` yourself, since I have already verified both values match.

---

## 2. Open a campaign — does content render?

1. Open **Main Tes**.
2. Visit each tab: Overview, Party, Characters, NPCs, Encounters, Quests,
   Journal, Sessions, Combat, Settings.

| Expect |
|---|
| No tab is empty-when-it-should-not-be, and none shows an error |
| Character sheets show their field values, not blank rows |
| NPC stat blocks show their sections and fields |

Row counts I measured server-side, if you want something concrete to compare
against: **12 NPCs, 6 encounters, 6 quests, 6 characters, 45 sheet fields,
41 NPC stat fields, 5 journal entries, 7 DM notes.**

---

## 3. Images — the storage path

Migrated media was re-uploaded object by object during 6.2, so this is the
step most worth your attention.

1. Look at a character portrait and an encounter image.
2. Upload a **new** image to any character or encounter.
3. Reload the page.

| Expect | Why |
|---|---|
| Existing portraits and encounter images display | the 106 migrated objects are readable through the new storage-api |
| The new upload succeeds and displays | writes work, not just reads |
| It survives a reload | it really landed in storage, rather than showing a local preview |

A broken-image icon on **existing** media points at storage, not at your
upload — say which of the two failed.

---

## 4. Write something — does it persist?

1. Edit a DM note, or add a journal entry.
2. Reload.

| Expect |
|---|
| The change is still there after reload |

---

## 5. Player view — the access-control check that matters

I verified server-side that no table leaks to anonymous or keyless callers.
What I **cannot** verify without a browser is that a signed-in *player* is
correctly denied DM-only content.

1. Sign out. Sign in as a **player** account (`ejcaldwell.test` or
   `ejcaldwell00`).
2. Open a campaign where that account is a player, not the DM.

| Expect | Why this is the headline check |
|---|---|
| **No DM Notes tab, and no Session Log** | DM-only content is invisible to players — RLS, not UI hiding |
| Party view shows other members | player-visible content still works |
| Another player's **private journal entries** are not visible | per-row privacy survived the migration |
| No error banners | denial should be silent-by-absence, not a failure |

**Seeing DM notes as a player is a stop-everything result.** That is the
fail-open case this whole phase's QA exists to catch. Tell me immediately.

---

## 6. Realtime — two sessions

Realtime is its own service with its own database connection and a
`_realtime` schema, so it can fail independently of everything above.

1. Open the same campaign in two browser windows, signed in as **two different
   accounts** (one DM, one player).
2. As the DM, change a combatant's HP in the Combat panel.

| Expect |
|---|
| The other window updates **without a manual reload** |

If it does not update but a reload shows the change, realtime is down while the
database is fine — a much smaller problem. Say which.

---

## 7. Auth email — expected to be limited

1. Sign out and use **Forgot password** on `ejcaldwell06@gmail.com`.

| Expect | Note |
|---|---|
| The email arrives from Resend | SMTP works on port 2587 |
| **The link points at `localhost:5173`** | correct for now — `GOTRUE_SITE_URL` is still localhost, tracked in PRE_LAUNCH |

Only that one address receives mail, because the Resend domain is unverified.
Do **not** test with another address and treat silence as a bug — it is the
known blocker in PRE_LAUNCH §3.

---

## What is deliberately not here

- **Stripe checkout.** Test mode is already re-wired and passed in 6.4. Live
  mode still points at hosted **on purpose** — it gets repointed at
  decommission, so the old endpoint keeps working until then.
- **Subscription enforcement.** `enforce_active` is still `false`, so lapsed
  campaigns are not read-only and nothing is gated. Expected.
