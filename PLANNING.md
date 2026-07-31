# D&D Campaign Manager — Master Implementation Plan

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

### Phase 5: Accounts, roles & compliance
- [ ] 5.1 — Account deletion, data rights & cascade
  - [ ] 5.1.1 — Backend
  - [ ] 5.1.2 — Web UI
  - [ ] 5.1.3 — QA
- [ ] 5.2 — Legal & policy pages (ToS, Privacy, refunds)
  - [ ] 5.2.1 — Backend
  - [ ] 5.2.2 — Web UI
  - [ ] 5.2.3 — QA

### Phase 6: Automated testing & CI
- [ ] 6.1 — Test infrastructure + unit/component tests (Vitest + RTL)
- [ ] 6.2 — RLS / database policy tests
- [ ] 6.3 — End-to-end smoke tests (Playwright) + CI pipeline

### Phase 7: Transactional email & notifications
- [ ] 7.1 — Backend (email provider + send functions)
  - [ ] 7.1.1 — Backend
  - [ ] 7.1.2 — QA
- [ ] 7.2 — In-app wiring (invite-by-email, notification prefs/opt-out)
  - [ ] 7.2.1 — Web UI
  - [ ] 7.2.2 — QA

### Phase 8: Content moderation & safety
- [ ] 8.1 — Moderation pipeline + report→review→takedown
  - [ ] 8.1.1 — Backend
  - [ ] 8.1.2 — Web UI
  - [ ] 8.1.3 — QA

### Phase 9: Launch hardening
- [ ] 9.1 — Rate limiting & abuse prevention
  - [ ] 9.1.1 — Backend
  - [ ] 9.1.2 — QA
- [ ] 9.2 — Analytics & observability
  - [ ] 9.2.1 — Backend
  - [ ] 9.2.2 — Web UI
  - [ ] 9.2.3 — QA
- [ ] 9.3 — Deployment, backups & monitoring
  - [ ] 9.3.1 — Backend
  - [ ] 9.3.2 — QA

### Post-launch backlog (after public launch)
- [ ] PL.1 — Responsive/mobile, theming & accessibility
  - [ ] PL.1.1 — Web UI
  - [ ] PL.1.2 — QA
- [ ] PL.2 — Onboarding, empty states & sample content
- [ ] PL.3 — Shared dice roller (table-wide, realtime)
- [ ] PL.4 — Performance & code-splitting

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
data cascade, and the required policy pages.

### Subphase 5.1: Account deletion, data rights & cascade

#### 5.1.1 — Backend
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

#### 5.1.2 — Web UI
- Account settings: delete account (with clear warnings about what's removed and
  a prompt to export first), and links to export tools.

#### 5.1.3 — QA
- Deleting an account removes the right data in every role and cancels its
  subscriptions; other users' campaigns are untouched; Storage objects are gone.

### Subphase 5.2: Legal & policy pages (ToS, Privacy, refunds)

#### 5.2.1 — Backend
- Store acceptance (versioned ToS/Privacy acceptance timestamp on the profile);
  re-prompt on material updates.

#### 5.2.2 — Web UI
- **Terms of Service**, **Privacy Policy** (what's stored, Stripe as processor,
  retention, deletion rights), and a **refund/cancellation policy** page; signup
  consent checkbox; footer links.

#### 5.2.3 — QA
- Signup records policy acceptance; pages are reachable; refund policy matches the
  actual billing behavior (read-only on lapse, 3-month deletion).

---

## Phase 6: Automated testing & CI
**Goal:** Replace "manual QA + typecheck only" with a real regression safety net,
so future changes can't silently break existing behavior — especially the RLS
security model, which has repeatedly had subtle edge cases. Runs continuously in
CI. (Existing per-phase manual checklists in `QA/` stay as the human-verification
layer; this adds the automated layer beneath them.)

### Subphase 6.1: Test infrastructure + unit/component tests
- Stand up **Vitest + React Testing Library** (jsdom); wire `npm test` and a
  coverage report. Add unit tests for pure logic that's easy to regress:
  dice-notation parsing, HP damage/heal (temp-first, cap-at-max), death-save
  clamps, initiative sort, `extractNpcHp`, safe-markdown escaping, id-remap in
  import, the realtime `mergeById` helper. Component tests for a couple of
  high-traffic panels (autosave indicator, a sheet section editor).
- QA: `npm test` runs green locally; coverage report generated.

### Subphase 6.2: RLS / database policy tests
- A **pgTAP (or SQL) harness** that seeds a DM + player + non-member + anon and
  asserts every table's read/write matrix — the checks we've been running by hand
  each phase (owner-only writes, DM read scope, member-vs-non-member, journal
  privacy, DM-only workspace, shared-items asymmetry, per-user rsvp). This makes
  the security model a **regression test**, not a one-time manual pass.
- QA: the suite fails loudly if any policy is loosened/removed.

### Subphase 6.3: End-to-end smoke tests (Playwright) + CI pipeline
- A few **Playwright** flows against a test project: sign up → create campaign →
  start trial → invite/join → fill a sheet → DM views party → DM shares a handout
  → player sees it. Plus an export→import round-trip.
