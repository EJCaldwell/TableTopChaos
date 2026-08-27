# QA 7.1 Area D — account deletion browser pass (user-run)

**You run these; I cannot see or drive your browser.** Report what you observe
and I will verify the database side and record the results in
[account-deletion.md](account-deletion.md).

The fixture account exists purely to be destroyed. **Nothing of yours is at
risk** — the one thing it touches that you care about is `Main Tes`, where it is
only a player with one character, and that campaign must survive. I recorded a
full baseline first, so I can prove afterwards whether it did.

**Sign in as the fixture, not as yourself:**

```
qa-delete-fixture@tabletopchaos.test
FixtureDelete!2026
```

---

## 1. Before deleting — confirm the fixture looks real

Signed in as the fixture, check the dashboard shows **two** campaigns:

| Campaign | Its role |
|---|---|
| **QA Fixture Campaign** | it is the DM — you are a player in it |
| **Main Tes** | it is only a player |

Open **Main Tes → My character**. Expect **Fixture Hero**, with a portrait image.

That portrait is the case that matters most: the file was uploaded by the fixture
into *your* campaign, so it is the one that would be left behind if erasure were
incomplete.

---

## 2. Open the danger zone

Go to **Profile** (top-right) and scroll to the bottom: **Delete your account**,
in a red-bordered box.

Click **Delete my account…**

| Expect | Why it matters |
|---|---|
| It lists **QA Fixture Campaign — 2 members lose access** by name | a DM must see that deletion destroys other people's access, not just their own data |
| "1 character, with their sheets, inventory, spells and journals" | |
| "2 uploaded images (…KB)" | |
| "You leave 1 campaign you play in — those campaigns are not deleted" | the distinction between destroyed and merely left |
| A link to export first, **above** the confirmation field | |
| The delete button is **disabled** until the email is typed exactly | |

**If the numbers are wrong, stop and tell me** — the preview drives someone's
decision to destroy data, so being wrong there is a real bug even though nothing
has broken yet.

---

## 3. Try to confirm wrongly (it should refuse)

Type something that is *not* the email — e.g. `delete` — into the confirm field.

| Expect |
|---|
| The delete button stays **disabled** |

Then type the email with different capitalisation:
`QA-Delete-Fixture@TableTopChaos.test`

| Expect |
|---|
| The button **enables** — case is deliberately ignored, whitespace trimmed |

---

## 4. Delete it

Type `qa-delete-fixture@tabletopchaos.test` and click **Permanently delete my
account**.

| Expect | Why |
|---|---|
| It completes without an error | |
| You are **signed out** and land back at the login screen | the account no longer exists, so the stored session points at a deleted user; signing out is what makes that a clean exit rather than an app full of unexplained failures |

**If you see an error mentioning a subscription**, that is the deliberate abort
path — it means nothing was deleted and it is safe to retry. Tell me and I will
look; the fixture has no subscription, so this should not happen.

---

## 5. Try to sign in again as the fixture

| Expect |
|---|
| `Invalid login credentials` — the account is genuinely gone, not merely hidden |

---

## 6. Sign back in as yourself and check your data survived

Sign in as `ejcaldwell06`.

| Expect | Why this is the real test |
|---|---|
| **QA Fixture Campaign is gone** from your dashboard | you were a player in a campaign whose DM deleted their account |
| **Main Tes still exists**, with all its content | a player leaving must not damage the campaign |
| In **Main Tes → Party**, **Fixture Hero is gone** | their character was removed from your campaign |
| Your own characters, NPCs, encounters, quests, notes and images are **untouched** | |
| Your **8 campaigns** are all present | |

---

## What I check afterwards

Tell me when you have finished and I will verify server-side, against the
baseline I recorded:

- profiles 6 → **5**, campaigns 9 → **8**
- Main Tes: characters 3 → **2**, members 5 → **4**
- media_assets uploaded by the fixture: 2 → **0**
- **storage objects 120 → 116** — the one I care about most. Rows cascading is
  not the same as files being deleted, and a bucket that quietly keeps the
  images is an erasure that did not erase.
- No orphaned files left under either campaign prefix

I will also confirm nothing of yours moved: your campaign count, character count
and media totals should be exactly where they were.
