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
- [x] ~~**BLOCKER ON THE FLIP — no content table enforces the read-only lock.**~~
      **FIXED 2026-08-28, migration 0049.** 73 of 78 write policies now consult
      `campaign_is_active`; the 5 exclusions are deliberate and named below. A
      lapsed-campaign persona was added to the QA 8.2 matrix (now **96
      assertions**), and migration 0049 carries an assertion that fails the
      deploy if a future table adds a write policy without the lock — so this
      cannot come back. Kept here rather than deleted, because the flip still
      needs someone to confirm the lock behaves as intended against real
      subscriptions.

      Original finding, for the record:
      Found 2026-08-28 while building Phase 9.1. **0 of 69 write policies** call
      `private.campaign_is_active()`:

      ```sql
      select count(*) filter (where cmd in ('INSERT','UPDATE','DELETE')) as write_policies,
             count(*) filter (where cmd in ('INSERT','UPDATE','DELETE')
               and (coalesce(qual,'') like '%campaign_is_active%'
                 or coalesce(with_check,'') like '%campaign_is_active%')) as enforce_lock
      from pg_policies where schemaname='public';
      -- 69 | 0
      ```

      [QA/1.5_tests/read-only-lock.md](QA/1.5_tests/read-only-lock.md) explicitly
      instructed every later phase to add it — *"Each such table must add an RLS
      write policy that checks `private.campaign_is_active(campaign_id)`, and that
      phase's QA must re-run this lock against its writes."* Phases 2, 3 and 4
      built the content tables and did not, and nothing caught it because
      `enforce_active` is false, so the function returns true for everything.

      **Consequences after the flip, if not fixed first:**
      - A lapsed campaign stays **fully writable** — sheets, inventory, journals,
        DM notes, NPCs, quests, everything. The paywall gates joining and uploads
        and nothing else, so cancelling costs a customer nothing.
      - The Refunds page states *"everyone can still read everything, and nobody
        can write"*. That would be **false**, in a document Phase 7.2 exists to
        keep accurate.

      **Fix:** add `and coalesce(private.campaign_is_active(<campaign>), false)`
      to the INSERT/UPDATE/DELETE policies on every content table, then extend
      QA/8.2's matrix with a lapsed-campaign persona so it can never regress.
      Migration 0048 (playspace) already does this and is the pattern to copy —
      it is currently the only table pair in the project that does.

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
- [ ] **Check `public.orphaned_subscriptions` before and after go-live.** Each row
      is a Stripe subscription still billing with no campaign attached — money
      taken for something the customer cannot see. Cancel or refund each one
      deliberately. A rising `seen_count` means it is still live.

      **The cause was fixed 2026-08-24** — deleting a campaign now cancels its
      Stripe subscription first (PLANNING, "deleting a campaign now cancels its
      Stripe subscription"), so new orphans should be rare. But **subscriptions
      orphaned before that fix were not retroactively cancelled**, and this table
      only records ones Stripe has since sent an event about. Cross-check the
      Stripe dashboard's active subscriptions against `campaign_subscriptions`
      once by hand before taking real payments.

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
- [ ] **Verify a sending domain in Resend.** *(Supersedes the old "decide on a
      custom SMTP sender" item — decided 2026-08-19: Resend, wired into the
      Railway `auth` service and verified working end to end.)*

      **This is a hard blocker on real users, not a polish item — and it is
      worse than previously written here.** Corrected 2026-08-27 after
      reproducing it: with no verified domain, Resend rejects the message at
      SMTP time rather than accepting and dropping it:

      ```
      550 You can only send testing emails to your own email address
      (ejcaldwell06@gmail.com). To send emails to other recipients, please
      verify a domain at resend.com/domains, and change the `from` address
      to an email using this domain.
      ```

      GoTrue therefore returns **500 "Error sending confirmation email"** and
      **rolls the account back**. So:

      - **NOBODY CAN CREATE AN ACCOUNT AT ALL**, the owner included. Verified:
        `ejcaldwell06+qaprobe@gmail.com` also fails — Resend means that one exact
        address, and plus-addressing does not count.
      - No half-created accounts accumulate (the rollback is clean), which is the
        one thing this is better than the old description claimed.
      - The earlier wording here — "silently never delivered", accounts that
        "can never be activated", "the signup returns success" — was **wrong on
        all three counts**. Nothing is silent, no account exists, and the signup
        returns 500.

      The same 550 blocks password resets and the 7.3 email-change flow, and it
      is why QA 7.2 area E and 7.4 area E cannot be run.

      Register a domain, add it at resend.com/domains, complete the DNS records,
      then change `GOTRUE_SMTP_ADMIN_EMAIL` on the `auth` service from
      `onboarding@resend.dev` to an address on that domain.

      *(A temporary `MAILER_AUTOCONFIRM=true` would unblock signup for testing by
      skipping the email entirely. Deliberately NOT done — it lets anyone sign up
      with an address they do not own, and it is one more flag to remember to
      turn off. Noted as an option, not a plan.)*

      Register a domain, add it at resend.com/domains, complete the DNS records,
      then change `GOTRUE_SMTP_ADMIN_EMAIL` on the `auth` service from
      `onboarding@resend.dev` to an address on that domain.

- [ ] **Re-test the email-change flow once the sending domain is verified.**
      `auth.updateUser({ email })` currently fails with a 500 ("Error sending
      email change email") for any address Resend will not deliver to, so
      QA/7.3_tests area **C5** has never been run. The UI now reports this
      honestly instead of showing `{}`, but the flow itself is unproven
      end to end: nobody has ever confirmed an email change in this app.

- [ ] **Turn on branch protection for `main`.** CI exists
      (`.github/workflows/ci.yml`) and runs on every push and PR, but **"block
      merge on failure" is a repository setting, not a workflow setting** —
      GitHub does not enforce a check until it is marked required. Until then CI
      reports a status nobody is obliged to respect. Settings → Branches →
      require the `Typecheck, build & test` check.

- [ ] **Repoint `GOTRUE_SITE_URL` at the real frontend origin.** It is currently
      `http://localhost:5173` on the Railway `auth` service, because the frontend
      has no deployed home yet. It is what confirmation and password-reset links
      are built from, so every such link presently points at localhost and is
      useless to anyone but the developer. `API_EXTERNAL_URL` is already correct
      (the gateway domain); `GOTRUE_URI_ALLOW_LIST` needs the same treatment.

- [ ] **Get the nightly dumps off Railway.** The `backup` cron service writes
      gzipped `pg_dump` output to a Railway volume every night at 08:00 UTC,
      keeping 14. That protects against a bad migration or a dropped table — but
      **not** against losing the Railway account, a billing lapse, or a region
      failure, because the backup sits on the same provider as the database.
      Copy them somewhere else (R2, S3, or a scheduled local pull) before there
      is real user data to lose.

- [ ] **Test a restore, not just a backup.** A dump that has never been restored
      is a guess. Restore one into the local compose stack and check the row
      counts against `QA/6_tests/data-migration.md`.

      **Include the erasure-record replay in that test** — it is the one part of
      the restore path with no other way to be verified. Follow
      [railway/DEPLOY.md](railway/DEPLOY.md) §10 end to end: restore the dump,
      run `migrate`, replay `/backups/deleted-accounts-latest.sql` with
      `psql -f`, run `migrate` again, and confirm it reports
      `RE-DELETED n account(s)`. Everything else about the tombstone is verified;
      the replay itself is not, because there is deliberately no psql path to the
      Railway database.

- [ ] **After ANY restore, reconcile the two things automation cannot.** The
      `migrate` job already re-applies right-to-erasure deletions automatically
      (`railway/scripts/91_reapply_deletions.sql` — a restore would otherwise
      resurrect deleted accounts, password hash included). Two gaps remain that
      it cannot close:

      1. **Stripe.** Cancelled subscriptions do not come back, so a restored
         `campaign_subscriptions` row can claim `active` while Stripe says
         `canceled`, and no webhook will correct it. Harmless while
         `enforce_active` is false; **after the flip a restored campaign would
         get full access with no subscription behind it.** Reconcile every row
         against Stripe before flipping.
      2. **Storage files are not in a `pg_dump`.** Restored `storage.objects`
         rows may point at files that no longer exist — broken images rather
         than leaked data. The sweep reports the count; it deliberately does not
         delete the rows, because deleting a row strands the underlying file
         (the row is storage-api's index, not the bytes).

- [ ] **Apply schema changes through the `migrate` service, never by hand.**
      `railway up --service migrate` (see [railway/DEPLOY.md](railway/DEPLOY.md)
      §9). Applying DDL through a one-off TCP proxy is what produced the 0023
      drift — a migration live in the database but absent from the repo, so the
      repo stopped being the source of truth without anything failing. The job
      also re-runs the grant sweep and asserts RLS on every public table, both of
      which a manual `psql` session will skip.

- [ ] **Rotate the hosted project's service-role key** once the cutover is done,
      and **delete `railway/.env.migrate`**. That file holds the old project's
      database URL and secret key; it exists only for the one-off migration.

- [ ] **Decide whether the gateway should require an `apikey` header.** Verified
      2026-08-20: a request to the Railway gateway with **no API key at all**
      returns `200`, not `401` — Caddy forwards it and PostgREST runs it as the
      `anon` role. Hosted Supabase's Kong rejected these outright, so this is a
      behaviour change introduced by self-hosting.

      **It is not currently a data leak.** All 11 sensitive tables were probed
      keyless and every one returned `[]`; keyless `INSERT`s were refused by RLS
      (`42501`), and storage still demands an `authorization` header. RLS is
      doing its job. But it is now the *only* thing doing it — the outer fence
      that used to reject anonymous traffic before it reached the database is
      gone, so any future table that ships with RLS disabled or an overly broad
      `anon` policy is exposed to the open internet rather than merely to
      key-holders. Either add an `apikey`-required matcher to the Caddyfile, or
      accept it deliberately and keep the "zero public tables with RLS disabled"
      gate as a permanent, non-negotiable check.

- [ ] **Keep the Railway SMTP port at 2587.** Railway blocks outbound 587 and
      465, so a well-meaning "fix" back to the standard port silently breaks all
      auth email with a 10-second timeout and no useful error.

- [ ] **Repoint the LIVE-mode Stripe webhook at the gateway, with a new signing
      secret.** Test mode was re-wired in 6.4; **live mode still points at the
      hosted Supabase project**. The signing secret is per-endpoint, so the
      existing one will not verify against the new URL — a copied secret fails
      every event.

      **This fails silently and expensively.** Checkout keeps working and
      customers are still charged, but no `campaign_subscriptions` row is ever
      written, so paying users get no access. Repoint it *at* cutover, not
      before (the old endpoint must keep working until traffic moves) and not
      after.

      Note both endpoints can be registered at once — Stripe delivers to all
      enabled endpoints — which is a deliberate belt-and-braces option during
      the switch. Remove the hosted one when the project is decommissioned.

---

- [ ] **Fill in the legal entity and contact address**, in
      `src/features/legal/legalConfig.ts`. Both are `null`, so all three policy
      pages currently render a **"DRAFT — not in force, do not publish"** banner
      and the acceptance prompt is suppressed. Setting `ENTITY_NAME` and
      `CONTACT_EMAIL` clears it automatically — nothing else to change.

      Form the LLC first (decided 2026-08-24). Naming an entity that has not been
      formed is worse than naming yourself personally: the agreement would be
      with a party that does not exist.

- [ ] **Finish and arm the 3-month cleanup before publishing the Refunds page.**
      The page promises that read-only campaigns are deleted after three months,
      with warnings at 30/7/1 days.

      **Built 2026-08-26 but not deployed, not armed and not tested** — migration
      0036, the `cleanup-campaigns` Edge Function, the `railway/cleanup` cron
      service and the in-app countdown. What is still owed:

      1. **Verify the Resend sending domain** (§3 above). Until then warnings
         reach only your own address, so QA Area E cannot be run honestly.
      2. ~~Apply migration 0036~~ — **done 2026-08-26**, along with 0037 (which
         fixes a NULL-vs-false bug in `campaign_is_active` that the first QA run
         exposed). Both are inert while `enforce_active` is false.
      3. ~~Create the `cleanup` cron service~~ — **done 2026-08-26**. Running
         daily at 09:00 UTC in dry-run with all three deletion switches off;
         cron firing verified. `cleanup-campaigns` is deployed and its shared-key
         auth is tested. `RESEND_API_KEY` is set but still points at
         `onboarding@resend.dev`, so warnings reach only your own address —
         item §3 above is what fixes that.
      4. **Finish [QA/7.2_tests/lapsed-campaign-cleanup.md](QA/7.2_tests/lapsed-campaign-cleanup.md)**
         — Areas A and B pass (15/15, including the interlock that stops any
         deletion without a *delivered* final warning). **C (a real deletion),
         D (the browser banner) and E (emails) are still unrun**, and D is
         yours to run — it cannot be self-QA'd.
      5. **Watch a full cycle in dry-run**, then flip the three switches
         (`enforce_active`, `lapse_delete_enabled`, `CLEANUP_DELETE_ENABLED`).
      6. **Then** publish the page.

      Deletion is off behind three independent switches by design: running it
      early is unrecoverable, running it late costs nothing. The default state is
      safe, so this cannot leak out by being forgotten — but it also will not
      start working by itself.

- [ ] **Have the Terms and Privacy Policy reviewed by a lawyer**, particularly
      the liability and indemnity sections. They are drafts describing how the
      system behaves, not legal advice.

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

## Dev-account write grant (migration 0052) — decide before launch

`private.dev_accounts` now confers **write access to other users' character
sheets** in campaigns that account DMs. Today it holds one entry (EJ), added for
the 9.1a testing switcher.

This was fine while the only players were test accounts. Once real people have
characters, it means the owner can silently edit their sheets. Before launch,
pick one:

- **Empty the table** (`delete from private.dev_accounts;`) — the switcher stops
  working, everything else is unaffected, and the grant becomes inert.
- **Keep it and disclose it** in the privacy policy, since it is a real access
  path over user data.

Doing nothing leaves an undisclosed access path. The RLS matrix asserts the
grant is confined to allowlisted accounts, but it cannot decide whether the
allowlist should have anyone in it at launch.
