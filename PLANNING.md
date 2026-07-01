# D&D Campaign Manager — Master Implementation Plan

**Project Goal:** A "glorified notepad" web app for tabletop campaigns: the DM
keeps private tabs (encounters, notes, NPCs, etc.) and can view every player's
sheet, while each player maintains their own free-form character workspace —
with a small feature for the DM to share the occasional handout in-app.

> **Status:** Build started — Phase 1.1 (Project & Supabase setup) scaffold is
> in place (Vite/React/TS app, typed Supabase client, migration 0001). Backend
> verification (1.1.1) and the connection-check QA (1.1.3) are pending a live
> Supabase project. Phases, scope, and data model are still expected to shift.

---

## Locked-in decisions

These framed the whole plan and should not be quietly reversed:

- **It's a notepad, not an engine.** The app stores and organizes; it does not
  run live combat or push slides to players. The DM shares encounters/maps the
  normal way — Discord screen-share or a projector. Players never see the DM's
  encounter content in-app.
- **Two roles.** **DM** keeps private tabs *and* has read access to every player
  sheet in the campaign. **Player** keeps their own workspace and sees only their
  own content (plus anything the DM explicitly shares — see below).
- **Player sheets are a flexible notepad.** User-defined sections and fields the
  player types into. No DM-authored templates; works for any game system because
  there's almost no enforced structure.
- **DM private helpers (DM-only).** A private initiative/turn list and a dice
  roller for the DM's own convenience. Not synced, not shown to players.
- **Occasional in-app sharing.** The DM can post a specific handout or note that
  players can see inside the app. A small, deliberate feature — not a live reveal
  system.
- **Stack: React/TypeScript + Supabase** — Supabase Auth, Postgres with Row-Level
  Security (RLS) enforcing who-sees-what, and Storage for portraits / encounter
  images / handouts. No Realtime engine required for the MVP.

---

## Progress Tracker

### Phase 1: Foundations — auth, campaigns, roles
- [ ] 1.1 — Project & Supabase setup
  - [~] 1.1.1 — Backend *(migration 0001 authored & checked in; project not yet provisioned/applied)*
  - [x] 1.1.2 — Web UI *(scaffold builds & type-checks clean)*
  - [ ] 1.1.3 — QA *(ConnectionCheck panel built; needs a live project to run against)*
- [ ] 1.2 — Auth & accounts
  - [ ] 1.2.1 — Backend
  - [ ] 1.2.2 — Web UI
  - [ ] 1.2.3 — QA
- [ ] 1.3 — Campaigns, membership & invite codes
  - [ ] 1.3.1 — Backend
  - [ ] 1.3.2 — Web UI
  - [ ] 1.3.3 — QA
- [ ] 1.4 — Role-based app shell & navigation
  - [ ] 1.4.1 — Backend
  - [ ] 1.4.2 — Web UI
  - [ ] 1.4.3 — QA
- [ ] 1.5 — Monetization (per-campaign subscriptions)
  - [ ] 1.5.1 — Backend
  - [ ] 1.5.2 — Web UI
  - [ ] 1.5.3 — QA
- [ ] 1.6 — Media upload pipeline & content safety
  - [ ] 1.6.1 — Backend
  - [ ] 1.6.2 — Web UI
  - [ ] 1.6.3 — QA

### Phase 2: Player workspace (flexible notepad)
- [ ] 2.1 — Character record & flexible sheet (sections + fields)
  - [ ] 2.1.1 — Backend
  - [ ] 2.1.2 — Web UI
  - [ ] 2.1.3 — QA
- [ ] 2.2 — Inventory
  - [ ] 2.2.1 — Backend
  - [ ] 2.2.2 — Web UI
  - [ ] 2.2.3 — QA
- [ ] 2.3 — Lore, backstory & portrait
  - [ ] 2.3.1 — Backend
  - [ ] 2.3.2 — Web UI
  - [ ] 2.3.3 — QA
- [ ] 2.4 — Spells/abilities & personal journal
  - [ ] 2.4.1 — Backend
  - [ ] 2.4.2 — Web UI
  - [ ] 2.4.3 — QA

### Phase 3: DM workspace
- [ ] 3.1 — Notes & session log/recaps
  - [ ] 3.1.1 — Backend
  - [ ] 3.1.2 — Web UI
  - [ ] 3.1.3 — QA
- [ ] 3.2 — Encounters (with images)
  - [ ] 3.2.1 — Backend
  - [ ] 3.2.2 — Web UI
  - [ ] 3.2.3 — QA
- [ ] 3.3 — NPC roster & quest/plot tracker
  - [ ] 3.3.1 — Backend
  - [ ] 3.3.2 — Web UI
  - [ ] 3.3.3 — QA
- [ ] 3.4 — Party view (read player sheets)
  - [ ] 3.4.1 — Backend
  - [ ] 3.4.2 — Web UI
  - [ ] 3.4.3 — QA
- [ ] 3.5 — DM private helpers (initiative list + dice roller)
  - [ ] 3.5.1 — Backend
  - [ ] 3.5.2 — Web UI
  - [ ] 3.5.3 — QA

### Phase 4: In-app sharing & data export/import
- [ ] 4.1 — Shared items model & visibility
  - [ ] 4.1.1 — Backend
  - [ ] 4.1.2 — Web UI
  - [ ] 4.1.3 — QA