- Wire **CI** (GitHub Actions or similar): typecheck + build + unit + RLS + e2e on
  every push; block merge on failure.
- QA: CI is green on main; a deliberately broken policy/logic change is caught.

## Phase 7: Transactional email & notifications
**Goal:** Close the communication gaps — invites, session reminders, and billing
notices — that the app currently has no channel for. Makes the Scheduling feature
(4.3) actually useful with reminders.

### Subphase 7.1: Backend
#### 7.1.1 — Backend
- Integrate an email provider (e.g. **Resend/Postmark**) via an Edge Function;
  templated, from a verified domain. Sends: **campaign invite** (email a join
  link/code), **session reminder** (scheduled via cron ahead of a
  `schedule_sessions.proposed_at`), and **billing notices** (trial ending,
  payment failed/dunning, subscription cancelled) driven off Stripe webhook
  events. Idempotent; respects a per-user opt-out.
#### 7.1.2 — QA
- Each email type fires on its trigger, renders correctly, and honors opt-out;
  reminders send once, at the right lead time.

### Subphase 7.2: In-app wiring
#### 7.2.1 — Web UI
- Invite-by-email entry alongside invite codes; a **notification preferences**
  screen (reminder lead time, opt-out toggles); unsubscribe handling.
#### 7.2.2 — QA
- Sending an email invite enrolls correctly on click; preferences persist and
  take effect; unsubscribe link works.

## Phase 8: Content moderation & safety
**Goal:** Make user-uploaded images that are visible to others (portraits,
encounter images, **shared handouts**) safe to ship. Today the upload pipeline
has only a **pass-through moderation seam** and `report_media` exists but isn't
wired to any action — a legal/safety gap before public launch.

### Subphase 8.1: Moderation pipeline + report→review→takedown
#### 8.1.1 — Backend
- Replace the pass-through moderation hook in `upload-media` with a real check
  (an automated image-moderation provider, or at minimum a quarantine-on-report
  workflow). Wire `report_media` into a real **review + takedown** path
  (`set_media_status` → hidden/blocked propagates everywhere the asset renders,
  which already degrades to a placeholder). Optional admin/review surface.
#### 8.1.2 — Web UI
- A **Report** control on shared/other-authored images; clear "under review /
  removed" states; a reporter sees confirmation.
#### 8.1.3 — QA
- A reported image can be taken down and then renders as a placeholder for all
  viewers; blocked uploads never go live; a normal image is unaffected.

## Phase 9: Launch hardening
**Goal:** The remaining production-readiness work: abuse-resistant, observable,
deployed, and backed up.

### Subphase 9.1: Rate limiting & abuse prevention
#### 9.1.1 — Backend
- Rate-limit sensitive endpoints (auth, invite redemption, uploads, checkout,
  export/import) to curb spam/scraping/cost-abuse; sensible per-user/IP ceilings.
- Abuse guards: invite-code brute-force protection and upload flood limits (ties
  to 1.6). (The report/takedown path now lives in Phase 8.)
#### 9.1.2 — QA
- Hammering a rate-limited endpoint is throttled with clear errors; normal use is
  unaffected.

### Subphase 9.2: Analytics & observability
#### 9.2.1 — Backend
- Error monitoring (e.g. Sentry) on the frontend + Edge Functions; structured
  logs; alerts on webhook failures and the cleanup/cron job.
#### 9.2.2 — Web UI
- Privacy-respecting product analytics (key funnels: signup → campaign → trial →
  subscribe), disclosed in the Privacy Policy.
#### 9.2.3 — QA
- Errors surface in monitoring; a failed Stripe webhook raises an alert;
  analytics events fire on the core funnel.

### Subphase 9.3: Deployment, backups & monitoring
#### 9.3.1 — Backend
- Production Supabase config; automated DB backups; run the Supabase security &
  performance advisors and resolve findings.
#### 9.3.2 — QA
- Fresh prod deploy: sign up → create campaign → start trial → join → fill a
  sheet → DM views it → DM shares a handout. Smoke test passes end to end.

---

## Post-launch backlog (after public launch)
**Goal:** Valuable but not launch-blocking; sequenced after a public launch.
Mobile is first — players use the app at the table on phones, so it's the highest
post-launch priority.

### PL.1: Responsive/mobile, theming & accessibility
#### PL.1.1 — Web UI
- Mobile layouts (players will use phones at the table); light/dark theme;
  keyboard nav and an a11y pass.
#### PL.1.2 — QA
- Core flows work on a phone viewport; basic screen-reader/keyboard pass.

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
  a refund/cancellation policy. Versioned acceptance recorded at signup. (Phase 5.2.)
- **Data rights:** user-initiated account deletion with role-aware cascade (5.1);
  export/portability via the 4.2 functions.
- **Content safety:** all user images flow through the 1.6 pipeline
  (type/size validation, EXIF strip, resize, moderation); acceptable-use policy +
  report/takedown for shared content.
- **Email:** one transactional provider for lifecycle/billing/legal mail; Supabase
  Auth covers verify/reset only.
- **Observability & abuse:** error monitoring + alerts on webhooks and the cleanup
  cron; rate limiting on sensitive endpoints (Phase 9).

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