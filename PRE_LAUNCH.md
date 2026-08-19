# Pre-launch checklist — TableTopChaos

Things **you** have to go in and change before this is live. Deliberately only
owner actions: dashboard settings, secrets, one-line SQL, purchases, and
decisions. Anything that is just code to write lives in
[PLANNING.md](PLANNING.md) as a phase instead.

Nothing here is a bug. Most of it is switched off on purpose.

Last reviewed: 2026-08-12.

---

## 1. Billing — the switch-on sequence

These are the Phase 1.5 launch-time actions. **Order matters**: go live in
Stripe *before* flipping enforcement, or you will gate features behind
subscriptions that nobody can actually buy.

- [ ] **Move Stripe from sandbox to live.** Everything today runs in a Stripe
      sandbox. That means new **live** API keys, new **live** price IDs for all
      three intervals ($9.99 / $49.99 / $79.99), and a **re-registered webhook**
      pointing at the deployed `stripe-webhook` function — sandbox webhook
      endpoints do not carry over.
- [ ] **Update the Edge Function secrets** to the live values:
      `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SIGNING_SECRET`. These live only in
      Supabase Edge Function secrets — never in `.env`, never in client code.
- [ ] **Decide on Stripe Tax.** Still an open decision (PLANNING §"Sales tax /
      VAT" assumes it is enabled). If you are selling to the EU/UK, this is not
      optional. Enable it in the Stripe dashboard before the first real charge —
      retrofitting tax onto existing subscriptions is painful.
- [ ] **Flip the kill-switch.** One-line SQL, deliberately left for launch day:
      ```sql
      update private.billing_config set enforce_active = true;
      ```
      Until this runs, every campaign is treated as active and uncapped, so
      player caps, storage caps and the read-only lock do nothing.
- [ ] **Re-verify the anti-abuse path against live Stripe** — one trial per card,
      and that a reused card *cancels* rather than charges. It passed in sandbox
      (QA 1.5), but card fingerprinting is the kind of thing worth seeing once
      with a real card.
- [ ] **Set up the daily storage-cleanup cron.** Deferred since Phase 1.5, and
      still not scheduled. Without it, orphaned media accumulates and storage
      caps drift from reality.

> **Known gap that only appears after the flip:** the cross-member **read-only
> banner and campaign status badge** — what a *player* sees when a campaign
> lapses — was never built (Phase 1.5.2 is `[~]` for this reason). It needs a
> members-readable entitlements RPC. Until `enforce_active` is true no campaign
> is ever read-only, so nobody can see it missing; the moment you flip, a lapsed
> campaign's players get silent failures instead of an explanation. **Build this
> before or with the flip, not after.**

---

## 2. Naming — finishing the TableTopChaos rename

The code and docs were renamed on 2026-08-12. These are the places a rename
cannot reach from inside the repo.

- [ ] **Register `tabletopchaos.com`** — free as of 2026-08-13, along with
      `tabletopchaos.app`. Do this first: it is the only item on this whole list
      that someone else can take from you while you deliberate.
- [ ] **Also register `tablechaos.com`** (free as of 2026-08-12) and point it at
      the same place. This is defensive, not indecision: it was the working name
      for a day, it is the shorter thing people will type or misremember, and at
      ~$12/yr it costs less than losing the traffic. `tablechaos.io` was free too
      if you want the set.
- [ ] **Rename the Stripe product and prices.** Their display names appear on the
      checkout page, the billing portal, and every receipt and card statement.
      Customers see these; they currently say the old name.
- [ ] **Rename the Supabase project** in the dashboard (cosmetic, but it is what
      you will be reading for years).
- [ ] **Rename the repo and local folder** (`dnd-notepad`). Git operations are
      yours — Claude never runs git here.
- [ ] **Trademark clearance before any spend.** A collision scan was run
      2026-08-13 — no existing "Tabletop Chaos" / "TableTopChaos" product,
      podcast, store or brand found, and both `.com` and `.app` were free — but
      that is **not** legal clearance. Do a USPTO/EUIPO search, and
      talk to a lawyer if real money is involved.
- [ ] **Add a favicon and social preview.** [index.html](index.html) has a title
      and description but no icon and no Open Graph / Twitter card tags, so every
      shared link renders as a blank rectangle.

> Three "D&D" references remain in code comments
> ([character/api.ts](src/features/character/api.ts),
> [HpConditionsPanel.tsx](src/features/status/HpConditionsPanel.tsx), and a
> PLANNING line about darkvision). These are **descriptive references to the game
> system** the app is compatible with — fair use, and renaming them would make
> the comments wrong. Do not "fix" them.

---

## 3. Security & configuration

- [ ] **Enable leaked-password protection** in Supabase Auth. It is currently
      **off**, and has shown up in every `get_advisors` security run since Phase
      1.5 as the one genuinely actionable lint.
- [ ] **Re-run `get_advisors`** (security + performance) immediately before
      launch and triage anything new. The known-and-by-design exceptions are
      documented in the QA automated-coverage files — `trial_redemptions` RLS
      with no policy (locked table) and the SECURITY DEFINER RPCs.
- [ ] **Confirm no secrets reached the client bundle.** Only `VITE_`-prefixed
      variables are exposed and they are public by design (RLS is the protection,
      not key secrecy) — but verify the service-role key and Stripe secret exist
      *only* in Edge Function secrets.
- [ ] **Decide on a custom SMTP sender.** Supabase's default auth emails are
      rate-limited and send from a Supabase domain, which looks like phishing to
      most users. Needed before real signups.

---

## 4. Test data to wipe

The live project (`fnykpoattheldxtkrozd`) is also the QA fixture project. Clear
it out before real users arrive.

- [ ] Test campaigns: **Main Test** (`d0e1fc8f-…`), the `test` / `qwer1` /
      `test4` campaigns, and both **Test 1 (imported)** copies.
- [ ] Test accounts: `ejcaldwell06`, `ejcaldwell.test`, `ejcaldwell00`.
- [ ] **Uploaded media** belonging to those campaigns — storage is not cascaded
      by a campaign delete in every path, so check the `media` bucket directly.
- [ ] **Stripe test-clock data** and sandbox customers/subscriptions.

---

## 5. Quality gates before launch

- [ ] **Finish the Phase 5.2 QA run** — [workspace-shell.md](QA/5.2_tests/workspace-shell.md)
      (34 steps) and [layout-persistence.md](QA/5.2_tests/layout-persistence.md)
      (5). Both console-free. The automated half is green (`npm run build`,
      `npm run qa:checks` 40/40); the browser half has **no current evidence**.
- [ ] **Re-check step 8 of** [5.1 settings-tab.md](QA/5.1_tests/settings-tab.md) —
      that the import controls are absent from Settings. Rewritten but never
      re-run.
- [ ] Phases 6–14 are unbuilt; decide what is genuinely in the v1 scope rather
      than shipping a half-finished playspace. **`playspace` and `rpg` modes
      currently render a placeholder where the battlemap will go** — either
      finish Phase 9 or hide those modes from the mode picker at launch. Shipping
      a selectable mode that does nothing is worse than not offering it.
- [ ] Consider a real test runner (Phase 8). `QA/tools/` covers the layout logic
      only; everything else is manual.

---

## 6. Things worth deciding, not just doing

- **Pricing, and whether the unit economics actually work.** $9.99 / $49.99 /
  $79.99 is wired end-to-end but has never been tested against a real buyer.
  PLANNING §"Cost model" carries an explicit pre-launch **Action**: model
  worst-case storage + egress per campaign against Supabase's current pricing,
  and adjust the storage cap or the price if it doesn't net positive. A campaign
  at the ~5 GB image cap, if heavily downloaded, can move meaningful egress;
  Stripe takes ~2.9% + 30¢ on top (≈$0.59 of a $10 month). Do this before you
  publish a price, not after people are on it.
- **Mobile is now in scope** — promoted 2026-08-13 from the post-launch backlog
  to **Phase 14**, the last phase before launch. Nothing for you to do by hand
  here; it is tracked as build work in [PLANNING.md](PLANNING.md). Flagged only
  so it is not a surprise on the critical path: the Phase 5.2 shell is a
  full-bleed desktop layout with draggable floating windows, none of which
  survives a phone viewport as built, so this is a real design pass rather than
  a CSS tidy-up.
- **Phase 7 is a launch blocker, not a later phase.** It holds the legal
  obligations that come with storing personal data and taking payment, and
  **none of it is built** — verified 2026-08-12, there is no account-deletion
  code anywhere in `src/` or `supabase/`:
  - **User-initiated account deletion** with a role-aware cascade (what happens
    to a campaign when its *owner* deletes their account is the hard part).
  - **Unique required usernames** (7.4). Not a legal item, but it belongs on the
    same side of launch: adding a unique-and-required column later means forcing
    a rename on real strangers' accounts.
  - **Terms of service and privacy policy pages.** Neither exists.
  These are legal requirements in several jurisdictions, not features. Phase 7 is
  numbered after 6 and 7, which makes it look optional for v1. It is not — if you
  take money and store other people's writing, this ships first.
- **Backups.** Confirm what Supabase retains on your plan, and whether that is
  enough for campaigns people have spent a year writing.