- [ ] 4.2 — Campaign export & import (ZIP archive)
  - [ ] 4.2.1 — Backend
  - [ ] 4.2.2 — Web UI
  - [ ] 4.2.3 — QA

### Phase 5: Accounts, roles & compliance
- [ ] 5.1 — Account deletion, data rights & cascade
  - [ ] 5.1.1 — Backend
  - [ ] 5.1.2 — Web UI
  - [ ] 5.1.3 — QA
- [ ] 5.2 — Co-DM & campaign ownership transfer
  - [ ] 5.2.1 — Backend
  - [ ] 5.2.2 — Web UI
  - [ ] 5.2.3 — QA
- [ ] 5.3 — Legal & policy pages (ToS, Privacy, refunds)
  - [ ] 5.3.1 — Backend
  - [ ] 5.3.2 — Web UI
  - [ ] 5.3.3 — QA

### Phase 6: Polish & deployment
- [ ] 6.1 — Responsive/mobile, theming, accessibility
  - [ ] 6.1.1 — Web UI
  - [ ] 6.1.2 — QA
- [ ] 6.2 — Rate limiting & abuse prevention
  - [ ] 6.2.1 — Backend
  - [ ] 6.2.2 — QA
- [ ] 6.3 — Analytics & observability
  - [ ] 6.3.1 — Backend
  - [ ] 6.3.2 — Web UI
  - [ ] 6.3.3 — QA
- [ ] 6.4 — Deployment, backups & monitoring
  - [ ] 6.4.1 — Backend
  - [ ] 6.4.2 — QA

---

## Phase 1: Foundations — auth, campaigns, roles
**Goal:** A deployable skeleton where a user can sign up, create or join a
campaign via invite code, and land in a role-appropriate (DM vs player) shell —
with the RLS-based visibility model established from day one.

### Subphase 1.1: Project & Supabase setup

#### 1.1.1 — Backend
- Create the Supabase project; capture project URL + publishable/anon key.
- Establish migration workflow (SQL migrations checked into the repo).
- Define base table: `profiles` (1:1 with `auth.users`).
- Enable RLS globally; default-deny posture (no table readable without an
  explicit policy).
- Choose and wire a **transactional email provider** (e.g. Resend / Postmark /
  SendGrid) for app emails — trial-ending, payment-failed, deletion warnings
  (1.5), and account/legal notices. Supabase Auth handles only auth emails
  (verify/reset). Store the API key as a secret; send from Edge Functions.

#### 1.1.2 — Web UI
- Scaffold React + TypeScript + Vite; routing and a typed Supabase client.
- Environment config (`.env` with Supabase URL/anon key); `.env.example`.
- Base layout, design tokens, and a component library choice.

#### 1.1.3 — QA
- Verify the app builds and connects to Supabase.
- Confirm an unauthenticated query to any table returns nothing (default-deny).

### Subphase 1.2: Auth & accounts

#### 1.2.1 — Backend
- Configure Supabase Auth (email/password to start; OAuth optional later).
- Trigger to auto-create a `profiles` row on signup.
- RLS: a user can read/update only their own profile.

#### 1.2.2 — Web UI
- Sign up / log in / log out / password reset flows.
- Session persistence and an auth-guarded route wrapper.
- Profile screen (display name, avatar).

#### 1.2.3 — QA
- Sign up, log out, log back in; session survives refresh.
- Confirm a user cannot read another user's profile.

### Subphase 1.3: Campaigns, membership & invite codes

#### 1.3.1 — Backend
- `campaigns` (owner = DM), `campaign_members` (user ↔ campaign, role enum:
  `dm` | `player`), `invite_codes` (code, campaign, role, expiry, max uses).
- RPC `redeem_invite_code(code)` → inserts a `campaign_members` row for the
  caller; validates expiry/uses atomically.
- Reusable SQL helpers: `is_campaign_member(campaign_id)`,
  `is_campaign_dm(campaign_id)` — the backbone of every later policy.
- RLS: members read their campaigns; only the DM mutates campaign-level rows.

#### 1.3.2 — Web UI
- Dashboard: "My campaigns" (as DM and as player).
- Create-campaign flow; DM generates/regenerates invite codes.
- Join-campaign-by-code flow.

#### 1.3.3 — QA
- DM creates a campaign; a second account joins via code and appears as player.
- Expired/maxed-out codes are rejected.
- A non-member cannot read the campaign by guessing its ID.

### Subphase 1.4: Role-based app shell & navigation

#### 1.4.1 — Backend
- View/endpoint returning the caller's role per campaign for nav gating.

#### 1.4.2 — Web UI
- Campaign workspace shell with role-aware tabs:
  - DM sees DM tabs + a "Party" view of player sheets.
  - Players see their own character workspace + a "Shared with us" area.
- Campaign switcher; clear DM-vs-player visual indicator.

#### 1.4.3 — QA
- Same account in two campaigns sees the correct role/tabs in each.
- A player never sees DM-only tabs in the UI (defense-in-depth atop RLS).

