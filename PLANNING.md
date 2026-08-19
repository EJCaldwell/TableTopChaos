# TableTopChaos — Master Implementation Plan

> **Phases were renumbered on 2026-08-14** so the number matches the execution
> order. Only *unbuilt* phases moved (old 6–13 → new 6–13); **Phases 1–5 kept
> their numbers**, because they are built and referenced across ~88 code comments,
> 21 migrations, the QA folders and the git history. Old → new:
> 13→6, 8→7, 9→8, 6→9, 7→10, 10→11, 11→12, 12→13; 14 unchanged. Commit messages
> and QA run logs written before that date use the old numbering.

> **Owner actions before launch live in [PRE_LAUNCH.md](PRE_LAUNCH.md)** — the
> Stripe sandbox→live switch, the `enforce_active` flip, the rename jobs that a
> repo-wide find/replace cannot reach, test-data wipe, and the Phase 7 legal
> blockers. This file is what to *build*; that file is what *you* have to go and
> change by hand.

**Project Goal:** A "glorified notepad" web app for tabletop campaigns: the DM
keeps private tabs (encounters, notes, NPCs, etc.) and can view every player's
sheet, while each player maintains their own free-form character workspace —
with a small feature for the DM to share the occasional handout in-app.

> **Status:** Build in progress — Phases 1.1–1.4 complete and QA'd against live
> project `fnykpoattheldxtkrozd` (migrations 0001–0005). **Phase 1.5
> (Monetization) is wired end-to-end:** billing DB + entitlement functions
> (behind the `enforce_active` kill-switch, still **OFF**), three billing Edge
> Functions deployed and ACTIVE, secrets set, and the Stripe webhook registered
> in a sandbox — the DM-only "Plan & billing" tab can run a real test checkout.
> The only open security advisors are the by-design `redeem_invite_code` DEFINER
> RPC and the optional leaked-password toggle. Remaining before 1.5 closes:
> formal 1.5.3 QA (Stripe test clocks), the read-only banner/status badge
> (1.5.2), and the launch-time flip of `enforce_active=true`. Next phase (1.6,
> media pipeline) **not started**.

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
- [x] 1.1 — Project & Supabase setup
  - [x] 1.1.1 — Backend *(project `fnykpoattheldxtkrozd`; migration 0001 applied; RLS default-deny; function search_path hardened)*
  - [x] 1.1.2 — Web UI *(scaffold builds & type-checks; typed client wired to live project)*
  - [x] 1.1.3 — QA *(build passes; anon query returns `200 []` = reachable + default-deny; only expected INFO advisor)*
- [x] 1.2 — Auth & accounts
  - [x] 1.2.1 — Backend *(migration 0002: signup trigger + own-profile RLS; DEFINER exposure revoked; advisors clean)*
  - [x] 1.2.2 — Web UI *(login/signup/reset/update-password, auth guard, profile screen; builds clean)*
  - [x] 1.2.3 — QA *(signup→profile row, session persistence, logout/login, cross-user isolation verified in browser)*
- [x] 1.3 — Campaigns, membership & invite codes
  - [x] 1.3.1 — Backend *(migrations 0003–0004: campaigns/members/invite_codes, is_campaign_member/dm predicates, redeem_invite_code RPC, co-member profile reads; RLS recursion-safe; RPC validation tested)*
  - [x] 1.3.2 — Web UI *(dashboard: list/create/join; campaign page: roster + DM invite-code management; builds clean)*
  - [x] 1.3.3 — QA *(create→invite→join, DM/Player roles, invalid/revoked codes rejected, non-member blocked by RLS — verified in browser)*
