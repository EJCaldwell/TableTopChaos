# QA — Profile & account management (Phase 7.3)

**2026-08-27 — PASS.** Reported by the user: areas A, B and D pass in full, and
C passes as far as it can (C5 needs a deliverable address — see the Resend
blocker). One bug found and fixed: C3 showed `{}`. Details in
[run-2026-08-27-profile-account.md](run-2026-08-27-profile-account.md).

**Manual, in-browser. The user runs these.** The server-side and automated halves
are already done and recorded in
[run-2026-08-27-profile-account.md](run-2026-08-27-profile-account.md) — do not
re-run those here.

**Prerequisites**

- Dev server on **5173**, signed in as the DM account (`ejcaldwell06`).
- A second browser profile or private window signed in as the player
  (`ejcaldwell.test`) for the co-member avatar check.
- At least two campaigns, each with a panel dragged somewhere non-default, so
  the layout reset has something visible to undo.

**A caution before you start:** area B changes your real password, and area C
starts a real email change. Both act on the account you are signed in as. Use
the DM account and know the password you are setting.

---

## Area A — Reset all workspace layouts

The matching logic is already proven by `npm run qa:checks` (9 checks). What is
left is whether the button is wired to it and whether the result is visible.

- [x] **A1.** Open two campaigns and drag a panel somewhere obvious in each.
      Reload both to confirm the arrangement persisted.
- [x] **A2.** Profile → Workspace → **Reset all layouts**. Expect a notice naming
      **how many** layouts were reset, not just "done".
- [x] **A3.** Reopen both campaigns. Panels are back to their default
      arrangement. *(Existing campaigns already on screen will not change until
      reopened — that is by design, not a bug.)*
- [x] **A4.** Your **sidebar-position** setting (Workspace → Sidebar position) is
      unchanged, and each campaign still opens on the **tab you last used**.
      This is the check that matters: a reset that clears those has been too
      greedy.
- [x] **A5.** Press it a second time. Expect **"No saved layouts to reset."** —
      not silence.

## Area B — Change password

- [x] **B1.** Profile → Account → Change password. Enter a **wrong** current
      password. Expect **"That password is not correct."** — not "invalid login
      credentials", which reads as though the whole account is wrong.
- [x] **B2.** Correct current password, but two different new passwords. Expect
      **"The two new passwords do not match."** and no change.
- [x] **B3.** New password identical to the current one. Expect a clear refusal.
- [x] **B4.** A valid change. Expect **"Password changed. You are still signed in
      on this device."** and the three fields to clear. **You must not be logged
      out** — being signed out by a successful change reads as a failure.
- [x] **B5.** Reload the page. Still signed in.
- [x] **B6.** Sign out and sign back in with the **new** password. Then confirm
      the **old** password no longer works.

## Area C — Change email

> **Known limitation, not a bug to report.** GoTrue sends the confirmation to the
> NEW address, and until a Resend sending domain is verified, Resend delivers
> **only to `ejcaldwell06@gmail.com`**. So C3 can only be completed end to end if
> the new address is that one. Everything up to the send is still testable.

- [x] **C1.** Enter your current address as the new one. Expect **"That is
      already your email address."**
- [x] **C2.** A different address with the **wrong** password. Expect the same
      "That password is not correct." refusal, and **no** email sent.
- [x] **C3.** A valid change. Expect a notice that says **confirmation sent** and
      that your email stays the old one **until you open the link**. It must not
      say "Saved".

      > **Fixed 2026-08-27:** this previously showed an error box containing
      > `{}`. The server was returning a clear "Error sending email change
      > email", and `@supabase/auth-js` was discarding it on every 5xx. If the
      > send still fails you should now see *"We could not send the confirmation
      > email, so your address has NOT been changed…"* — an honest message, but
      > still a failed send until the Resend domain is verified.
- [x] **C4.** Reload Profile. The Email field still shows the **OLD** address.
      This is correct — if it showed the new one, someone would believe the
      change took effect while their recovery route still pointed at the old
      mailbox.
- [ ] **C5.** *(Only if the target address can actually receive mail.)* Open the
      link, then confirm the Email field shows the new address and that you can
      sign in with it.

## Area D — Avatar

Server-side already proven: 256px cap, WebP re-encode, EXIF/GPS stripped,
replacement deletes the old file, strangers cannot read it. What is left is the
UI.

- [x] **D1.** Profile → Account shows **"No avatar"** and an **Upload avatar**
      button.
- [x] **D2.** Upload a normal photo. The preview appears **round** and correctly
      cropped, and the button becomes **Change avatar**.
- [x] **D3.** Reload the page. The avatar is still there — this is the step that
      proves the path was saved and re-signed, not just held in memory.
- [x] **D4.** Upload a **different** picture. The preview changes immediately. A
      stale image here would mean the cache-busting path is not working.
- [x] **D5.** Try a non-image file renamed to `.png`. Expect a clear rejection,
      not a broken image.
- [x] **D5b.** Try an image **over 5 MB**. Expect a message naming the file's
      actual size and the 5 MB limit, shown immediately — not after a long
      pause, which would mean the check is happening too late.
- [x] **D6.** As the **player account in the other browser**, open a campaign you
      both belong to. *(Nothing renders co-member avatars yet — see Known gaps.
      Skip unless that has since been built.)*

---

## Pass criteria

Every box above ticked, with A4, B4, B6, C4 and D3 given particular weight —
those are the ones where a plausible-looking pass hides a real failure.

## Known gaps, stated rather than hidden

- **Nothing renders avatars outside your own Profile yet.** The roster, party
  view and app header still show no picture. Uploading one is now possible and
  co-members are permitted to read it; wiring it into those screens is separate
  work and is not claimed here.
- **There is no "remove avatar" control.** Clearing the column is easy; deleting
  the stored object safely is the part that needs thought, and a button that
  leaves the file behind while claiming otherwise is worse than no button.
- **Email change cannot be fully tested** until the Resend sending domain is
  verified (PRE_LAUNCH §3).