### Subphase 1.5: Monetization (per-campaign subscriptions)
**Model:** Players are always free. There is **no free tier** — every campaign
runs on **Pro**, which begins with a **30-day free trial** (a card is required to
start it; $0 during the trial) and then a per-campaign subscription on one of
three intervals (monthly $10, semi-annual $50, annual $80 USD). The trial is
**one per card** (tracked by Stripe card fingerprint), so new accounts can't farm
free trials. The DM who owns a campaign is the buyer; subscribing to one campaign
does not cover their others. **Trial and paid Pro are identical except for two limits:
player count (6 during the trial, full cap when paid) and image storage** (smaller
during the trial). If a trial ends with no payment, the campaign goes
**read-only** (data preserved; the DM subscribes to unlock writes again). See the
*Pricing & Subscriptions* appendix for prices and limits (tunable values, not
hardcoded assumptions).

#### 1.5.1 — Backend
- Stripe account + products: one product with **three recurring prices** —
  monthly ($10), semi-annual ($50, 6-month interval), annual ($80) — each
  configured with a **30-day trial** (`trial_period_days: 30`). Store the three
  price IDs in config.
- **Sales tax / VAT:** enable **Stripe Tax** so tax is calculated and collected
  automatically at checkout based on customer location — no tax logic in our
  code. (Can launch with it off and flip on when revenue/registration warrants;
  see *Compliance & Operations*.)
- `campaign_subscriptions` (campaign_id, stripe_customer_id,
  stripe_subscription_id, plan, status incl. `trialing`, interval
  `monthly`|`semiannual`|`annual`, trial_end, current_period_end,
  cancel_at_period_end). One active/trialing subscription per campaign; flag so
  a campaign can't start a second trial.
- Trial start (card-bound, anti-abuse): starting a trial **requires a card on
  file** via Stripe Checkout in trial mode ($0 charged during the trial). On
  start, capture the payment method's **card fingerprint** (Stripe's stable
  per-card identifier, shared across customers/accounts) and record it in
  `trial_redemptions` (fingerprint, first_used_at, campaign_id).
  - Before granting a trial, reject if that fingerprint already appears in
    `trial_redemptions` — so a new account with the same card cannot farm another
    free trial. The DM may instead subscribe with **immediate billing** (no
    trial). Enforce in the checkout-creation Edge Function, not the client.
  - A campaign with no card/trial yet sits inactive (read-only) until the DM
    starts the trial or subscribes; `trial_end` = trial start + 30 days.
- Supabase **Edge Functions** (no app server otherwise):
  - `create-checkout-session` — starts Stripe Checkout for a given campaign;
    only the campaign's DM may call it. Decides trial-vs-immediate by checking
    the card fingerprint against `trial_redemptions` (a card that already had a
    trial gets immediate billing, no trial).
  - `stripe-webhook` — the source of truth; on `checkout.session.completed`,
    `customer.subscription.updated/deleted`, etc., upsert
    `campaign_subscriptions`. Verifies the Stripe signature.
  - `create-billing-portal-session` — DM manages/cancels via Stripe portal.
- Entitlement helpers (SQL), the single source every limit check reads:
  - `campaign_is_active(campaign_id)` → true when the subscription is `active`,
    `trialing`, or in grace (`past_due` during dunning); false once a trial/sub
    fully lapses (campaign is read-only).
  - `campaign_player_cap(campaign_id)` → **6** while `trialing`, full Pro cap when
    `active`.
  - `campaign_storage_cap(campaign_id)` → trial cap while `trialing`, larger Pro
    cap when `active`.
- Enforce limits server-side, not just in the UI:
  - Player cap: `redeem_invite_code` (and member insert) rejects joins past
    `campaign_player_cap()` — so the 6-cap is enforced during the trial too.
  - Storage cap: track per-campaign image bytes; block uploads over
    `campaign_storage_cap()`. (UI also hides the action, but the rule lives in
    the DB/function.)
  - Read-only lock: when `campaign_is_active()` is false, **all** writes across
    the campaign's tables are rejected (reads still allowed) until a subscription
    starts — this includes **players editing their own sheets/inventory/journal**,
    not just the DM. The whole campaign freezes together.
- Lifecycle & dunning:
  - Failed payment → Stripe dunning keeps the sub `past_due` (still active) for
    its retry window (**~2–3 weeks**, Stripe default); recovered payment resumes
    seamlessly, exhausted retries → `canceled` → read-only.
  - DM cancel → stays Pro until period end, then read-only.
- Scheduled cleanup (Edge Function on a daily cron):
  - A campaign that has been read-only for **3 months** is **deleted** (its rows
    and Storage objects removed).
  - Warn the DM by email before deletion (e.g. at 30 / 7 / 1 days left) with a
    one-click export link, and surface the same countdown in-app.
  - **Dependency:** do not enable auto-deletion in production until campaign
    export (4.2) ships, so a DM always has a way to save their data first.
- RLS: a campaign's DM can read its subscription row; nobody else can.
- **Payment data handling (PCI):** raw card data never touches our app — Stripe
  Checkout collects it browser→Stripe directly. We persist only non-sensitive
  references (`stripe_customer_id`, `stripe_subscription_id`, status, card
  fingerprint, and optionally `brand`/`last4` for display). **Never** store card
  numbers/CVV/expiry anywhere in Supabase. This keeps us on PCI **SAQ-A**.

#### 1.5.2 — Web UI
- A "Plan & Billing" screen on each campaign (DM-only): current state
  (trial / active / read-only), an **interval selector (monthly $10 / semi-annual
  $50 / annual $80)** showing the savings on the longer terms, and a **"Start free
  trial"** button → Checkout that **collects a card** (messaged as "$0 today, no
  charge until <trial_end>").