- [x] 1.4 — Role-based app shell & navigation
  - [x] 1.4.1 — Backend *(no new SQL: caller's per-campaign role is exposed via RLS through listMyCampaigns, which also feeds the switcher)*
  - [x] 1.4.2 — Web UI *(tabbed workspace shell: role-filtered tab bar, campaign switcher, DM/player badge; Overview tab holds roster + DM invite codes + owner danger zone; other tabs are placeholders; type-checks clean)*
  - [x] 1.4.3 — QA *(role-based-tabs, campaign-switcher, campaign-deletion checklists all passed in browser — QA/1.4_tests/)*
- [x] 1.5 — Monetization (per-campaign subscriptions) *(build + QA complete; remaining items are launch-time owner actions, noted below)*
  - [~] 1.5.1 — Backend *(DB foundation done — migration 0005: billing_config kill-switch, campaign_subscriptions (+RLS: DM read only), trial_redemptions (locked), entitlement fns campaign_is_active/player_cap/storage_cap, redeem_invite_code enforces read-only lock + player cap. Edge Functions **deployed** to live project via Supabase connection — all ACTIVE v1 (create-checkout-session + create-billing-portal-session verify_jwt=true, stripe-webhook verify_jwt=false), Stripe price IDs wired. Secrets **set** (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SIGNING_SECRET) and Stripe **webhook registered** in a Stripe **sandbox** (4 events → the deployed webhook URL); billing flow now live-testable. **Pending (owner action):** Stripe Tax decision, daily-cleanup cron (defer until export/4.2 ships), then flip enforce_active=true at launch)*
  - [~] 1.5.2 — Web UI *(DM-only "Plan & billing" tab built: status card for none/trial/active/past_due/lapsed, interval selector w/ live $9.99/$49.99/$79.99 prices, Start-trial/Subscribe → Checkout, Manage-billing → portal, post-checkout return notices. **Pending:** cross-member read-only banner + campaign status badge — depend on a members-readable access RPC, to add when enforce_active flips)*
  - [x] 1.5.3 — QA *(**executed — all areas PASS**. checkout-and-trial, anti-abuse-trial-per-card (re-verified under the new reused-card **cancel** behavior), access-control run with the kill-switch OFF; player-cap, read-only-lock, lifecycle-dunning-cancel driven with enforce_active=true + Stripe test clocks. Two boxes left unchecked by design: the *optional* second-non-owner-DM case and the retry **exhaustion** case (same is_active=false read-only outcome already proven by the cancel flow + Test 5 lapse). storage-cap & cleanup-cron carried forward to 1.6 / 4.2 with documented reason. Test data wiped clean afterward.)*

  > **Why 1.5.1 and 1.5.2 are marked `[~]` (partial) and not `[x]`:** both are fully
  > built and QA'd, but each has a genuine **launch-time owner action** still
  > outstanding — not a bug, not unfinished code:
  > - **1.5.1 (Backend):** the `enforce_active` kill-switch is still **OFF**, so
  >   billing is not yet enforced anywhere in the live app (every campaign is
  >   treated as active/uncapped). It stays off on purpose until you're ready to
  >   actually charge people — flipping it is a one-line `UPDATE`, deliberately
  >   left for launch day. Also pending: a Stripe Tax decision, and the daily
  >   storage-cleanup cron (intentionally deferred to Phase 4.2).
  > - **1.5.2 (Web UI):** the DM-only "Plan & billing" tab is done, but the
  >   **cross-member read-only banner + campaign status badge** (what a *player*,
  >   not the DM, sees when a campaign lapses) hasn't been built yet — it needs a
  >   members-readable entitlements RPC that only makes sense to add once
  >   `enforce_active` actually flips, since until then no campaign is ever
  >   read-only for anyone to see.
  >
  > Net effect: the monetization system is code-complete and verified: nothing is
  > broken or half-implemented, it's just deliberately not "live" yet.
- [x] 1.6 — Media upload pipeline & content safety *(build + QA complete)*
  - [x] 1.6.1 — Backend *(migrations 0008/0009: media_assets + media_reports + private `media` bucket + RLS + storage-used/entitlements helpers + report_media/set_media_status RPCs; `upload-media` Edge Function: magic-byte + size validation, EXIF strip + WebP re-encode + thumbnail via ImageMagick WASM, storage-cap + read-only checks, pass-through moderation hook. Automated provider + blocked-byte deletion deferred.)*
  - [x] 1.6.2 — Web UI *(src/features/media/: `api.ts` (uploadMedia/signedUrlFor/report/moderate) + reusable `<ImageUpload>` — drag/drop, client pre-validation, preview, errors. Consumed by portrait/handout features in Phase 2+.)*
  - [x] 1.6.3 — QA *(**executed 2026-07-08 — all 4 areas PASS**. upload-validation 7/7; processing-and-variants 5/5; storage-cap-and-readonly (over-cap 413 + read-only 403, nothing stored); moderation report/takedown (flag-on-report, RLS denies serving flagged/blocked to everyone incl. path-holders, DM-only moderate, member can't see blocked row). **Two real bugs found + fixed:** (1) WebP re-encode was a silent no-op — `MagickFormat.Webp` (should be `WebP`) wrote source format under an `image/webp` label; fixed casing + added a magic-byte guard. (2) ImageMagick-WASM OOMs the Edge worker above ~4.5 MP; fixed with client-side canvas downscale to ≤2048 px + a server header pixel-cap that returns a clean 413. `upload-media` redeployed to v4. **Follow-ups (non-blocking):** real-browser smoke test of the client `downscaleIfNeeded` path when the upload UI lands in a Phase 2 feature; blocked-byte physical deletion (deferred to 4.2 cleanup-cron). Test data wiped afterward.)*

### Phase 2: Player workspace (flexible notepad)
- [x] 2.1 — Character record & flexible sheet (sections + fields)
  - [x] 2.1.1 — Backend *(migration 0010: characters + sheet_sections + sheet_fields; owner read/write, DM read-only, other players no access; advisors clean)*
  - [x] 2.1.2 — Web UI *(CharacterPanel: creation, free-form sections/fields, debounced autosave + optimistic UI, drag-to-reorder, portrait upload, starter layout; wired into the "My character" tab)*
  - [x] 2.1.3 — QA *(2026-07-09 PASS — both areas; RLS owner/DM-read/other-none verified in-browser; 3 non-blocking follow-ups logged: delete confirmations, drag-to-bottom + drop indicator, offline-save retry)*
- [x] 2.2 — Inventory
  - [x] 2.2.1 — Backend *(migration 0012: inventory_items — name/qty/notes/equipped/position; RLS reuses 0010 can_read/can_write_character; advisors clean)*
  - [x] 2.2.2 — Web UI *(InventoryPanel on the "Inventory" tab: add/edit/remove, qty, equipped flag, notes; debounced autosave + optimistic + offline retry; drag-to-reorder)*
  - [x] 2.2.3 — QA *(2026-07-09 PASS — both areas; RLS owner/DM-read/others-none verified in-browser; added expandable notes + ghost item name (migration 0013))*
- [x] 2.3 — Lore, backstory & portrait
  - [x] 2.3.1 — Backend *(migration 0014: backstory/appearance/personality text cols on characters; RLS unchanged (0010 covers them); portrait already on characters.portrait_asset_id via 1.6 pipeline)*
  - [x] 2.3.2 — Web UI *(LorePanel on the "Backstory" tab: 3 lore fields w/ Edit/Preview, XSS-safe markdown subset, debounced autosave + offline retry. NOTE: portrait upload stays on the "My character" tab from 2.1, not duplicated here)*
  - [x] 2.3.3 — QA *(2026-07-13 PASS — both areas; lore edit/autosave/persist, XSS-safe markdown Preview (HTML/script inert), portrait access owner+DM signed URL / non-member denied (0008 Storage RLS); added lore preview-on-load; blank-name create error message)*
- [x] 2.4 — Spells/abilities & personal journal
  - [x] 2.4.1 — Backend *(migration 0015 journal_entries (owner-only; DM reads only shared=true); migration 0016 abilities (features/feats: name/description/optional uses) + spells (name/level 0-9/prepared/description) — both reuse 0010 predicates; advisors clean)*
  - [x] 2.4.2 — Web UI *(3 separate player tabs: "Abilities & Feats" (AbilitiesPanel, drag-reorder) · "Spells" (SpellsPanel, grouped by level, prepared toggle) · "Journal" (JournalPanel, per-entry Share-with-DM). All autosave + offline retry)*
  - [x] 2.4.3 — QA *(2026-07-14 PASS — both areas; abilities/spells edit/reorder/persist + RLS (DM read-only: update→[], insert→403; co-player/anon read→[]); journal privacy (headline 2.4.3): DM sees only shared=true, unshared-by-id→[], DM update→[], co-player/anon→[], un-share re-hides. Added during QA: AutoTextarea auto-grow boxes; spell within-level drag-reorder (locked to level); journal entry drag-reorder + view-only sort (Manual/Newest/Oldest/Title A–Z/Z–A, manual order persists) + per-entry timestamp)*

### Phase 3: DM workspace
- [x] 3.1 — Notes & session log/recaps
  - [x] 3.1.1 — Backend *(migration 0017: dm_notes (title/body/tags/position) + sessions (title/date/recap/attendees/position); RLS DM-only for every op via private.is_campaign_dm; NPC/quest/encounter links deferred to 3.2/3.3, tags cover organize/filter for now)*
  - [x] 3.1.2 — Web UI *(Secret notes tab: NotesPanel w/ tags + tag-filter bar; Session log tab: SessionLogPanel w/ date + attendees + recap. Shared dm/autosave hook (debounce + offline retry + drag-reorder) extracted from the character panels; both DM-only tabs gated in CampaignPage; build clean)*
  - [x] 3.1.3 — QA *(2026-07-15 PASS — all 3 areas; notes editing (tags comma/space typing + filter bar + drag-reorder) and session-log editing (date-clears-to-null + attendees typing + reorder) verified in-browser; headline access-control: DM full CRUD, player (member) reads []/[] + insert→403 + update→[], non-member + anon read nothing; tabs absent from player UI. Policy layer confirmed via pg_policies (8 DM-only policies on is_campaign_dm); advisors clean for 0017)*
- [x] 3.2 — Encounters (with images)
  - [x] 3.2.1 — Backend *(migration 0020 (re-spec): encounters (name/description/hidden_notes) + encounter_images (asset→media_assets) + encounter_npcs link; npcs roster (name/description/optional portrait) + npc_stat_sections/npc_stat_fields (configurable stat block like the player sheet). DM-only RLS every op via is_campaign_dm + new is_encounter_dm / is_npc_dm / is_npc_section_dm helpers; advisors clean. NOTE: also delivers the 3.3 shared NPC roster)*
  - [x] 3.2.2 — Web UI *(NpcsPanel on "NPCs" tab: roster master/detail + portrait + description + configurable stat block (add sections/fields, drag-reorder, autosave). EncountersPanel on "Encounters" tab: master/detail + description + DM-only "Hidden nearby" box + multi-image upload/caption/reorder + full-screen Present view + link roster NPCs (with read-only inline stat block). New reusable useDragReorder hook in dm/autosave; build clean)*
  - [x] 3.2.3 — QA *(2026-07-15 PASS — all 4 areas; NPC roster + configurable stat blocks (+ Duplicate NPC, ghost-text titles, grow/scroll value boxes), encounters (description/hidden notes/images/linked NPCs), presentation view full-screen; headline access-control: DM full CRUD, player/member reads []/insert 403, non-member+anon [] across all 6 tables; both tabs absent from player UI. Also added per-campaign active-tab persistence across refresh)*
- [x] 3.3 — NPC roster & quest/plot tracker
  - [x] 3.3.1 — Backend *(NPC roster `npcs` (+ stat blocks) shipped with 3.2's migration 0020; migration 0021 adds `quests` (title/status active|completed/description/plot_notes/position); RLS DM-only every op via is_campaign_dm; advisors clean. NOTE: plan's npcs.status field folded into the stat-block model — not added as a column)*
  - [x] 3.3.2 — Web UI *(NPCs roster tab shipped in 3.2 (NpcsPanel). QuestsPanel on the "Quests" tab: board grouped by status (Active/Completed), per-quest title + status select (moves group) + description + DM-only plot notes, drag-reorder within a group, autosave. Reuses dm/autosave + useDragReorder; build clean)*
  - [x] 3.3.3 — QA *(2026-07-15 PASS — quests editing (status grouping Active/Completed, reorder, autosave, persist) + access-control (DM full CRUD; player/member []/403; non-member+anon []); NPC invisibility covered by 3.2.3. NPCs + quests invisible to players confirmed)*
- [x] 3.4 — Party view (read player sheets)
  - [x] 3.4.1 — Backend *(no migration — confirmed via pg_policies that the DM read scope already spans characters (owner OR is_campaign_dm), sheet sections/fields, inventory, abilities, spells (can_read_character/can_read_section), and lore/portrait; journal excluded — journal_entries select is owner OR (shared AND is_character_dm), so the DM sees only shared entries)*
  - [x] 3.4.2 — Web UI *(read-only PartyPanel on the DM "Party" tab: roster of every player character (name + owner), select one for a read-only sheet — portrait, lore (safe markdown), flexible sections/fields, inventory, abilities, spells grouped by level. No journal surfaced; new listCampaignCharacters + party/api.ts bundle; build clean)*
  - [x] 3.4.3 — QA *(2026-07-15 PASS — both areas; DM Party tab lists all player characters and opens each read-only (portrait, lore, collapsible sheet sections, inventory, abilities, spells), nothing editable; headline journal-exclusion: no Journal on the view, and DM journal_entries read returns only shared entries ([] here, both journals private) while inventory/abilities/spells read fine)*
- [x] 3.5 — DM private helpers (initiative list + dice roller)
  - [x] 3.5.1 — Backend *(migration 0022: initiative_entries (name/initiative/notes/position); RLS DM-only every op via is_campaign_dm; advisors clean. Dice roller is client-side — no table (optional dm_dice_log intentionally omitted). Migration 0023 added hp/max_hp/npc_id (FK npcs ON DELETE SET NULL) for the per-combatant HP tracker + inline NPC stat-block link)*
  - [x] 3.5.2 — Web UI *(CombatPanel on the DM "Combat" tab: initiative tracker (add blank / seed from party / add roster NPC, edit name/initiative/notes, sort by initiative + drag-reorder ties, step-through current-turn + round counter (client-only), clear) and a client-side dice roller (standard notation e.g. 2d6+3 + quick d20/d12/… buttons, in-session history). Reuses dm/autosave + useDragReorder. Per-combatant HP tracker shown as current/max (saves immediately); adding an NPC links it + auto-seeds HP from an HP-labelled stat field; ▸ Stats expands a read-only inline panel with the NPC's description + full stat block so attacks/abilities are visible without leaving Combat; build clean)*
  - [x] 3.5.3 — QA *(2026-07-21 PASS — both areas. Combat tools: add/seed/edit/sort/reorder/step/persist + dice parsing/validation/history; HP tracker current/max persists, NPC add auto-seeds HP + ▸ Stats inline view (description + stat block). Access control: Combat tab absent for players; DM full CRUD; player insert 403; anon select [] after real signOut; pg_policy audit confirms all four policies authenticated-only + is_campaign_dm, no anon policy)*

### Phase 4: In-app sharing & data export/import
- [x] 4.1 — Shared items model & visibility
  - [x] 4.1.1 — Backend *(migration 0024: shared_items (type note|image, title, body, asset_id→media_assets ON DELETE CASCADE, shared_at, position); type-shape CHECK ensures image⇒asset / note⇒no asset. RLS asymmetry — SELECT is_campaign_member (DM+players read), INSERT/UPDATE/DELETE is_campaign_dm (DM writes/un-shares). Advisors clean for shared_items)*
  - [x] 4.1.2 — Web UI *(shared/SharedPanel.tsx: HandoutsPanel (DM "Handouts" tab) — note composer (title + safe-markdown body) + image upload (reuses ImageUpload/1.6 pipeline, shares on upload), plus a manage list with inline title/body/caption edit (debounced autosave) and Un-share (confirm); SharedWithUsPanel (player "Shared with us" tab) — read-only feed newest-first, notes via renderSafeMarkdown, images signed-URL-resolved. Wired in CampaignPage (handouts&&isDm, shared&&!isDm); typecheck + build clean)*
  - [x] 4.1.3 — QA *(2026-07-21 PASS — DM shares note+image; player sees them (Shared with us); un-share removes for all; player insert 403, un-shared dm_notes []; positive read Array(1) under confirmed player session + server-side is_campaign_member/count simulation. Earlier [] was a stale browser session, not RLS)*
- [x] 4.2 — Campaign export & import (ZIP archive)
  - [x] 4.2.1 — Backend *(3 Edge Functions, deployed, verify_jwt=false + getUser inside. export-campaign (DM-only, service role, no writability check so it works read-only/pending-deletion): gathers every campaign-scoped row → campaign.json (ids preserved; members as display names) + manifest.json (schemaVersion 1, app version, counts, sha256 of campaign.json) + images/<storage_path> bytes, returns application/zip Blob. Includes player journals (documented privacy exception). import-campaign (creates a BRAND-NEW campaign owned by importer — never overwrites; new ids everywhere via in-memory old→new maps, images re-uploaded to fresh paths + refs rewritten, importer sole DM, characters re-owned to importer; validates manifest version + checksum; best-effort rollback deletes half-built campaign + uploaded objects on any failure). export-journal (any member; USER client so RLS scopes to caller's own entries; returns entries + Markdown). No temp bucket — zip returned/consumed directly. **Schema v2** (export v3 / import v4) added character_status + schedule_sessions + schedule_rsvps to the archive; import rebuilds character_status (PK character_id) + schedule_sessions but intentionally skips schedule_rsvps (per-user availability tied to specific accounts). Import accepts v1 or v2)*
  - [x] 4.2.2 — Web UI *(exportImport/api.ts wrappers (blob download helper, JSON {error} extraction); CampaignDataPanel ("Backup & data" in DM Overview) — Export campaign (.zip) + Import (choose .zip → confirm → import → summary of counts + "Open the new campaign"); "Download my journal" button in JournalPanel (JSON + Markdown, every member incl. DM for their own). typecheck + build clean)*
  - [x] 4.2.3 — QA *(2026-07-21 PASS — export produced a valid ZIP (manifest counts matched: 2 chars/4 NPCs/2 encounters/2 quests/3 sessions/1 shared/1 journal/10 assets/20 image files), import rebuilt a new "(imported)" campaign with encounters + portraits rendering and the original untouched, journal export gave JSON+MD of the caller's own entries. 2 bugs fixed: (1) invoke only Blob-decodes octet-stream → export now octet-stream + client re-labels zip; (2) import 500 dup campaign_members (owner auto-added by trigger) → upsert ignoreDuplicates, plus PostgrestError message surfacing)*
- [x] 4.3 — Player HP & conditions + shared scheduling *(added after Phase 4: fills two placeholder tabs the user asked for; Dice + Party loot placeholders removed)*
  - [x] 4.3.1 — Backend *(migration 0025 character_status: one row per character (current/max/temp HP, death-save tallies 0..3 CHECK, conditions text[]); RLS mirrors character children — SELECT can_read_character (owner OR DM), write can_write_character (owner only). migration 0026 scheduling: schedule_sessions (DM-proposed title/proposed_at/notes; RLS members read, DM write) + schedule_rsvps (per-member yes/maybe/no, unique(session,user); RLS members read via can_access_session SECURITY DEFINER helper, member writes only own). Advisors clean for all 3 tables)*
  - [x] 4.3.2 — Web UI *(status/HpConditionsPanel.tsx (player "HP & conditions" tab): current/max/temp HP, Damage/Heal (temp-first), 3+3 death-save pips, 15 standard-condition toggle chips; lazy upsert on first edit. schedule/SchedulePanel.tsx (shared "Scheduling" tab): DM proposes/edits/deletes sessions, every member RSVPs + sees tally with names. Removed Dice + Party loot from tabs.ts; wired schedule&&user, hp&&user in CampaignPage. Types regenerated. typecheck + build clean. (Export/import extended to cover these — see 4.2 schema v2))*
  - [x] 4.3.3 — QA *(2026-07-29 PASS — HP: temp-first damage/heal-cap/death saves/conditions persist; DM read + no-write proven server-side (can_read=true, can_write=false). Scheduling: DM propose/edit/delete, member RSVP + tally-with-names, player session insert 403; +Today quick-fill button. Also added a read-only HP & conditions block to the DM Party view. Bug fixed: listRsvps profiles-embed had no FK relationship → "failed to load"; now resolves names via a second profiles query)*
- [x] 4.4 — Realtime sync (no-refresh live updates)
  **Goal:** DM and player screens reflect each other's changes live, without a
  manual page refresh, using Supabase Realtime (Postgres change broadcasts over
  a websocket). RLS still gates every event — a client only receives changes for
  rows it may already read — so no new exposure surface.
  - [x] 4.4.1 — Backend *(migration 0027: added character_status, shared_items, schedule_sessions, schedule_rsvps, initiative_entries to the supabase_realtime publication + REPLICA IDENTITY FULL on each (so UPDATE/DELETE events carry the full old row for RLS evaluation). No new RLS — existing read policies scope which events each client receives)*
  - [x] 4.4.2 — Web UI *(realtime/useRealtimeRefresh.ts exports useRealtimeSync (granular, per-row MERGE — preferred) + useRealtimeRefresh (coarse debounced re-fetch, fallback) + mergeById helper; unique channel per useId, removeChannel on unmount. Wired with ROW-LEVEL MERGE (only the changed row/field re-renders, no flicker/focus loss): CombatPanel initiative_entries (mergeById), SharedPanel DM+player (resolveSharedItem re-signs image URLs, merge/prepend/remove), SchedulePanel (sessions mergeById+re-sort; rsvps keyed by session+user with one-time profile name lookup), HpConditionsPanel (own character_status fields), PartyPanel (patches sheet.status on the open sheet). Editors keep optimistic local updates; Realtime drives OTHER viewers (self-echoes merge idempotently). typecheck + build clean)*
  - [x] 4.4.3 — QA *(2026-07-29 PASS — two concurrent sessions: HP→Party, Handouts→Shared, Scheduling both ways, Initiative across DM tabs all merged live (~1–2s, per-row, no flicker); signed-out tab got nothing; tab-switch teardown clean. Row-level merge approach verified)*

### Phase 5: Game mode foundation & selection
- [x] 5.1 — Mode data model & switching
  - [x] 5.1.1 — Backend *(migration 0028: public.game_mode enum ('notetaker' | 'playspace' | 'rpg') + campaigns.game_mode NOT NULL DEFAULT 'notetaker' — default means no backfill and every existing campaign is unaffected (verified: all read 'notetaker'). No new RLS: switching is a plain campaigns UPDATE, so it inherits campaigns_update_dm (private.is_campaign_dm(id), USING + WITH CHECK), the only UPDATE policy on the table. Deliberately NO trigger and NO cascade on the column — switch-down is non-destructive, documented next to the column: lower modes stop READING playspace (Phase 9) / combat (Phase 10) rows, never delete them. getCampaign/listMyCampaigns already select('*') so game_mode flows through with no new endpoint; api.ts adds GameMode, GAME_MODES (single source of option order + copy), gameModeRank, setGameMode (.single() so a blocked update throws), and a gameMode param on createCampaign)*
  - [x] 5.1.2 — Web UI *(shared campaigns/ModePicker.tsx radio-group segmented control (label + one-line description per mode, accent border on the selected one, disabled while saving) used by BOTH surfaces so wording/order can't drift. DashboardPage create form: "How will this campaign play?" defaulting to Note taker, resets after create. OverviewPanel: new "Game mode" section above the roster — DM picks → confirm step whose copy branches on gameModeRank (up = "unlocks the extra features"; down = "only hides the richer features, nothing is deleted, they come back if you switch up") → setGameMode → onModeChanged updates the shell's campaign in place (no refetch), ready for 5.2's chrome branch. Re-picking the active mode clears the pending state instead of confirming a no-op. Players see a read-only "Only the DM can change it" line. Types regenerated (campaigns.game_mode + Enums.game_mode). typecheck + build clean)*
  - [x] 5.1.2b — Web UI: DM Settings tab *(added on request after 5.1, since Overview had accumulated too many unrelated jobs. New DM-only 'settings' tab (tabs.ts, last in the DM group) rendering campaigns/SettingsPanel.tsx: Campaign name (rename), Game mode (the 5.1 picker + confirm), Backup & data (CampaignDataPanel), and the owner-only Danger zone. OverviewPanel trimmed to the people side — roster + DM invite codes + a read-only "plays as X, change it in Settings" line — and lost its isOwner/onRenamed/onModeChanged props; the shell now passes those to SettingsPanel instead. Pure relocation: no behavior change to rename/export/delete. Split rationale: Overview = "who's in this campaign and how do I add someone?", Settings = "how is this campaign configured?". typecheck + build clean)*
  - [x] 5.1.2c — Cleanup: removed the co-DM concept *(co-DM was already "considered and intentionally dropped from scope" (see Technical summary), but stale language implied it was coming. Now: migration 0029 rewrites the in-DB comments on campaign_role / add_owner_as_dm / campaigns_update_dm to state the real invariant — exactly ONE 'dm' member per campaign, its owner (0003's matching comments corrected in place so a fresh DB and an existing one describe themselves identically; comments only, zero behavior change). createInviteCode lost its `role` parameter and hard-codes 'player', closing the only client path that could ever have minted a DM code. Reworded roster-sort / CombatPanel / SettingsPanel comments and dropped the "non-owner DM" optional steps from QA 1.5 + 5.1. Verified in the DB: all 7 campaigns have exactly 1 dm member and it is always the owner; all invite codes are role=player, so no data cleanup was needed. SettingsPanel still gates the danger zone on isOwner — that mirrors campaigns_delete_owner (owner-based) vs the rest of the panel (DM-based), which is belt-and-braces now that DM == owner)*
  - [x] 5.1.3 — QA *(**COMPLETE/PASS 2026-08-07 — all three areas.** QA/5.1_tests/ rewritten from scratch 2026-07-31. **Automated + server-side: PASS** — build clean; advisors show no new lints from 0028/0029; mode-access.md re-ran the full four-role matrix live (DM update → 1 row; member player → 0; non-member → 0; anon read → 0; member read → 1), audited pg_policies on campaigns (4 policies, all {authenticated}, no anon policy, campaigns_update_dm is the only UPDATE and is is_campaign_dm in USING + WITH CHECK), confirmed the enum rejects an invalid value (22P02), that the only triggers on campaigns are add_owner_as_dm (AFTER INSERT) + set_updated_at (BEFORE UPDATE) with no cascade on the column, and that a DM's rpg→notetaker→playspace round trip leaves every child-row count identical. **Browser checklists: PASS 2026-08-07** — the user ran mode-selection.md (all 12 steps: create-picker default + reset, confirm-before-save, correct up/down copy, no confirm on a no-op re-pick, Cancel reverts unsaved, persistence across hard refresh + navigation, player sees a read-only line and no Settings tab, no chrome change or console errors on a notetaker campaign) and settings-tab.md (all 11: tab placement/gating, reduced Overview, rename + blank-name validation, export/import, journal export, owner-only delete confirm/cancel/delete, player-only invite codes). **One follow-up applied:** import was removed from Settings → Backup & data, which is now export-only — importing always creates a *brand-new* campaign, so it belongs to the dashboard flow that already owns it; offering it inside a campaign's settings implied it would overwrite that campaign. CampaignDataPanel lost its file input, pending-file confirm and post-import summary; importCampaign/ImportResult remain for DashboardPage; build clean after (652.99 → 650.63 kB). settings-tab.md step 8 now asserts the import controls are absent — re-verify that one step on the next browser pass. The maps/tokens/combat half of the non-destructive invariant stays deferred to Phase 9/10 QA)*
- [x] 5.2 — Mode-aware app shell (sidebar + pop-out)
  - [x] 5.2.1 — Web UI *(CampaignPage now branches its chrome on campaign.game_mode: 'notetaker' keeps the original top tab bar untouched, 'playspace'/'rpg' render the new campaigns/PlayspaceShell.tsx and widen the container 860→1600. Enabling refactor first: the shell's long inline `activeTabDef?.key === …` chain was extracted to campaigns/TabBody.tsx, so BOTH chromes render the same panels from the same role guards and cannot drift; both also take visibleTabs from the one tabsForRole(isDm) memo, so the rail has no tab list of its own. PlayspaceShell = collapsible left rail (« Collapse → single-letter strip) + a docked drawer showing the active tab (drawer open/closed is state SEPARATE from which tab is active, so closing it to see the map doesn't lose your place) + a floating layer over a Phase-6 battlemap placeholder. A panel is docked, floating, or closed — never two at once (a second mount would run duplicate queries + realtime subs); clicking a floating tab in the rail focuses it instead of docking a copy. campaigns/FloatingPanel.tsx: drag by title bar, resize from a corner grip, both via Pointer Events + setPointerCapture (a fast drag can't strand the window), rect committed to the parent once on release rather than per pointermove so persistence isn't written 60×/s; clamped so some title bar always stays reachable; array order IS z-order, focus moves a panel to the end. campaigns/layout.ts persists {sidebarCollapsed, drawerOpen, floating[]} to localStorage per campaign (`campaign:<id>:layout`) — a per-user VIEW PREFERENCE, deliberately never in Postgres and so with no RLS story. loadLayout is defensive about untrusted input: bad JSON, non-finite coords, duplicate keys, off-screen/sub-minimum rects and — importantly — floating entries for tabs the caller may no longer see are all pruned, with a matching effect for a role change mid-session. Chosen over window.open pop-outs (the other option PLANNING allowed) on the user's call: no popup blockers, no second document to copy styles into, no orphaned windows on refresh. NO backend, NO migration, NO new query — 5.2 adds zero data access. typecheck + build clean, 650.63 → 659.90 kB)*
  - [x] 5.2.1b — Web UI: shell revisions *(four changes on the user's request after running 5.2's QA. (1) **Plan & billing is no longer a tab** — it moved into SettingsPanel as a section between Game mode and Backup & data; 'billing' was deleted from the tabs.ts catalog with a comment telling future readers not to re-add it. Rarely visited, so it hadn't earned a permanent rail slot. Stale `activeTab:'billing'` falls back to Overview via the existing validity guard and a stale floating entry is pruned by loadLayout, so no migration of saved state was needed. (2) **Floating windows resize from all eight handles** (four edges + four corners), not just the bottom-right grip; north/west resizes derive the clamped dimension FIRST and move the origin by the difference, so the opposite edge stays pinned and the window doesn't slide sideways once it hits the minimum. The SE corner keeps its visible wedge as the affordance people look for; the other seven are invisible 8px hit zones. (3) **The workspace is full-bleed** — CampaignPage is now a 100dvh flex column (dvh not vh, so mobile browser chrome collapsing doesn't leave it short) with a compact full-width title bar; the centred 860px column is gone and the page itself no longer scrolls, panels scroll internally. (4) **Note taker uses the same shell** — the top tab bar is DELETED and PlayspaceShell became WorkspaceShell, used in every mode, so several panels can be open at once in a note-taking campaign too. Mode now only decides what sits in the middle: the docked panel fills it in notetaker (inside a 900px reading column so panels don't stretch), or becomes a fixed 460px column beside the battlemap placeholder in playspace/rpg. Structural fix that came with it: the floating layer is now positioned over the WHOLE content region rather than the space the docked panel left over, so windows can be dragged across the docked panel instead of being trapped beside it. (5) **Close tabs** — a rail button above the section list closing the docked panel and every floating window at once; shown to BOTH roles (layout is a personal view preference, nothing role-specific to gate) and only when openCount > 0, so it is never a dead control; deliberately leaves sidebarCollapsed alone (the rail is how you reopen anything, so clearing must not hide the way back) and leaves activeTab alone, so the next rail click lands where you left off. No confirm step — nothing is deleted and every panel is one click from returning. typecheck + build clean, 659.90 → 661.03 kB)*
  - [x] 5.2.1c — Web UI: click-to-open rail *(four more changes on request. (1) **The campaign title bar is gone** — that row cost a full row of vertical space in a full-bleed workspace for one line of text; the campaign name + role badge moved into a new optional `center` slot on AppHeader (flex:1 centred, so it stays centred regardless of how wide the side groups are, and degrades when the email is long). (2) **The in-workspace campaign switcher was removed** with it — switching now goes via the dashboard; listMyCampaigns is still read, but only to learn the caller's role for tab gating. (3) **The rail is side-switchable and starts on the RIGHT** (layout.railSide, persisted); the divider and the selected-entry accent marker both flip so they always face the workspace, and the collapse chevron points the sensible way per side. (4) **Clicking a rail entry opens that panel directly as a floating window** — the old "click the tab, then click ⧉" was two actions for one intent. This DELETED the docked panel concept entirely, taking the ⧉ pop-out and ⇤ dock buttons with it: a rail entry is now a three-way toggle (closed → open; open but buried → raise; already frontmost → close), where raising before closing matters or clicking a half-buried window's entry to see it would dismiss it. Consequence recorded honestly: no panel gets full width any more, which is why all-edge resize (5.2.1b) matters more than it did. layout.ts dropped `drawerOpen` and gained `railSide`; old saved layouts carrying drawerOpen are ignored rather than migrated, since it describes a UI mode that no longer exists. The build caught the dead wiring both removals left (`activeTab` prop, `useNavigate`). typecheck + build clean, 661.03 → 659.04 kB)*
  - [x] 5.2.1d — Web UI: layout robustness *(came out of explaining the QA gap rather than from a feature request, and found a REAL BUG in the process: loadLayout clamped saved window coords at zero but had NO upper bound, so a window parked near the right edge of a wide monitor restored outside the overflow:hidden workspace area — invisible, unreachable, and recoverable only via Close tabs, which closes it rather than retrieving it. Fixed with layout.clampRect (shrink-to-fit before moving, so an oversized window isn't shoved off the left edge satisfying the right), applied in an effect keyed on the measured bounds so it runs on first measure AND on every viewport resize, correcting STATE rather than just the rendered position so the recovery persists; the open() cascade clamps too. Also added LAYOUT_VERSION: saveLayout stamps it, loadLayout discards any layout without the current version. That replaces per-key defensive branches with one rule — version drift had already bitten twice ('billing' in 5.2.1b, 'drawerOpen' in 5.2.1c) and each instance otherwise needs its own branch and its own test case forever. Cost is one re-arrangement per schema change, which is the right trade for a view preference. QA consequence: layout-persistence.md went from five console snippets with no path to completion (the user does not run console steps) to console-free apart from one optional step, and its "player injects a DM-only panel" step was DELETED as theatre — a player owns their own localStorage, so it proved nothing about security; RLS is the control and role gating is tested with a real player account. typecheck + build clean, 659.04 → 659.58 kB. **Also added the project's first automated behavior test:** QA/tools/layout-checks.mts + `npm run qa:checks` (tsx devDependency), 30 assertions over loadLayout/saveLayout/clampRect against a stubbed localStorage — corrupt JSON, stale AND future schema versions, retired tab keys, role filtering, duplicates, non-finite numbers, the full clamp geometry incl. idempotence (which is what stops the correcting effect looping), and a round trip. This exists because the user instructed that console/devtools steps are never theirs to run; the answer is to test pure logic directly rather than hand them snippets. Not a general test runner — that is still Phase 8.)*
  - [x] 5.2.1e — Web UI: draggable rail width *(the rail's expanded width is now user-dragged from its inner edge — a 7px invisible grab strip pinned to whichever side faces the workspace, so it moves with the rail; double-click resets to default. Live width previewed in local state and committed to the layout once on release, same as FloatingPanel, so localStorage isn't written per pointermove. The drag delta is NEGATED when the rail is on the right, since dragging left grows a right-hand rail but shrinks a left-hand one. Hidden while collapsed (fixed width there, and dragging it would be a way to get stuck unreadable); the dragged width is preserved across a collapse/expand cycle. layout.railWidth clamped to [140, 480] on load via clampRailWidth. **Deliberately did NOT bump LAYOUT_VERSION** — the field is purely additive with a sensible default, so a v1 layout is still fully meaningful and discarding it would throw away the user's arrangement for nothing; the version bump is for changes that alter MEANING, not for additions. Harness extended to 40 assertions, and a tsconfig.qa.json (+@types/node) now type-checks QA/tools before running it, since the app tsconfig covers src/ only and the harness imports app types — railWidth is exactly the kind of change that would otherwise have silently invalidated it. typecheck + build clean, 659.58 → 660.45 kB)*
  - [x] 5.2.1f — Web UI: rail footer, shared Settings, Overview on entry *(six changes on request. (1) **Close tabs is now permanent and pinned to the bottom of the rail, in red** — always rendered rather than appearing only when something is open, since the user wanted a fixed position to rely on; DISABLED (dimmed, not hidden or recoloured) at zero open panels so it never silently does nothing. (2) **Settings moved to the very bottom**, below Close tabs, under its own top border — the requested separating line. It is last in the catalog too, via a new `railFooter` flag, so catalog order and visual order agree. (3) **Overview left the rail entirely** (new `railHidden` flag) and instead **auto-opens when you enter from the dashboard**: DashboardPage's four navigations into a campaign now carry router state `{openOverview:true}`, which a refresh or pasted URL does not, so that state IS the "came from the main menu" signal. The auto-open is keyed on campaign id in a ref so it fires once per campaign and never fights a saved layout or reopens a window the user just closed. NOTE `tabsForRole` still returns railHidden tabs — it stays the single source of truth for ACCESS, so a saved Overview window is still legal; the new railTabs/railFooterTabs helpers decide only what is DRAWN. (4) **Settings is now `audience: 'all'`** — players get it too. SettingsPanel gained a **Workspace** section shown to everyone (sidebar position + reset layout) and the entire campaign-administration half is wrapped in `isDm`, so a player opening Settings sees exactly one section. The isDm check is UI convenience as ever; campaigns_update_dm / campaigns_delete_owner remain the real gate. (5) **The rail-side switch moved out of the rail into Settings → Workspace** for both roles, and the ⇤/⇥ rail button is gone; the shell owns layout state, so SettingsPanel takes an explicit WorkspacePrefs prop rather than reaching into storage — one writer of the layout. Reset layout added alongside it (bigger hammer than Close tabs, not something you want mid-session in the rail). typecheck + build clean, 660.45 → 663.37 kB; qa:checks still 40/40)*
  - [x] 5.2.1h — Web UI: Scheduling into Overview, Overview reachable *(two changes. (1) **Scheduling is no longer a tab** — SchedulePanel now renders as a section at the foot of OverviewPanel, and 'schedule' left the catalog (its TabBody branch and import went with it, which noUnusedLocals enforced). Rationale: it answers the same question as the roster — who is in this campaign and when are we playing — so it was competing for a rail slot it didn't need. No data or RLS change; SchedulePanel owns its own queries and heading either way. (2) **Overview is reachable again.** 5.2.1f made it railHidden + auto-open-from-dashboard, which left it unreachable once closed — you had to navigate back to the dashboard, and in a playspace campaign that is a real dead end. It is now a rail FOOTER entry (railHidden dropped) while KEEPING the dashboard auto-open, so it is reference material you can always get back to without taking a slot in the working section list. Rail footer order is now Overview → Close tabs (red) → Settings, with Settings still under its own divider; the footer-entry markup was extracted to a renderFooterTab helper so the two groups around Close tabs can't drift. typecheck + build clean, 663.37 → 663.43 kB; qa:checks 40/40)*
  - [x] 5.2.1i — Web UI: Campaign overview in the header *(Overview left the rail entirely and became a **"Campaign overview" button in the app header, beside the home link** (AppHeader gained a `leading` slot); the tab was renamed to match, so its window title reads the same. Rationale: it is campaign-level reference material — the same altitude as the home link next to it — while the rail should list only the places you work. Mechanically this needed a way for a control OUTSIDE the shell to drive the shell's layout state, so `autoOpenTab` became `openRequest: {key, nonce}`: the effect fires on nonce change, opening the panel or RAISING it if already open (never duplicating, preserving one-window-per-section). A nonce rather than a boolean because the same request legitimately repeats — clicking the button twice must re-raise the window, which a flag cannot express. CampaignPage seeds the nonce to 1 when arriving from the dashboard, so entry-open and button-open are now one mechanism instead of two. Overview is railHidden again; the rail footer is back to Close tabs + Settings. typecheck + build clean, 663.43 → 663.94 kB; qa:checks 40/40)*
  - [ ] 5.2.1g — Web UI: rail icons *(**deferred at the user's request — do not start without asking.** Give every rail entry an icon, and show the section name as a hover tooltip rather than inline text. That makes the collapsed rail genuinely usable (it currently shows a single letter, which is a placeholder at best) and lets the expanded rail be narrower. Open questions to settle first: icon source (inline SVG set vs a dependency — inline keeps the bundle and the CSP story simple), whether expanded still shows text beside the icon or icon-only, and accessibility (a tooltip is not an accessible name, so aria-label must carry the label regardless).)*
  - [x] 5.2.1j — Web UI: overview page, big Settings, drag fixes *(from the 5.2.2 QA run. (1) **DEFECT FIX — windows could not be dragged fully to the side with the rail on the left.** Two causes: the rail's resize grab strip was positioned -3 and protruded into the workspace, so it owned the pixels beside a left-hand rail and grabbing a window there resized the rail; and horizontal clamping was asymmetric — a window could hang off the RIGHT edge but was hard-stopped at x=0, so it could never be pushed left the way it could be pushed right. Strip is now fully inside the rail; clampRect + the drag clamp are symmetric, keeping 80px grabbable either side. Top stays a hard stop — the title bar is the only drag handle. (2) **Campaign overview is a full PAGE again**, not a panel: 'overview' left the tab catalog, CampaignPage holds a view state ('overview' | 'workspace'), dashboard entry lands on it at full width, and the header button toggles (shows '← Workspace' while on it). The openRequest/nonce plumbing added in 5.2.1i is gone with it. (3) **Settings opens near-full-screen and cannot be covered** — a bounds-derived rect (~90% of the area) instead of 460×420, plus a fixed z-index above every other window; it is modal-ish and a dense admin stack is unreadable small. Its rail entry became a plain open/close toggle since 'raise' is meaningless for an always-on-top panel, and focusPanel exempts it so the frontmost test can't lie. (4) **Window titles centred**, with a spacer mirroring the button cluster so it is the true centre. The harness CAUGHT (1): two assertions encoding the old hard stop failed and were rewritten to the new intent, +3 added for symmetric hang-off and the top-edge stop — qa:checks 40 → 44. typecheck + build clean, 663.93 → 664.18 kB)*
  - [x] 5.2.2c — Web UI: profile sections, overview entry, schedule history, modal Settings *(seven items from the 5.2.2 re-run. (1) **BUG FIX — a page refresh reopened Overview.** `history.state` survives a reload, so the dashboard's `openOverview` flag stayed set and every refresh bounced back to the overview page; the flag is now consumed once via a replace-navigation on the entry that carried it. (2) **Entry button under the roster** on the Overview page — "Enter the playspace →" in playspace/rpg, "Open the campaign workspace →" in notetaker, with a line naming what is through it; the header toggle alone was too quiet for a landing page's primary action. (3) **Past sessions collapse into a `<details>`** with a count on the summary, closed by default — history stays available without pushing the next session (the only actionable one) off screen. Undated proposals count as UPCOMING: they await a date, they are not history. (4) **Settings is fixed** — no drag, and the eight resize handles are omitted entirely rather than left as dead cursor hints; a window that cannot be put behind anything gains nothing from being movable. (5) **Settings dims the workspace behind it** (scrim at z 8999, panel at 9000). Click-through-to-dismiss deliberately NOT wired: Settings holds the danger zone, and a stray edge-click closing it mid-edit is worse than a trip to the ✕. (6) **Rail side moved out of campaign Settings into Profile → Workspace** as an account-wide, browser-local preference (profile/preferences.ts), read ONCE per workspace mount. Two reasons, only one of which was the reported bug: it is a handedness preference that should follow the user across campaigns, and applying it on load stops it relayouting underneath windows the user has already dragged. `railSide` left CampaignLayout. (7) **Edge snapping** (layout.snapToEdges, 14px, applied on release only so it never fights the pointer) — the reported "not locked to the border". Note the honest split on (6)/(7): moving the setting SIDESTEPS a class of bug, snapping FIXES the complaint; neither alone was enough. **LAYOUT_VERSION deliberately NOT bumped** for railSide's removal — the field is simply ignored and nothing else changes meaning, so binning every user's arrangement over a dead key would be pure loss; the exception is documented next to the constant and pinned by an assertion. The harness caught the schema change twice: tsconfig.qa.json failed the typecheck the moment railSide left the type, and the old-clamp assertions failed before being rewritten. qa:checks 44 → **53**. typecheck + build clean, 664.93 → 667.23 kB)*
  - [x] 5.2.2g — Web UI: per-session history disclosures *(each past session is now its own collapsed `<details>`, nested inside the existing "Past sessions (n)" one: a summary line of title + formatted date, expanding to the full card. A flat list of full cards became a wall to scroll once a campaign has a dozen sessions behind it, and the thing you are looking for is a specific DATE — so that is what the summary leads with. Also reversed the history order to **newest first**, deliberately opposite to `upcoming` (soonest first): for things still to come you want the next one at the top, for history you want the most recent, and nobody scrolls to the bottom looking for last week. Untitled sessions fall back to "Untitled session" in the summary rather than rendering a blank clickable line. typecheck + build clean, 668.80 → 669.6 kB)*
  - [x] 5.2.2f — Web UI: typable date field, locked past times *(two follow-ups from the 2026-08-21 run. (1) **Removed `min` from the composer's datetime input** — added one subphase earlier to make the picker refuse past dates, it turned out to make the field hostile to TYPING: entering a date digit by digit yields intermediate values below the minimum, which browsers mark invalid and can clear mid-keystroke. The submit-time guard in handleAdd was always the real enforcement; `min` only styled the picker, so dropping it costs nothing and restores keyboard entry. Worth remembering as a pattern: an HTML validation attribute that constrains a *partial* value fights incremental input. (2) **A past session's time is locked** — input disabled with a tooltip explaining why, its quick-fill button hidden; title, notes and RSVPs stay editable, notes especially since that is how a DM records what actually happened. Rescheduling something that already occurred is always a mistake and would silently move the card out of the history list. Note this narrows 5.2.2e's deliberate allowance — editing an existing session to a past date is still how you get a card INTO history, but once it is there its time is fixed. typecheck + build clean, 668.60 → 668.7 kB)*
  - [x] 5.2.2e — Web UI: view persistence + no past-dated proposals *(two follow-ups from the 2026-08-20 QA run. (1) **REGRESSION FIX — refreshing on the overview page landed you in the workspace.** 5.2.2c stopped `history.state` bouncing every refresh *to* Overview by consuming the router state, but nothing then remembered which view you were on, so a reload fell through to the workspace default. Having now seen this bug in BOTH directions, the view gets its own persisted state instead of being inferred: stored per campaign in localStorage (`campaign:<id>:view`), with arrival from the dashboard still forcing Overview, and a campaign switch restoring that campaign's last view. Lesson worth keeping: a value the user can change AND that an entry path can force needs storing, not deriving. (2) **Sessions can no longer be proposed in the past** — `min={now}` on the composer's datetime input so the browser's own picker refuses, plus a guard in handleAdd because `min` is a hint a user can type past. Editing an EXISTING session to a past date stays allowed: that is how a DM corrects a date or records when a session actually happened. Relabelled the "Today" shortcut to "Now", which is what it always did. **Caught immediately after, in the same session:** the guard compared against the exact moment while the input (and the Now button) truncate to the minute, so clicking Now then Propose rejected the app's own shortcut — the cutoff is now the START OF THE CURRENT MINUTE, matching the input's precision. typecheck + build clean, 668.11 → 668.60 kB; qa:checks 53/53)*
  - [x] 5.2.2d — Web UI: profile restructured into three sections *(Account / Workspace / Legal, per the user. Structure only — none of the missing features were built, and each gap is NAMED on the page rather than hidden: changing email, changing password from here, and account deletion under Account; the theme setting under Workspace; ToS/Privacy and acceptance date under Legal. Also corrected a stale claim — the page said avatar upload "arrives with the media pipeline (phase 1.6)", which shipped long ago; `profiles.avatar_url` exists and the avatar already renders, only the upload path is missing. Everything named here is tracked: new subphase **7.3 — Profile & account management** for the account items, Phase 7.2 for legal, Phase 14 for theme)*
  - [x] 5.2.2a — Web UI: panels keep their state *(**closing a panel no longer unmounts it.** Every panel opened since arriving at the campaign stays in the React tree, hidden with display:none; layout.floating remains the source of truth for what is VISIBLE. Reopening is therefore instant and lossless — loaded rows, scroll position, half-typed notes, expanded sections all survive — where before every reopen refetched and flashed a loading state, which made the rail feel like it reloaded the app. Reopen also restores the panel's LAST position (a rememberedRects ref) instead of dumping it at the default cascade. **The cost, stated rather than hidden:** a hidden panel's queries and realtime channels stay live (5 panels use realtime, 18 fetch on mount) and its memory is retained for as long as you stay in the campaign. Right trade at ~20 panels, not free. Two guards keep it bounded: the mounted set resets on campaign change, and a panel whose tab the role can no longer see is UNMOUNTED rather than hidden, so a demotion actually stops its queries. display:none also removes hidden panels from the a11y tree and tab order, so they aren't keyboard-reachable. typecheck + build clean, 664.18 → 664.93 kB; qa:checks 44/44)*
  - [x] 5.2.2 — QA *(**COMPLETE/PASS 2026-08-22.** Six browser rounds between 2026-08-07 and 2026-08-22, each of which CHANGED the feature rather than merely certifying it — the shell was redesigned three times across them (branch-by-mode → one shell → click-to-open with no docked panel), so most rounds ended in follow-up subphases rather than a tick. The final round produced no follow-ups, which is what closed it. Automated half: `npm run build` clean and `npm run qa:checks` **53/53** (grown from 30 as the harness absorbed each behavioural change — it caught the symmetric-clamp change and the railSide type removal before a human could). Browser half: workspace-shell.md PASS, layout-persistence.md PASS with step 1 recorded **N/A** (it needed a pre-versioning saved layout that no longer exists; the behaviour is asserted in qa:checks instead — recorded N/A rather than PASS since nobody observed it). Unusually for this project there was NO server-side checklist: 5.2 added zero data access, so the existing RLS matrix still governs. Every round's result is preserved in the run logs, with superseded ones labelled rather than deleted.)*

### Phase 6: Self-hosted backend migration (hosted Supabase → Railway)
> **Sequencing:** first of the unbuilt phases. Renumbered 13 → 6 on 2026-08-14;
> migrating the backend is cheaper the smaller the surface, so it runs before the
> playspace and combat phases add tables to move — see the phase Goal.
- [x] 6.1 — Local stack pre-flight
  - [x] 6.1.1 — Infrastructure
  - [x] 6.1.2 — QA — PASS 2026-08-18, [QA/6_tests/local-preflight.md](QA/6_tests/local-preflight.md)
- [x] 6.2 — Data migration
  - [x] 6.2.1 — Infrastructure
  - [x] 6.2.2 — QA — PASS 2026-08-18, [QA/6_tests/data-migration.md](QA/6_tests/data-migration.md)
- [ ] 6.3 — Railway deploy & gateway
  - [ ] 6.3.1 — Infrastructure
  - [ ] 6.3.2 — QA
- [ ] 6.4 — Stripe re-wiring
  - [ ] 6.4.1 — Infrastructure
  - [ ] 6.4.2 — QA
- [ ] 6.5 — Cutover, backups & decommission
  - [ ] 6.5.1 — Infrastructure
  - [ ] 6.5.2 — QA

### Phase 7: Accounts, roles & compliance
- [ ] 7.1 — Account deletion, data rights & cascade
  - [ ] 7.1.1 — Backend
  - [ ] 7.1.2 — Web UI
  - [ ] 7.1.3 — QA
- [ ] 7.2 — Legal & policy pages (ToS, Privacy, refunds)
  - [ ] 7.2.1 — Backend
  - [ ] 7.2.2 — Web UI
  - [ ] 7.2.3 — QA
- [ ] 7.3 — Profile & account management
  - [ ] 7.3.1 — Web UI
  - [ ] 7.3.2 — QA
- [ ] 7.4 — Usernames (unique, required)
  - [ ] 7.4.1 — Backend
  - [ ] 7.4.2 — Web UI
  - [ ] 7.4.3 — QA

### Phase 8: Automated testing & CI
- [ ] 8.1 — Test infrastructure + unit/component tests (Vitest + RTL)
- [ ] 8.2 — RLS / database policy tests
- [ ] 8.3 — End-to-end smoke tests (Playwright) + CI pipeline

### Phase 9: Playspace mode (grid battlemap + dynamic vision & lighting)
- [ ] 9.1 — Battlemap & tokens
  - [ ] 9.1.1 — Backend
  - [ ] 9.1.2 — Web UI
  - [ ] 9.1.3 — QA
- [ ] 9.2 — Vision toggle & obstructions (walls + freehand)
  - [ ] 9.2.1 — Backend
  - [ ] 9.2.2 — Web UI
  - [ ] 9.2.3 — QA
- [ ] 9.3 — Token-based line of sight & sight range
  - [ ] 9.3.1 — Backend
  - [ ] 9.3.2 — Web UI
  - [ ] 9.3.3 — QA
- [ ] 9.4 — Light levels & darkness
  - [ ] 9.4.1 — Backend
  - [ ] 9.4.2 — Web UI
  - [ ] 9.4.3 — QA

### Phase 10: Full RPG mode (round-based combat)
- [ ] 10.1 — Side-based round combat engine
  - [ ] 10.1.1 — Backend
  - [ ] 10.1.2 — Web UI
  - [ ] 10.1.3 — QA
- [ ] 10.2 — Combat ↔ playspace integration
  - [ ] 10.2.1 — Backend
  - [ ] 10.2.2 — Web UI
  - [ ] 10.2.3 — QA

### Phase 11: Transactional email & notifications
- [ ] 11.1 — Backend (email provider + send functions)
  - [ ] 11.1.1 — Backend
  - [ ] 11.1.2 — QA
- [ ] 11.2 — In-app wiring (invite-by-email, notification prefs/opt-out)
  - [ ] 11.2.1 — Web UI
  - [ ] 11.2.2 — QA

### Phase 12: Content moderation & safety
- [ ] 12.1 — Moderation pipeline + report→review→takedown
  - [ ] 12.1.1 — Backend
  - [ ] 12.1.2 — Web UI
  - [ ] 12.1.3 — QA

### Phase 13: Launch hardening
- [ ] 13.1 — Rate limiting & abuse prevention
  - [ ] 13.1.1 — Backend
  - [ ] 13.1.2 — QA
- [ ] 13.2 — Analytics & observability
  - [ ] 13.2.1 — Backend
  - [ ] 13.2.2 — Web UI
  - [ ] 13.2.3 — QA
- [ ] 13.3 — Deployment, backups & monitoring
  - [ ] 13.3.1 — Backend
  - [ ] 13.3.2 — QA

### Phase 14: Responsive/mobile, theming & accessibility
> **Sequencing:** the **last phase before launch**. Promoted out of the
> post-launch backlog (it was PL.1) on 2026-08-13 — players use the app at the
> table on phones, so shipping a table tool that only works on a desktop is the
> first thing they would complain about. Left at the end because it is a pass
> over finished screens: doing it before Phases 9–10 would mean re-doing it.
- [ ] 14.1 — Responsive/mobile, theming & accessibility
  - [ ] 14.1.1 — Web UI
  - [ ] 14.1.2 — QA

### Post-launch backlog (after public launch)
> PL.1 was promoted to Phase 14, so the numbering starts at PL.2 — the gap is
> deliberate, not a missing item.
- [ ] PL.2 — Onboarding, empty states & sample content
- [ ] PL.3 — Shared dice roller (table-wide, realtime)
- [ ] PL.4 — Performance & code-splitting
- [ ] PL.5 — Server-authoritative playspace vision (anti-peek)

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
- A non-owner (i.e. any player) cannot open Checkout or read the
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

## Phase 5: Game mode foundation & selection
**Goal:** Give the DM a choice of how their campaign plays. Every campaign gets a
**game mode** — `notetaker` (exactly what exists today), `playspace`, or `rpg` —
that the DM can switch **at any time**. The app shell adapts to the selected mode;
`notetaker` keeps its current tab bar untouched. This phase ships only the
foundation and the mode-aware chrome; the playspace itself (Phase 9) and
round-based combat (Phase 10) fill it in. The three modes are cumulative tiers:
`playspace` = notetaker + a shared map; `rpg` = playspace + round-based combat.

### Subphase 5.1: Mode data model & switching

#### 5.1.1 — Backend
- Migration: add `campaigns.game_mode` as an enum
  (`'notetaker' | 'playspace' | 'rpg'`), `not null default 'notetaker'` so every
  existing campaign is unaffected. Switching mode is a plain campaign update, so it
  reuses the existing `campaigns_update_dm` RLS policy (DM-only; a player's update
  matches zero rows).
- **Switch-down is non-destructive.** Because a DM can move freely between modes,
  moving to a *simpler* mode must never delete higher-mode data. Playspace rows
  (maps/tokens/walls/lights — Phase 9) and combat rows (Phase 10) are simply not
  read/rendered while the campaign is in a lower mode; switching back restores them
  intact. No cascade delete is wired to `game_mode`; document this invariant next
  to the column.
- Expose `game_mode` through the existing `getCampaign` / `listMyCampaigns` reads
  (no new endpoint needed).

#### 5.1.2 — Web UI
- **Create-campaign flow:** a mode picker (segmented control) with a one-line
  description of each mode; defaults to `notetaker`.
- **Overview tab (DM only):** a "Game mode" control to switch anytime, with a
  confirm step that explains switching *down* only hides the richer features (data
  is kept) and switching *up* unlocks the map/combat. Reuses the `renameCampaign`
  pattern (`onModeChanged` callback updates the shell immediately).

#### 5.1.3 — QA
- Mode persists across refresh; DM-only switch (player switch blocked by RLS —
  verify server-side); switching up→down→up leaves playspace/combat data intact;
  a `notetaker` campaign is visually identical to today.

### Subphase 5.2: Mode-aware app shell (sidebar + pop-out)

#### 5.2.1 — Web UI
*(As built. The original spec branched the chrome by mode and kept the top tab bar
for `notetaker`; that was dropped in 5.2.1b — see the tracker entry.)*
- **One chrome for every mode.** The top tab bar is gone. `CampaignPage` renders
  `WorkspaceShell` full-bleed (100dvh): a **collapsible, side-switchable tab rail**
  (right by default) and every open panel as a **draggable/resizable floating
  window** beside it, so several panels can be open at once in every mode.
- **Clicking a rail entry opens its panel directly** as a window; the entry then
  toggles raise → close. There is no docked panel and no separate pop-out step.
- `game_mode` decides only what fills the area behind the windows:
  - `notetaker` → nothing (a hint when the board is empty).
  - `playspace` / `rpg` → the playspace (an empty placeholder until Phase 9).
- The campaign name sits in the app header's centre slot; there is no campaign
  title bar and no in-workspace campaign switcher (switch via the dashboard).
- **Campaign overview** is not in the rail at all — it is a button in the app
  header beside the home link, and also opens automatically when you enter the
  campaign from the dashboard. It holds the roster, invite codes and **session
  scheduling** (which is therefore not a tab either).
- The rail's footer is pinned to the bottom: **Close tabs** (red, always present,
  disabled when nothing is open), then **Settings** below a divider.
- **Settings is visible to players too** — everyone gets a Workspace section
  (sidebar side, reset layout); campaign administration stays DM-only.
- Floating windows are **in-page**, not `window.open` (the other option the spec
  allowed): no popup blockers, no second document to style, nothing orphaned by a
  refresh. They drag by the title bar and resize from any edge or corner.
- Panel open/pop-out layout persists per user per campaign (localStorage), like
  the per-campaign active-tab persistence already in place.
- Plan & billing stopped being a tab and became a **Settings section**.
- A **Close tabs** rail button closes every open panel at once, for either role.
- The rail is **resizable** by dragging its workspace-facing edge (double-click to
  reset), and its width persists with the rest of the layout.

#### 5.2.2 — QA
- Every mode shows the rail with working collapse, dock and pop-out/pop-in;
  `playspace`/`rpg` reserve the middle for the map; the workspace fills the window;
  floating windows resize from every edge; role-based tab gating is unchanged
  across all modes and can't be bypassed by a saved layout; layout persists across
  refresh.

---

## Phase 6: Self-hosted backend migration (hosted Supabase → Railway)
**Goal:** Move the backend off hosted Supabase onto a self-hosted stack on the
already-paid-for Railway plan, eliminating the $25+/mo bill **without discarding
the 100 RLS policies** that are this app's real access-control layer. Full spec:
[railway/README.md](railway/README.md); step-by-step runbook with gates:
[docs/RAILWAY_MIGRATION.md](docs/RAILWAY_MIGRATION.md).

**Why now.** Renumbered to 6 on 2026-08-14 so the number matches the order.
It should run **before Phase 9**: Phase 9 (playspace) leans hard on the Realtime
service, and building it against hosted Supabase means QA'ing it twice. Phase 4.4
Realtime is already built and passing (2026-07-29), which helps — its run log is a
known-good baseline to regression-test the migrated Realtime service against. Also
the hosted project is on the **free** plan now, which pauses after 7 days idle.

**Approach — "Option A" (keep PostgREST + GoTrue).** The rejected alternative was
bare Postgres plus a hand-written API: that would have meant rewriting 45 query
call sites and reimplementing 100 policies in TypeScript — 3–5 weeks and a
security regression for a multi-tenant DM/player app. This path is ~1 week.

**Scope note — the frontend does not change.** All 45 `.from()` sites, 9 auth
calls, 8 `functions.invoke` calls, 2 realtime channels, 1 storage call, 27
migrations, and all 7 Edge Functions carry over unmodified; only two `.env` values
change. This holds because [src/lib/supabase.ts](src/lib/supabase.ts) builds one
client and [src/lib/env.ts](src/lib/env.ts) centralises both vars. **The cost of
this phase is infrastructure + re-verification, not code.**

### Subphase 6.1: Local stack pre-flight
#### 6.1.1 — Infrastructure
- Generate the three cryptographically-linked secrets (`JWT_SECRET` + the two
  derived JWT keys) via `railway/scripts/gen-keys.mjs`; fill `railway/.env.stack`.
- Bring up the 7-service stack locally (`railway/docker-compose.yml`); confirm
  `railway/init/00_roles_and_auth_helpers.sql` ran before any app migration.
- Replay all 27 migrations in order against the local Postgres.
- Grant table privileges (`railway/scripts/90_grant_app_privileges.sql`) and
  reload the PostgREST schema cache. **Neither is optional** — see 6.1.2.
#### 6.1.2 — QA
- All 27 migrations apply with zero errors (0008 is the one to watch — it needs
  the `storage` schema for its `storage.objects` policy).
- `auth.uid()` resolves from `request.jwt.claims` — the linchpin for all 100
  policies. If it returns NULL, stop; nothing downstream is trustworthy.
- Gateway routing returns no 404s on `/rest/v1`, `/auth/v1`, `/storage/v1`,
  `/functions/v1` (catches `handle` vs `handle_path` prefix-strip mistakes).
- `npm run build` clean with `VITE_SUPABASE_URL` pointed at the local gateway —
  and grep the bundle to confirm it really used that URL.
- End-to-end through the gateway: GoTrue signup → JWT → PostgREST → RLS, with
  both the allowed and the denied path asserted.

**Done 2026-08-18 — PASS, all gates.** Full log:
[QA/6_tests/local-preflight.md](QA/6_tests/local-preflight.md). The scaffolding
had never been run and five defects surfaced; two matter beyond this subphase:

- **No table GRANTs.** None of the 27 migrations grants table privileges —
  hosted Supabase supplies them as project defaults. Self-hosted, the stack
  boots green with all 100 policies in place and then fails *every* query with
  `permission denied`, signed-in users included, because privileges are checked
  before RLS. Fixed by `railway/scripts/90_grant_app_privileges.sql` plus
  `alter default privileges` in `railway/init/01_stack_login_roles.sh`.
- **`supabase/postgres:15.8.1.060` has no `postgres` role** (its superuser is
  `supabase_admin`) and leaves `authenticator` password-less, so four services
  crashlooped. Fixed in `railway/init/01_stack_login_roles.sh`.

Also corrected here: realtime was creating its un-policied internal tables in
`public`, where the new grants would have exposed `tenants` (which holds a
tenant JWT secret) to `anon`; it is now confined to a `_realtime` schema.

### Subphase 6.2: Data migration
#### 6.2.1 — Infrastructure
- Dump `public` + `storage` data only (`--no-owner --no-privileges`); schema comes
  from replaying migrations so the migration files stay the source of truth.
- Migrate `auth.users` column-by-column, **preserving UUIDs exactly** — GoTrue
  owns that table and its schema varies by version, so no bulk copy.
- Re-upload the 106 media objects **through the Storage API**, not onto the volume
  directly, so `storage.objects` rows are written.
#### 6.2.2 — QA
- Per-table row counts match the source; 5 users present with original UUIDs.
- Object count is 106 and `private.campaign_storage_used()` matches the
  pre-migration value per campaign.
- Existing bcrypt passwords still authenticate.

**Done 2026-08-18 — PASS.** Log:
[QA/6_tests/data-migration.md](QA/6_tests/data-migration.md). 262 rows across 29
tables, 5 users with UUIDs and bcrypt hashes identical, 106 objects matching
byte-for-byte (3,044,130 bytes). Actual sign-in with a real password is the one
gate left manual; deferred to 6.3.

**The finding that justifies the whole subphase: the hosted database had
drifted from the migration files.** `0023_initiative_hp_npc` was applied to the
project on 2026-07-20 but its .sql was never committed, so the repo jumps 0022 →
0024 and a build from the files alone lacks `initiative_entries.hp` / `.max_hp`
/ `.npc_id` — columns `CombatPanel.tsx` uses at eight sites. A Railway deploy
would have shipped without the per-combatant HP tracker. Recovered from the live
schema as `supabase/migrations/0023_initiative_hp_npc.sql`; schemas now match at
231 columns. **Nothing before this phase could have caught it** — no environment
had ever been built from the migration files alone.

Also fixed: `storage` schema had no role grants (uploads failed with a
misleading "violates row-level security policy" that was really 42501 on
`storage.buckets`); `auth.users.confirmed_at` is generated and cannot be
COPY'd; `handle_new_user` collided with restored `profiles` rows; and newer
`sb_secret_…` keys are rejected in `Authorization: Bearer`, requiring `apikey`.

### Subphase 6.3: Railway deploy & gateway
#### 6.3.1 — Infrastructure
- Create the 7 services with pinned image tags; secrets as **shared variables**.
- **Public domain on `gateway` only**; all other services stay private.
- Attach volumes to `postgres` and `storage` — **without these a redeploy wipes
  the database.**
- Set `MAILER_AUTOCONFIRM=false` + real SMTP (autoconfirm on in production lets
  anyone register as any address).
#### 6.3.2 — QA
- Repeat the 6.1.2 gates against the Railway domain.
- Healthchecks green on `gateway` and `functions`; a redeploy preserves data.

### Subphase 6.4: Stripe re-wiring
#### 6.4.1 — Infrastructure
- Register the webhook at `https://<gateway>/functions/v1/stripe-webhook`; set the
  **new** signing secret (the old one will not verify).
- Confirm the raw body reaches the function unmodified — the Caddyfile adds no
  body-rewriting directives for exactly this reason.
#### 6.4.2 — QA
- Test-mode: checkout → trial start → webhook received → `campaign_subscriptions`
  row written. Then the reused-card path cancels without charging.

### Subphase 6.5: Cutover, backups & decommission
#### 6.5.1 — Infrastructure
- **Set up `pg_dump` backups on a Railway cron before cutover** — self-hosting
  loses Supabase's automatic daily backups.
- Flip production `.env` to the gateway domain; deploy.
- Only after QA is green: decommission the hosted project. (Also delete the unused
  `Art-Randomizer` project — the second compute instance was the original source
  of the >$25 overage.)
#### 6.5.2 — QA
- Full four-role matrix — DM / player / non-member / signed-out — re-verified
  server-side. **Gates: exactly 100 policies, and zero tables in `public` with
  RLS disabled.** (The "30 tables with `rowsecurity = true`" written here
  originally was an estimate; measured against a real stack on 2026-08-18 it is
  **34** — 29 in `public` plus 5 storage-api tables. The zero-disabled check is
  the one that actually matters.)
- A table restoring with RLS *disabled* is the highest-risk failure mode of this
  phase: it fails **open** and nothing visibly breaks. Assert it explicitly.
- `get_advisors` has no self-hosted equivalent; the `pg_policies` +
  `rowsecurity` audit replaces it — record that substitution in the run log.
- Confirm actual Railway usage after a few days. 7 containers cost more than a
  bare Postgres; if it lands near $25 the cheaper answer was staying on hosted Pro
  with `Art-Randomizer` deleted.
- Rollback remains available (revert two `.env` values) until the hosted project
  is deleted — **cancel nothing until this subphase passes.**

---

## Phase 7: Accounts, roles & compliance
**Goal:** The legal and account-lifecycle obligations that come with storing
personal data and taking payments — user-initiated account deletion with correct
data cascade, and the required policy pages.

### Subphase 7.1: Account deletion, data rights & cascade

#### 7.1.1 — Backend
- "Delete my account" path (GDPR/CCPA right to erasure), distinct from campaign
  deletion. Define and implement the **cascade rules**:
  - Campaigns the user **DMs**: the campaign and its content are deleted (all
    members lose access — there is no ownership-transfer path); any active Stripe
    subscription is cancelled.
  - Campaigns where the user is a **player**: their character/sheet/inventory/
    journal are removed; the campaign and other players are unaffected.
- A grace/confirmation step (and email confirmation) before irreversible
  deletion; remove Storage objects, not just rows.
- Data-access/portability request handling reuses the export functions (4.2).

#### 7.1.2 — Web UI
- Account settings: delete account (with clear warnings about what's removed and
  a prompt to export first), and links to export tools.

#### 7.1.3 — QA
- Deleting an account removes the right data in every role and cancels its
  subscriptions; other users' campaigns are untouched; Storage objects are gone.

### Subphase 7.2: Legal & policy pages (ToS, Privacy, refunds)

#### 7.2.1 — Backend
- Store acceptance (versioned ToS/Privacy acceptance timestamp on the profile);
  re-prompt on material updates.

#### 7.2.2 — Web UI
- The **Legal** section of the Profile page is the home for policy links and the
  recorded acceptance date; it exists and says the documents are missing.
- **Terms of Service**, **Privacy Policy** (what's stored, Stripe as processor,
  retention, deletion rights), and a **refund/cancellation policy** page; signup
  consent checkbox; footer links.

#### 7.2.3 — QA
- Signup records policy acceptance; pages are reachable; refund policy matches the
  actual billing behavior (read-only on lapse, 3-month deletion).

---

### Subphase 7.3: Profile & account management

**Why this exists:** the profile screen was restructured into **Account /
Workspace / Legal** in 5.2.2c, and that surfaced how much of "Account" is not
actually built. These are small, individually cheap items that are easy to keep
postponing and awkward to be missing at launch. The page currently *states* each
gap rather than hiding it, so the UI and this list agree.

#### 7.3.1 — Web UI
- **Change password from Profile.** The flows already exist
  (`RequestPasswordResetPage`, `UpdatePasswordPage`) — nothing links to them from
  the profile, which is the first place anyone looks.
- **Change email.** Currently read-only. `auth.updateUser({ email })` with its
  confirmation round-trip; otherwise "my email is wrong" becomes a support ticket
  nobody can resolve.
- **Avatar upload.** Unblocked since the 1.6 media pipeline shipped —
  `profiles.avatar_url` exists and the page already renders an avatar if one is
  set; only the upload path is missing. Reuse `upload-media` (validation, EXIF
  strip, re-encode) rather than adding a second image path.
- **Global "reset all workspace layouts."** Per-campaign reset already exists in
  campaign Settings; this is the escape hatch for when something is wrong across
  every campaign at once.
- Keep the three-section structure. In particular, **notification preferences
  belong in Workspace when Phase 11 lands** — per-campaign email settings would
  be wrong, since nobody wants different notification rules per campaign.

#### 7.3.2 — QA
- Password change reachable from Profile and actually changes the password;
  email change requires confirmation and does not lock the user out; avatar
  upload goes through the same validation as campaign media; reset-all-layouts
  clears every campaign's arrangement and nothing else.

---

### Subphase 7.4: Usernames (unique, required)

**Decision (owner, 2026-08-17):** replace the optional, free-form
`profiles.display_name` with a **required, globally unique `username`**.

Recorded honestly, because the trade-off is real and should not be rediscovered
later as a surprise. The case *against* is that a username is not an identifier
anywhere in this app today — you join by invite code, there is no user search, no
@mentions, no cross-campaign directory — so global uniqueness charges every user
signup friction to solve a problem that only exists inside a campaign of ~5
people. The case *for*, which is the owner's call: a stable unique handle is
worth having before there are real users, it makes any future
search/mention/transfer feature possible without a migration, and it removes the
ambiguity of two identical names in one roster.

**The win to keep sight of:** today `display_name` is nullable and often NULL, so
[OverviewPanel](../src/features/campaigns/OverviewPanel.tsx) renders *every*
nameless member as "Unnamed adventurer". That — not two Alexes — is the collision
users will actually hit, and requiring a username removes it outright.

**Do this before launch.** Retrofitting a unique-and-required column onto real
accounts means forcing a rename on strangers. Cheap now, rude later.

#### 7.4.1 — Backend
- Migration: rename `profiles.display_name` → `username`; add a
  **case-insensitive** unique index (`unique (lower(username))`, or `citext`) —
  a plain unique index would let `alex` and `Alex` coexist and achieve nothing.
- Add a `CHECK` for length and charset before writing the UI, so the rule lives
  in one place. Decide: allowed characters, min/max length, reserved names
  (`admin`, `support`, …).
- **Backfill first, constrain second.** `NOT NULL` and `UNIQUE` cannot be applied
  while existing rows are NULL or duplicated. Generate provisional usernames
  (email local-part + numeric suffix on collision), then constrain, then prompt
  affected users to choose a real one at next sign-in.
- Update the `handle_new_user` trigger (0002), which currently seeds
  `display_name` from signup metadata and leaves it NULL when absent.
- **Availability checking must NOT be a select.** `profiles` is readable only by
  yourself and co-members (`profiles_select_own` 0002, `profiles_select_comembers`
  0004), so a client genuinely cannot see whether a username exists — which is a
  privacy property worth keeping. Check by attempting the write and handling the
  unique violation (SQLSTATE **23505**) as a friendly field error. Do **not** add
  a `SECURITY DEFINER` `username_available()` RPC: it would work, but it creates
  exactly the account-enumeration surface the current policies avoid.

#### 7.4.2 — Web UI
- Signup requires a username, with the 23505 path surfaced as "that username is
  taken" on the field rather than a thrown error.
- Profile → **Account** renames the field and allows changing it, same conflict
  handling. (Changing a username is a rename, so decide whether history/mentions
  need to follow it — trivial today, less so once anything references handles.)
- Update every render site: the roster in `OverviewPanel`, `PartyPanel`, RSVP
  lists in `SchedulePanel`, and the two name maps in `campaigns/api.ts` and
  `schedule/api.ts`. The "Unnamed adventurer" fallback can then be deleted.
- **The campaign overview roster shows BOTH: username and character name** —
  "alexc (Thorin)". Confirmed by the owner 2026-08-17, not a maybe. It reads
  better than either alone at the table, where people are known by both, and it
  is the one place where the whole party is listed together.
- **This needs an access-control decision first, so do not treat it as a UI
  task.** `private.can_read_character` is *owner OR campaign DM*
  ([0010_characters_sheet.sql](../supabase/migrations/0010_characters_sheet.sql)),
  so today a player cannot read any part of another player's character row —
  including the name. Options, cheapest first:
  1. Show the pairing only where it is already permitted: the DM sees it for
     everyone, each player sees it on their own row. No RLS change, but the
     roster reads inconsistently for players, which is probably not what was
     asked for.
  2. Widen reads to **`characters.name` only**, for campaign members — a
     member-readable view (or an RPC returning `user_id, name`) rather than
     loosening `can_read_character` itself. Keeps sheets, inventory, journals and
     lore exactly as private as they are now.
  3. Widen `can_read_character` to any campaign member. **Do not do this**
     casually: that predicate gates the sheet fields, inventory and lore
     policies too (0010/0012), so it would expose far more than a name.
  Option 2 is the intended path; whichever is chosen, the QA must assert that a
  player still cannot read another player's sheet, inventory, journal or lore.

#### 7.4.3 — QA
- Uniqueness is enforced **server-side** and **case-insensitively**: an insert or
  update colliding on a different case fails (verify via the MCP, not the UI).
- A duplicate produces a friendly field error, never an unhandled throw.
- Backfilled accounts are prompted to choose a username and cannot skip
  indefinitely.
- Roster, Party and RSVP lists all show usernames; no "Unnamed adventurer"
  remains anywhere.
- **No new enumeration surface**: confirm there is still no endpoint that reveals
  whether an arbitrary username exists to a non-co-member.

---

## Phase 8: Automated testing & CI
**Goal:** Replace "manual QA + typecheck only" with a real regression safety net,
so future changes can't silently break existing behavior — especially the RLS
security model, which has repeatedly had subtle edge cases. Runs continuously in
CI. (Existing per-phase manual checklists in `QA/` stay as the human-verification
layer; this adds the automated layer beneath them.)

### Subphase 8.1: Test infrastructure + unit/component tests
- Stand up **Vitest + React Testing Library** (jsdom); wire `npm test` and a
  coverage report. Add unit tests for pure logic that's easy to regress:
  dice-notation parsing, HP damage/heal (temp-first, cap-at-max), death-save
  clamps, initiative sort, `extractNpcHp`, safe-markdown escaping, id-remap in
  import, the realtime `mergeById` helper. Component tests for a couple of
  high-traffic panels (autosave indicator, a sheet section editor).
- QA: `npm test` runs green locally; coverage report generated.

### Subphase 8.2: RLS / database policy tests
- A **pgTAP (or SQL) harness** that seeds a DM + player + non-member + anon and
  asserts every table's read/write matrix — the checks we've been running by hand
  each phase (owner-only writes, DM read scope, member-vs-non-member, journal
  privacy, DM-only workspace, shared-items asymmetry, per-user rsvp). This makes
  the security model a **regression test**, not a one-time manual pass.
- QA: the suite fails loudly if any policy is loosened/removed.

### Subphase 8.3: End-to-end smoke tests (Playwright) + CI pipeline
- A few **Playwright** flows against a test project: sign up → create campaign →
  start trial → invite/join → fill a sheet → DM views party → DM shares a handout
  → player sees it. Plus an export→import round-trip.
- Wire **CI** (GitHub Actions or similar): typecheck + build + unit + RLS + e2e on
  every push; block merge on failure.
- QA: CI is green on main; a deliberately broken policy/logic change is caught.

## Phase 9: Playspace mode (grid battlemap + dynamic vision & lighting)
**Goal:** In `playspace` and `rpg` campaigns, a shared grid battlemap where the DM
sets a map and each player drags **their own** character token in real time, with
**optional** obstruction-aware dynamic vision: sight is computed from each
character's token position (not a whole-map reveal), limited by a sight range and
by lighting. Vision is computed **client-side** for the MVP — smooth and instant
on token movement, appropriate for a friendly home game; a determined player could
inspect client data to peek, so a **server-authoritative** version is tracked as a
post-launch hardening item (PL.5). Builds directly on Phase 4.4 Realtime.

### Subphase 9.1: Battlemap & tokens

#### 9.1.1 — Backend
- Migration: `playspace_maps` (campaign_id, `background_asset_id` → media_assets
  via the existing 1.6 pipeline, grid size in px, width/height, `active` flag,
  `vision_enabled` boolean default false) and `playspace_tokens` (map_id,
  owner_user_id and/or character_id, npc_id nullable, x, y, size, color, label).
- RLS: members read maps/tokens; the DM manages maps and **all** tokens; a player
  may insert/move/delete **only their own** token (predicate on
  `owner_user_id = auth.uid()` within a campaign they belong to). Add both tables
  to the `supabase_realtime` publication + `REPLICA IDENTITY FULL`.

#### 9.1.2 — Web UI
- Grid canvas that renders the map image and a square-grid overlay; tokens are
  drag-positioned with grid snapping. Token position changes sync live via
  `useRealtimeSync` + `mergeById` (optimistic local move; realtime drives other
  viewers). DM can add/place any token; a player can move only their own.

#### 9.1.3 — QA
- A token drag persists and appears on other clients live (~1–2 s, per-row);
  a player can move only their own token and is blocked from moving others
  (verify RLS server-side); grid snapping works; the map loads for all members.

### Subphase 9.2: Vision toggle & obstructions (walls + freehand)

#### 9.2.1 — Backend
- Migration: `playspace_walls` (map_id, kind `'segment' | 'freehand'`, geometry as
  an ordered point list / JSON). RLS: DM-write, member-read; realtime.
- The `vision_enabled` toggle already lives on the map (9.1.1).

#### 9.2.2 — Web UI
- DM vision toggle: **off ⇒ no fog, the whole map is visible to everyone**;
  on ⇒ the vision system (9.3/9.4) applies.
- DM obstruction tools: a **wall tool** (click-drag straight segments / rectangles
  to place walls & blockages) and a **freehand draw tool** for arbitrary shapes.
  Walls render for the DM and block player sight (consumed by 9.3).

#### 9.2.3 — QA
- Vision off = full visibility for all; walls and freehand shapes both block sight;
  only the DM can add/edit walls (verify server-side); walls persist and sync.

### Subphase 9.3: Token-based line of sight & sight range

#### 9.3.1 — Backend
- Add per-token sight config to `playspace_tokens`: a normal **sight range** and a
  separate **dark sight / darkvision range** (D&D-style "see N ft in the dark").

#### 9.3.2 — Web UI
- Each player's visible area is **ray-cast from their own token(s)** against the
  walls (9.2) and clipped to their sight range; everything outside is fogged. The
  DM always sees the whole map. Moving a token recomputes vision live. If a player
  controls multiple tokens, they see the union of their tokens' visibility.

#### 9.3.3 — QA
- A player sees only what their token can — blocked by walls, limited by range;
  moving the token updates the visible area in real time; the DM is unaffected;
  a second player sees from *their* token, not the first's.

### Subphase 9.4: Light levels & darkness

#### 9.4.1 — Backend
- Add an **ambient darkness level** to `playspace_maps` and a `playspace_lights`
  table (or token-attached lights) with bright/dim radii and position. RLS DM-write
  (players may carry a light on their own token), member-read; realtime.

#### 9.4.2 — Web UI
- Combine lighting with sight (9.3): in **bright** light a character sees to full
  sight range; in **dim** light, reduced; in **darkness** they see only as far as
  their darkvision (or not at all) — so the map gets darker the further from a
  light source. Lights render their bright/dim radii; player vision = (what walls
  allow) ∩ (sight range) ∩ (what light/darkvision reveals).

#### 9.4.3 — QA
- Darkness shortens effective sight; a light source illuminates its bright/dim
  radii; darkvision lets a token see a set distance in the dark; changes persist
  and sync live.

---

## Phase 10: Full RPG mode (round-based combat)
**Goal:** In `rpg` campaigns, combat is **round-based** and shared (players
participate), distinct from the notetaker's private, turn-by-turn DM Combat tracker
(Phase 3.5), which remains for `notetaker`/`playspace`. Rounds are **side-based and
alternating**: one side acts (all of its combatants act within that round), then
the other side acts the next round, and so on. The DM sets which side goes first
(players-first or DM/NPCs-first) and can flip it. Players act on their own turn —
moving their token and updating their own HP/conditions during their side's round.

### Subphase 10.1: Side-based round combat engine

#### 10.1.1 — Backend
- Migration: a combat session per encounter/map with a **round counter**, an
  **active side** (`'players' | 'npcs'`), and a configurable **side order** (which
  goes first); combatants belong to a side, carry per-round state (acted flag,
  HP/conditions), and link to a `playspace_token` where present.
- RLS: DM manages the session, NPC combatants, and round advancement; a **player**
  may update **only their own** combatant's acted flag / HP / conditions, and only
  while it is their side's active round; all members read the shared combat state.
  Add to Realtime + `REPLICA IDENTITY FULL`.

#### 10.1.2 — Web UI
- A round tracker showing the current round and active side, the roster of each
  side with per-combatant acted/HP/condition state, "Advance round" (DM) which
  flips to the other side and resets acted flags, and a side-order control (DM).
- On their side's active round, a player marks their combatant acted and edits
  their own HP/conditions; the DM drives NPC combatants and round flow.

#### 10.1.3 — QA
- Rounds alternate sides correctly; advancing resets the acted checklist and flips
  the side; a player can act only for their own combatant and only during their
  side's round (verify server-side); DM/NPCs-first vs players-first both work;
  state persists and syncs live; combat UI appears only in `rpg` mode.

### Subphase 10.2: Combat ↔ playspace integration

#### 10.2.1 — Backend
- Link combatants to their `playspace_tokens` so combat and map share position and
  identity; movement during combat writes token position (7 reuses 9.1's token RLS).

#### 10.2.2 — Web UI
- Start combat from the map; the active side's combatants are highlighted on the
  map; a player moves their token during their side's round; token HP/condition
  chips reflect combat state.

#### 10.2.3 — QA
- Combat reflects on the map (active-combatant highlight, positions); movement
  during a side's round syncs live; ending combat leaves tokens in place.

---

## Phase 11: Transactional email & notifications
**Goal:** Close the communication gaps — invites, session reminders, and billing
notices — that the app currently has no channel for. Makes the Scheduling feature
(4.3) actually useful with reminders.

### Subphase 11.1: Backend
#### 11.1.1 — Backend
- Integrate an email provider (e.g. **Resend/Postmark**) via an Edge Function;
  templated, from a verified domain. Sends: **campaign invite** (email a join
  link/code), **session reminder** (scheduled via cron ahead of a
  `schedule_sessions.proposed_at`), and **billing notices** (trial ending,
  payment failed/dunning, subscription cancelled) driven off Stripe webhook
  events. Idempotent; respects a per-user opt-out.
#### 11.1.2 — QA
- Each email type fires on its trigger, renders correctly, and honors opt-out;
  reminders send once, at the right lead time.

### Subphase 11.2: In-app wiring
#### 11.2.1 — Web UI
- Invite-by-email entry alongside invite codes; a **notification preferences**
  screen (reminder lead time, opt-out toggles); unsubscribe handling.
#### 11.2.2 — QA
- Sending an email invite enrolls correctly on click; preferences persist and
  take effect; unsubscribe link works.

## Phase 12: Content moderation & safety
**Goal:** Make user-uploaded images that are visible to others (portraits,
encounter images, **shared handouts**) safe to ship. Today the upload pipeline
has only a **pass-through moderation seam** and `report_media` exists but isn't
wired to any action — a legal/safety gap before public launch.

### Subphase 12.1: Moderation pipeline + report→review→takedown
#### 12.1.1 — Backend
- Replace the pass-through moderation hook in `upload-media` with a real check
  (an automated image-moderation provider, or at minimum a quarantine-on-report
  workflow). Wire `report_media` into a real **review + takedown** path
  (`set_media_status` → hidden/blocked propagates everywhere the asset renders,
  which already degrades to a placeholder). Optional admin/review surface.
#### 12.1.2 — Web UI
- A **Report** control on shared/other-authored images; clear "under review /
  removed" states; a reporter sees confirmation.
#### 12.1.3 — QA
- A reported image can be taken down and then renders as a placeholder for all
  viewers; blocked uploads never go live; a normal image is unaffected.

## Phase 13: Launch hardening
**Goal:** The remaining production-readiness work: abuse-resistant, observable,
deployed, and backed up.

### Subphase 13.1: Rate limiting & abuse prevention
#### 13.1.1 — Backend
- Rate-limit sensitive endpoints (auth, invite redemption, uploads, checkout,
  export/import) to curb spam/scraping/cost-abuse; sensible per-user/IP ceilings.
- Abuse guards: invite-code brute-force protection and upload flood limits (ties
  to 1.6). (The report/takedown path now lives in Phase 12.)
#### 13.1.2 — QA
- Hammering a rate-limited endpoint is throttled with clear errors; normal use is
  unaffected.

### Subphase 13.2: Analytics & observability
#### 13.2.1 — Backend
- Error monitoring (e.g. Sentry) on the frontend + Edge Functions; structured
  logs; alerts on webhook failures and the cleanup/cron job.
#### 13.2.2 — Web UI
- Privacy-respecting product analytics (key funnels: signup → campaign → trial →
  subscribe), disclosed in the Privacy Policy.
#### 13.2.3 — QA
- Errors surface in monitoring; a failed Stripe webhook raises an alert;
  analytics events fire on the core funnel.

### Subphase 13.3: Deployment, backups & monitoring
#### 13.3.1 — Backend
- Production Supabase config; automated DB backups; run the Supabase security &
  performance advisors and resolve findings.
#### 13.3.2 — QA
- Fresh prod deploy: sign up → create campaign → start trial → join → fill a
  sheet → DM views it → DM shares a handout. Smoke test passes end to end.

---

## Phase 14: Responsive/mobile, theming & accessibility
**Goal:** The app works on the device players actually have at the table. This is
the last phase before launch: a pass over finished screens, which is why it runs
after Phases 9–10 rather than alongside them.

### Subphase 14.1: Responsive/mobile, theming & accessibility

#### 14.1.1 — Web UI
- Mobile layouts (players will use phones at the table); light/dark theme;
  keyboard nav and an a11y pass.
- **The theme control belongs in Profile → Workspace**, beside the sidebar
  setting — same "applies to every campaign, saved in this browser" model. Unlike
  the sidebar side, theme can safely apply live rather than on next load.
  `tokens.css` currently only follows `prefers-color-scheme`, so there is no
  manual override at all today; the Profile page names that gap.
- **Note for whoever picks this up:** the Phase 5.2 workspace shell is the hard
  part. It is a full-bleed desktop layout — a side rail plus draggable, resizable
  floating windows — and none of those interactions survive a phone viewport as
  built. Expect to design a genuinely different mobile presentation (one panel at
  a time, or a sheet stack) rather than to make the windows smaller. The layout
  is already persisted per browser, so a phone can hold its own arrangement.

#### 14.1.2 — QA
- Core flows work on a phone viewport; basic screen-reader/keyboard pass.

---

## Post-launch backlog (after public launch)
**Goal:** Valuable but not launch-blocking; sequenced after a public launch.

### PL.2: Onboarding, empty states & sample content
- First-run guidance so a new DM isn't staring at blank tabs: helpful empty
  states, a short "create your first campaign/character" flow, optional sample
  content. QA: a brand-new user can reach a filled sheet without guessing.

### PL.3: Shared dice roller (table-wide, realtime)
- A campaign-wide dice roller with a shared, live roll log everyone at the table
  sees (builds on Phase 4.4 Realtime), distinct from the DM's private Combat-tab
  roller. QA: a roll by one member appears in every member's log live.

### PL.4: Performance & code-splitting
- Route-level code-splitting to shrink the initial bundle (currently one >500 kB
  chunk); lazy-load heavy panels. QA: first-load bundle meaningfully smaller;
  no regressions.

### PL.5: Server-authoritative playspace vision (anti-peek)
- Harden Phase 9 vision: move the ray-cast/lighting computation server-side so each
  player's client receives **only** the map area, tokens, and lights they can
  actually see — closing the client-side-peek gap accepted for the MVP. Weigh
  against the added latency on every token move. QA: a player's client cannot
  observe walls/tokens/lights outside their computed vision, even via network/state
  inspection; movement still feels responsive.

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
  a refund/cancellation policy. Versioned acceptance recorded at signup. (Phase 7.2.)
- **Data rights:** user-initiated account deletion with role-aware cascade (5.1);
  export/portability via the 4.2 functions.
- **Content safety:** all user images flow through the 1.6 pipeline
  (type/size validation, EXIF strip, resize, moderation); acceptable-use policy +
  report/takedown for shared content.
- **Email:** one transactional provider for lifecycle/billing/legal mail; Supabase
  Auth covers verify/reset only.
- **Observability & abuse:** error monitoring + alerts on webhooks and the cleanup
  cron; rate limiting on sensitive endpoints (Phase 13).

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
  *Compliance & Operations*). (Account deletion, tax, and campaign export are
  now planned in Phases 4–5. Co-DM / ownership transfer were considered and
  intentionally dropped from scope.)
```