- If the DM's card has already used a trial: no trial offered — show "Subscribe"
  with immediate billing instead, and explain the trial was already used.
- While trialing: a banner with days remaining and a "Subscribe now" action.
- If read-only (lapsed): a clear banner — shown to **the DM and players** —
  explaining the campaign is frozen and writes are paused; existing content stays
  viewable. DM banner has a prominent Subscribe action + an **Export** button;
  player banner explains only the DM can reactivate.
- If pending deletion: a countdown banner ("this campaign will be deleted in N
  days unless reactivated") with Export and Subscribe actions.
- "Manage billing" button → Stripe billing portal (update card, cancel, switch
  interval).
- Prompts surfaced at the limits (e.g. adding a 7th player during the trial, or
  uploading past the storage cap) — clear, not naggy.
- A small status badge on the campaign (Trial · N days left / Pro / Read-only).
- Post-checkout return handling (success/cancel states); reflect the new plan
  once the webhook lands (brief "activating…" state if needed).

#### 1.5.3 — QA
- Starting a trial requires a card; once started it's `trialing` with the **6**
  player cap (a 7th join is rejected, in UI and via direct insert) and the smaller
  storage cap. No charge occurs during the trial.
- Anti-abuse: a second account reusing the **same card** is denied a trial (gets
  immediate-billing checkout instead); a different card is allowed. Enforced
  server-side, not just in the UI.
- Simulate trial→active conversion (Stripe test clock); player and storage caps
  lift to the full Pro values and no charge happened before trial end.
- Let a trial end without payment; the campaign goes **read-only** — content is
  still viewable, but writes (new players, uploads, edits) are rejected — and
  data is never deleted. A campaign cannot start a second trial.
- Confirm read-only freezes **players too**: a player cannot edit their own
  sheet/inventory/journal while the campaign is lapsed.
- Simulate a failed payment; the sub stays usable through the ~2–3 week dunning
  window, recovers on a successful retry, and only goes read-only if retries are
  exhausted.
- Cancel via the portal; at period end the campaign goes read-only gracefully,
  then unlocks fully if the DM resubscribes.
- Cleanup: a campaign read-only for 3 months is deleted by the cron; warning
  emails fire at 30/7/1 days; reactivating or exporting before the deadline
  prevents loss. (Use a test clock / shortened window for the test.)
- A non-owner (player or another DM) cannot open Checkout or read the
  subscription row.
- All caps and the read-only lock are enforced even if the client tries to bypass
  the UI (direct insert/upload is rejected).

### Subphase 1.6: Media upload pipeline & content safety
**Goal:** One shared, safe path for every image upload (portraits, encounter
images, handouts) so validation, limits, moderation, and cost control live in a
single place rather than being re-solved per feature.

#### 1.6.1 — Backend
- A single upload flow (signed upload URLs / an Edge Function) used by all image
  features. Validates **file type** (allowlist: PNG/JPEG/WebP/GIF) by magic
  bytes, not just extension, and **size** (per-file cap, e.g. ~10 MB).
- Server-side **image processing**: strip EXIF, re-encode, and generate resized
  variants/thumbnails to control Storage + egress cost; serve thumbnails in lists.
- **Content moderation** hook: run uploads through an automated image-moderation
  check (provider TBD) and/or a report-and-takedown flow; quarantine/block
  flagged media. Define an acceptable-use policy these enforce.
- Counts every upload's bytes toward `campaign_storage_cap()` (ties into 1.5);
  uploads while a campaign is read-only are rejected.

#### 1.6.2 — Web UI
- A reusable image-upload component (drag/drop, progress, client-side
  pre-validation + preview) consumed by portrait/encounter/handout features.
- Clear errors for too-large/wrong-type/over-cap/blocked uploads.

#### 1.6.3 — QA
- Oversized, wrong-type, and disguised-extension files are rejected (server-side,
  not just UI).
- Thumbnails generate and render; EXIF is stripped from stored images.
- A flagged/blocked image is quarantined and not served; storage cap is enforced.

---

## Phase 2: Player workspace (flexible notepad)
**Goal:** Each player has a free-form character workspace — sections and fields
they define themselves — plus inventory, lore, a portrait, spells/abilities, and
a private journal.

### Subphase 2.1: Character record & flexible sheet (sections + fields)

#### 2.1.1 — Backend
- `characters` (owner, campaign, name, portrait ref).
- `sheet_sections` (character, title, order) and `sheet_fields` (section, label,
  value as text, order) — the flexible notepad structure. No fixed schema; the
  player adds/renames/reorders their own sections and fields.
- RLS: owner read/write; DM read (campaign-scoped); other players no access.

#### 2.1.2 — Web UI
- Character creation; an editable sheet where the player adds sections and
  label/value fields freely.
- Autosave with optimistic UI; drag-to-reorder sections/fields.
- Optional "starter layout" button that pre-fills common sections (Abilities,
  Skills, Combat) the player can then edit or delete — purely a convenience, not
  enforced structure.

#### 2.1.3 — QA
- Player adds/renames/reorders sections & fields; everything persists on refresh.
- DM can view (read-only) but a second player cannot.

### Subphase 2.2: Inventory

#### 2.2.1 — Backend
- `inventory_items` (character, name, qty, notes, optional equipped flag).

#### 2.2.2 — Web UI
- Inventory list: add/edit/remove, quantities, free-text notes.

#### 2.2.3 — QA
- Add/edit/remove items; data scoped to the owning character.

### Subphase 2.3: Lore, backstory & portrait

#### 2.3.1 — Backend
- Lore/backstory fields on the character (rich text).
- Portraits uploaded **via the 1.6 media pipeline** (validation/resize/
  moderation); storage policy so only campaign members (the owner + DM) can view.

#### 2.3.2 — Web UI
- Rich-text backstory editor; portrait upload/crop with preview (reuses the 1.6
  upload component).

#### 2.3.3 — QA
- Upload a portrait; it displays for the owner and DM; non-members get no URL.

### Subphase 2.4: Spells/abilities & personal journal

#### 2.4.1 — Backend
- `abilities` (character, name, type, description, optional uses).
- `journal_entries` (character/owner) — **owner-only**, not visible to the DM
  unless the player chooses to share it.

#### 2.4.2 — Web UI
- Spells/abilities manager; personal journal with entries.

#### 2.4.3 — QA
- Confirm the journal is invisible to the DM by default.

---

## Phase 3: DM workspace
**Goal:** The DM's private organizer — notes, encounters with images, NPCs,
quests, session recaps — plus read access to every player sheet, and private
initiative/dice helpers for their own use.

### Subphase 3.1: Notes & session log/recaps

#### 3.1.1 — Backend
- `dm_notes` (campaign, rich text, optional links to NPC/quest/encounter).
- `sessions` (date, recap, attendees) for the session log.
- RLS: DM-only.

#### 3.1.2 — Web UI
- Notes tab (organizable/taggable); session log with recap entries.

#### 3.1.3 — QA
- DM notes/recaps are invisible to players.

### Subphase 3.2: Encounters (with images)

#### 3.2.1 — Backend
- `encounters` (campaign, name, description, notes) + `encounter_images`
  (Storage refs, uploaded via the 1.6 media pipeline) for maps/art the DM
  displays externally.
- RLS: DM-only (players never see encounters in-app).

#### 3.2.2 — Web UI
- Encounter list/detail; upload and arrange encounter images; a clean
  "presentation" view the DM can full-screen for screen-share/projector.

#### 3.2.3 — QA
- Upload encounter images; presentation view displays them full-screen.
- Confirm a player account cannot fetch any encounter or its images.

### Subphase 3.3: NPC roster & quest/plot tracker

#### 3.3.1 — Backend
- `npcs` (campaign, name, portrait, description, status).
- `quests` (campaign, title, status: active/completed, description, plot notes).
- RLS: DM-only.

#### 3.3.2 — Web UI
- NPC roster with portraits; quest board grouped by status.

#### 3.3.3 — QA
- NPCs and quests are invisible to players.

### Subphase 3.4: Party view (read player sheets)

#### 3.4.1 — Backend
- Confirm DM read policy spans all `characters`, sheet sections/fields,
  inventory, abilities, lore, and portraits in the campaign (journal excluded).

#### 3.4.2 — Web UI
- "Party" panel listing every player; open any sheet read-only.

#### 3.4.3 — QA
- DM sees all party sheets and portraits; the DM cannot see a player's journal.

### Subphase 3.5: DM private helpers (initiative list + dice roller)

#### 3.5.1 — Backend
- `initiative_entries` (campaign/DM, name, initiative value, order, notes) —
  DM-only scratch list, optionally seeded from party + NPCs.
- Dice roller is client-side (or a simple stateless function); no shared log
  required. Optional `dm_dice_log` (DM-only) if the DM wants history.

#### 3.5.2 — Web UI
- A private initiative tracker the DM can reorder and step through.
- A dice roller (standard notation, e.g. `2d6+3`) in the DM's workspace.

#### 3.5.3 — QA
- Initiative list and dice roller are visible only to the DM.

---

## Phase 4: In-app sharing & data export/import
**Goal:** Let the DM deliberately push a specific handout or note into the app
for players to see (the one intentional DM→player channel), and give the DM full
ownership of their data via export to a ZIP and re-import back into the app.

### Subphase 4.1: Shared items model & visibility

#### 4.1.1 — Backend
- `shared_items` (campaign, type: `note` | `image`, title, body/image ref,
  shared_at); images go through the 1.6 media pipeline. Presence of a row =
  visible to all players in the campaign.
- RLS: DM writes; campaign members read shared items (and only shared items).

#### 4.1.2 — Web UI
- DM: "Share to party" action on a note or image; a list of currently shared items
  with an un-share control.
- Player: a "Shared with us" tab collecting what the DM has posted.

#### 4.1.3 — QA
- DM shares a note; all players see it; un-sharing removes it for everyone.
- A player cannot read DM content that was never shared.

### Subphase 4.2: Campaign export & import (ZIP archive)
**Goal:** The DM can download an entire campaign as a self-contained ZIP and
later re-import it — both as a personal backup/portability feature and as the
safety net before the 3-month auto-deletion (see 1.5). Campaign export/import is
DM-only, and import **always creates a brand-new campaign and never modifies or
overwrites any existing one**. Separately, **each player can download their own
journal** at any time.

> **Privacy trade-off (decided):** the DM's campaign export **includes player
> journals**, even though the DM can't browse them in the app. Because the export
> is a ZIP the DM downloads, a full export does expose journals to the DM. The
> in-app "DM can't read journals" rule still holds in the UI; the DM export is the
> documented exception. Players also get their **own** journal download, which is
> scoped strictly to the requesting player's entries.

#### 4.2.1 — Backend
- Export Edge Function (DM-only): gathers all campaign rows — campaign meta,
  members (as display names, not auth identities), characters + sheet
  sections/fields, inventory, abilities, lore, **personal journals**, NPCs,
  quests, encounters, notes, session log, shared items, initiative entries —
  into a structured `campaign.json`, plus every referenced Storage image under
  `images/`, zipped with a `manifest.json` (schema version, export date, app
  version, checksums).
- Works even when the campaign is read-only/pending-deletion (export must never
  be blocked by the lock). Stream/build to a temp object and hand back a signed
  download URL; clean up after.
- Import Edge Function (DM-only): validate the manifest/schema version, then
  recreate the campaign as a **new** campaign owned by the importer — new IDs,
  fresh invite codes; original members become placeholder/re-invitable entries.
  It **never touches existing campaigns** (no overwrite/merge path at all).
  Re-upload images to Storage and rewrite references. Transactional — a failed
  import leaves no half-built campaign.
- A newly imported campaign is a new campaign for billing — it can start its own
  trial, **subject to the one-trial-per-card rule** (if the importer's card
  already used a trial, they subscribe with immediate billing instead).
- Versioned schema + a migration path so older exports still import after the
  data model evolves.
- Player journal export (any campaign member): a function that returns **only the
  caller's own** journal entries for that campaign, as a download (JSON + a
  readable text/Markdown rendering). RLS-scoped to `owner = auth.uid()` so a
  player can never pull another player's journal, and the DM uses the same
  endpoint only for their own. Works regardless of read-only state.

#### 4.2.2 — Web UI
- DM "Export campaign" action (Plan & Billing + campaign settings) → progress →
  download link. Prominent in the read-only / pending-deletion banners.
- DM "Import campaign" flow: upload a ZIP, show a preview/summary of what will be
  created, confirm, then land in the new campaign. Clear errors for bad/old files.
- Player "Download my journal" action in the journal tab (available to every
  member, including the DM for their own notes) — one click, no DM involvement.

#### 4.2.3 — QA
- Export a populated campaign; the ZIP opens, `campaign.json` validates against
  the manifest, and every image is present.
- Re-import that ZIP; all content reappears (including **player journals**),
  images render, and it lands as a **new** campaign — confirm no existing
  campaign was modified or overwritten.
- Export works while a campaign is read-only and while pending deletion.
- A non-DM cannot export or import a campaign. A tampered/old-schema ZIP is
  rejected with a clear message, leaving no partial campaign.
- A player can download their own journal and gets exactly their entries; an
  attempt to fetch another player's journal returns nothing (RLS-scoped).

---

## Phase 5: Accounts, roles & compliance
**Goal:** The legal and account-lifecycle obligations that come with storing
personal data and taking payments — user-initiated account deletion with correct
data cascade, flexible campaign roles (co-DM, ownership transfer), and the
required policy pages.

### Subphase 5.1: Account deletion, data rights & cascade

#### 5.1.1 — Backend
- "Delete my account" path (GDPR/CCPA right to erasure), distinct from campaign
  deletion. Define and implement the **cascade rules**:
  - Campaigns the user **DMs**: the campaign and its content are deleted (or
    transferred first — see 5.2); any active Stripe subscription is cancelled.
  - Campaigns where the user is a **player**: their character/sheet/inventory/
    journal are removed; the campaign and other players are unaffected.
- A grace/confirmation step (and email confirmation) before irreversible
  deletion; remove Storage objects, not just rows.
- Data-access/portability request handling reuses the export functions (4.2).

#### 5.1.2 — Web UI
- Account settings: delete account (with clear warnings about what's removed and
  a prompt to export first), and links to export tools.

#### 5.1.3 — QA
- Deleting an account removes the right data in every role and cancels its
  subscriptions; other users' campaigns are untouched; Storage objects are gone.

### Subphase 5.2: Co-DM & campaign ownership transfer

#### 5.2.1 — Backend
- **Co-DM:** allow more than one `dm` member per campaign (the data model already
  supports it); `is_campaign_dm()` already grants co-DMs full DM access. Decide
  billing/owner rules: exactly one member is the **billing owner**; co-DMs get
  content access but not billing control.
- **Ownership transfer:** reassign the billing-owner role to another member
  (and move/re-create the Stripe subscription association accordingly); guard so
  a campaign always has exactly one billing owner.

#### 5.2.2 — Web UI
- Manage-DMs UI: promote a player to co-DM / demote; "transfer ownership" flow
  with confirmation.

#### 5.2.3 — QA
- A co-DM can edit DM content but cannot change billing; transferring ownership
  moves billing control and leaves exactly one owner.

### Subphase 5.3: Legal & policy pages (ToS, Privacy, refunds)

#### 5.3.1 — Backend
- Store acceptance (versioned ToS/Privacy acceptance timestamp on the profile);
  re-prompt on material updates.

#### 5.3.2 — Web UI
- **Terms of Service**, **Privacy Policy** (what's stored, Stripe as processor,
  retention, deletion rights), and a **refund/cancellation policy** page; signup
  consent checkbox; footer links.

#### 5.3.3 — QA
- Signup records policy acceptance; pages are reachable; refund policy matches the
  actual billing behavior (read-only on lapse, 3-month deletion).

---

## Phase 6: Polish & deployment
**Goal:** Production-ready: usable on phones at the table, abuse-resistant,
observable, deployed, and backed up.

### Subphase 6.1: Responsive/mobile, theming, accessibility

#### 6.1.1 — Web UI
- Mobile layouts (players will use phones at the table); light/dark theme;
  keyboard nav and an a11y pass.

#### 6.1.2 — QA
- Core flows work on a phone viewport; basic screen-reader/keyboard pass.

### Subphase 6.2: Rate limiting & abuse prevention

#### 6.2.1 — Backend
- Rate-limit sensitive endpoints (auth, invite redemption, uploads, checkout,
  export/import) to curb spam/scraping/cost-abuse; sensible per-user/IP ceilings.
- Abuse guards: invite-code brute-force protection, upload flood limits (ties to
  1.6), and a report/takedown path for shared content.

#### 6.2.2 — QA
- Hammering a rate-limited endpoint is throttled with clear errors; normal use is
  unaffected.

### Subphase 6.3: Analytics & observability

#### 6.3.1 — Backend
- Error monitoring (e.g. Sentry) on the frontend + Edge Functions; structured
  logs; alerts on webhook failures and the cleanup/cron job.

#### 6.3.2 — Web UI
- Privacy-respecting product analytics (key funnels: signup → campaign → trial →
  subscribe), disclosed in the Privacy Policy.

#### 6.3.3 — QA
- Errors surface in monitoring; a failed Stripe webhook raises an alert;
  analytics events fire on the core funnel.

### Subphase 6.4: Deployment, backups & monitoring

#### 6.4.1 — Backend
- Production Supabase config; automated DB backups; run the Supabase security &
  performance advisors and resolve findings.

#### 6.4.2 — QA
- Fresh prod deploy: sign up → create campaign → start trial → join → fill a
  sheet → DM views it → DM shares a handout. Smoke test passes end to end.

---

## Minimum System Requirements

- **Client:** Modern evergreen browser (Chromium, Firefox, Safari) on desktop or
  mobile; JavaScript enabled. No install.
- **Network:** Standard broadband. (No live sync, so brief drops don't matter.)
- **Accounts:** One account per user; email for verification/reset.
- **Backend:** A Supabase project (Postgres + Auth + Storage + Edge Functions).
- **Third-party services:** Stripe (billing/Stripe Tax), a transactional email
  provider, an image-moderation provider, and error/analytics tooling.
- **Dev:** Node.js LTS, the Supabase CLI for local migrations, Stripe CLI for
  webhook testing.

---

## Pricing & Subscriptions

**Model:** Players never pay. **There is no free tier** — every campaign runs on
**Pro**, which opens with a **30-day free trial** (no charge until it ends; cancel
anytime) and then a subscription on one of **three intervals — monthly,
semi-annual, or annual** (longer intervals discounted). The campaign's DM is the
buyer, per campaign.

**Pro pricing (USD):**

| Interval | Price | Effective /mo | Savings vs monthly |
|---|---|---|---|
| Monthly | $10 / month | $10.00 | — |
| Semi-annual | $50 / 6 months | ~$8.33 | 16.66% |
| Annual | $80 / year | ~$6.67 | 33.33% |

**Trial vs. paid Pro** — identical except for two limits (values tunable, not final):

| | Pro trial (30 days) | Pro (paid) |
|---|---|---|
| Players per campaign | up to **6** | unlimited (or a high cap) |
| Image storage (portraits/encounters/handouts) | smaller (e.g. ~500 MB) | generous (e.g. ~5 GB) |
| Encounters / NPCs / quests / handouts | unlimited | unlimited |
| Billing | none until trial ends | monthly / semi-annual / annual |

Everything else — all DM and player features — is fully available during the
trial; only the player count and image storage differ.

**Trial mechanics:** the DM starts a 30-day `trialing` window by putting a **card
on file** (charged $0 during the trial). The card's Stripe **fingerprint** is
recorded in `trial_redemptions`; a card that already used a trial — even on a
different account — is denied another and offered immediate-billing instead, so
new accounts can't farm free trials. `campaign_is_active()` treats `trialing` as
entitled; the player cap is **6 while trialing**, lifting to the full Pro cap on
conversion to `active`, and the storage cap likewise grows. One trial per card.

**Lapse → read-only → deletion lifecycle:**
1. **Grace (failed payment):** Stripe dunning retries for **~2–3 weeks**
   (`past_due` still counts as active); recovers seamlessly or, if exhausted,
   moves to step 2. A deliberate cancel keeps Pro until period end, then step 2.
2. **Read-only:** the **entire campaign freezes** — viewable by all, but no
   writes from anyone, **including players editing their own sheets**. Unlocks
   instantly on resubscribe.
3. **Deletion:** after **3 months** read-only the campaign is deleted. The DM is
   warned by email at 30/7/1 days and can **export a ZIP** (or resubscribe) to
   avoid loss. Auto-deletion won't ship until export (4.2) is live.

**Data portability:** the DM can export a full campaign to a ZIP anytime (even
while read-only/pending deletion) and re-import it as a fresh campaign — both a
backup feature and the escape hatch before deletion.

**Principles:**
- The trial is the full product — gate only on **player count and storage**, so
  converting is a "we've grown / we want to keep going" moment, not unlocking
  basic functionality.
- No surprise data loss: lapses are reversible (read-only), deletion is delayed
  3 months, pre-warned, and always preceded by the option to export.
- Limits, the read-only lock, and the cleanup job live in the database/Edge
  Functions (the UI only mirrors them), so they can't be bypassed client-side.
- Open: exact caps (trial storage, paid player/storage caps), annual discount
  framing, and whether multiple paid campaigns get any bundle pricing.

---

## Compliance & Operations

- **Payment data (PCI):** Stripe stores all card data; we store only opaque
  references (customer/subscription IDs, card fingerprint, optional brand/last4).
  Raw card numbers/CVV never touch our app → PCI **SAQ-A**. (See 1.5.)
- **Sales tax / VAT:** handled by **Stripe Tax** at checkout (location-based), no
  tax logic in our code. Revisit tax registration thresholds as revenue grows.
- **Legal:** Terms of Service, Privacy Policy (discloses Stripe as payment
  processor, the email provider, analytics, retention, and deletion rights), and
  a refund/cancellation policy. Versioned acceptance recorded at signup. (Phase 5.3.)
- **Data rights:** user-initiated account deletion with role-aware cascade (5.1);
  export/portability via the 4.2 functions.
- **Content safety:** all user images flow through the 1.6 pipeline
  (type/size validation, EXIF strip, resize, moderation); acceptable-use policy +
  report/takedown for shared content.
- **Email:** one transactional provider for lifecycle/billing/legal mail; Supabase
  Auth covers verify/reset only.
- **Observability & abuse:** error monitoring + alerts on webhooks and the cleanup
  cron; rate limiting on sensitive endpoints (Phase 6.2–6.3).

### Cost model (sanity check — needs real numbers)
- Main variable costs: **Supabase Storage** (images) and **egress/bandwidth**,
  plus **Stripe fees** (~2.9% + 30¢ per charge → ~$0.59 on a $10 month, ~$2.62 on
  an $80 year).
- A campaign capped at ~5 GB of images, if heavily downloaded, could move
  meaningful egress — confirm $10/mo still nets positive at the paid storage cap
  before finalizing caps/price. Thumbnails + a CDN/cache (1.6) blunt egress.
- **Action:** before launch, model worst-case storage+egress per campaign against
  Supabase's current pricing and adjust the storage cap or price if needed.

---

## Code Documentation Standards

Per the project-wide standard, all code is heavily commented:

- **Files/modules:** open with a block comment stating what the file owns and how
  it fits the system.
- **Functions/hooks/components:** JSDoc (`/** */`) covering purpose, params,
  return, side effects, and failure modes.
- **Supabase calls:** every client call documents the table/RPC name, the row
  shape sent/returned, and which RLS policy governs it.
- **RLS policies & migrations:** every policy carries a SQL comment explaining
  exactly who it grants/denies and why — these are the security contract.
- **Non-obvious logic:** invariants, ordering requirements, and workarounds get a
  comment at the point they matter.

---

## Technical Summary

- **Architecture:** React/TypeScript SPA talking directly to Supabase. No
  always-on app server and no Realtime engine in the MVP — it's CRUD over Postgres
  with RLS. Trusted/atomic server logic lives in Postgres RPCs (invite redemption)
  and Supabase **Edge Functions** (Stripe Checkout, the billing webhook, and the
  billing portal) — the webhook is the source of truth for subscription state.
- **Billing & entitlements:** no free tier — every campaign is Pro, opening with
  a 30-day trial then a per-campaign Stripe subscription (monthly/semi-annual/
  annual). `campaign_subscriptions` mirrors Stripe state via webhook. Trial and
  paid Pro differ only in player count and image storage; SQL helpers
  `campaign_is_active()`, `campaign_player_cap()`, and `campaign_storage_cap()`
  gate those limits, and a lapsed campaign becomes read-only — all enforced in
  the DB/functions so the UI can't be bypassed.
- **Security model:** Default-deny RLS on every table. Two reusable predicates —
  `is_campaign_member()` and `is_campaign_dm()` — express nearly all access:
  players see their own rows, the DM sees all player content in the campaign
  (except journals), DM tabs are DM-only, and `shared_items` is the single
  player-readable DM channel. A player's client can only ever fetch rows the
  database permits.
- **Flexible sheets:** Characters store user-defined `sheet_sections` +
  `sheet_fields` (label/value text) rather than a fixed schema — the "notepad"
  that adapts to any game system without a template builder.
- **Sharing is pull, not push:** The DM shows encounters/maps externally
  (screen-share/projector). The only in-app DM→player path is `shared_items`,
  which players read on their own schedule. No broadcasting.
- **Storage:** Portraits, encounter images, and shared handouts in Supabase
  Storage with policies mirroring table RLS.
- **Open questions for later:** whether players should be able to share a single
  journal entry with the DM in-app; optional light "live refresh" so the DM sees
  player edits without reloading; exact pricing caps and cost-model numbers (see
  *Compliance & Operations*). (Co-DM, ownership transfer, account deletion, tax,
  and campaign export are now planned in Phases 4–5.)
```