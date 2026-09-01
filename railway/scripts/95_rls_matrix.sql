-- ============================================================================
-- 95_rls_matrix.sql — the RLS access-control matrix, as a regression test.
-- Phase 8.2.
--
-- WHY THIS EXISTS. RLS is the real access-control layer in this project; the UI
-- gating is defence in depth. That model has been verified BY HAND in every
-- phase — the same DM / player / non-member / anon matrix, re-run from memory
-- each time. Anything checked from memory eventually stops being checked.
--
-- Three real leaks have already happened here, all the same shape: a new
-- function is PUBLIC-executable by default, and this project's default
-- privileges ALSO grant EXECUTE to `authenticated` by name, so
-- `revoke ... from public` restricts nothing.
--     * campaign_entitlements      — leaked from migration 0009 until 7.1
--     * account_deletion_targets   — leaked another user's Storage paths
--     * lapse_sweep_targets        — would have leaked every lapsed owner's EMAIL
-- Each was caught by somebody remembering to look. This file does not need to
-- remember.
--
-- HOW IT RUNS. Everything happens inside ONE transaction that never commits:
-- fixtures are seeded, every persona's reads and writes are asserted, the
-- results are printed, and then either an exception aborts the transaction (on
-- failure) or an explicit ROLLBACK discards it (on success). Nothing persists
-- either way. That is what makes it safe to run against production, which is
-- currently the only database there is.
--
-- HOW IT FAILS. The final block RAISEs if any assertion failed. Run with
-- `psql -v ON_ERROR_STOP=1`, that exits non-zero, and the migrate job treats it
-- as a failed deploy. A loosened policy therefore blocks the schema change that
-- loosened it.
--
-- ADDING A CASE: seed what it needs in the fixture section, then one call to
-- `assert_rows(...)` or `assert_denied(...)`. Prefer asserting a DENIAL —
-- allowed paths are exercised constantly by the app, denials are exercised by
-- nobody until they stop working.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Results collector.
-- ---------------------------------------------------------------------------
create temp table rls_results (
  area text,
  persona text,
  assertion text,
  expected text,
  actual text,
  ok boolean
) on commit drop;

-- Every persona role needs to write its own results.
grant insert, select on rls_results to authenticated, anon;

/*
 * Runs a SELECT as the CURRENT role and records whether the row count matched.
 * Dynamic SQL so a single helper can cover every table.
 */
create or replace function pg_temp.assert_rows(
  p_area text, p_persona text, p_assertion text, p_sql text, p_expected int
) returns void language plpgsql as $$
declare v_n int;
begin
  execute 'select count(*) from (' || p_sql || ') s' into v_n;
  insert into rls_results values (
    p_area, p_persona, p_assertion, p_expected::text, v_n::text, v_n = p_expected
  );
exception when others then
  -- An error is a legitimate outcome for a denied read (permission denied on a
  -- function, for instance). Record it rather than aborting the whole run.
  insert into rls_results values (p_area, p_persona, p_assertion, p_expected::text, 'ERROR ' || sqlstate, false);
end $$;

/*
 * Asserts that a WRITE is refused. "Refused" means EITHER an error OR a
 * statement that matches zero rows — RLS produces both, depending on whether the
 * policy blocks the row (silent no-op) or the command (error). Treating only
 * errors as success would let a silent no-op look like a failure, and treating
 * only zero-rows as success would miss the error case.
 */
create or replace function pg_temp.assert_denied(
  p_area text, p_persona text, p_assertion text, p_sql text
) returns void language plpgsql as $$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  insert into rls_results values (
    p_area, p_persona, p_assertion, 'denied', 
    case when v_n = 0 then '0 rows (denied)' else v_n || ' rows WRITTEN' end,
    v_n = 0
  );
exception when others then
  insert into rls_results values (p_area, p_persona, p_assertion, 'denied', 'error ' || sqlstate, true);
end $$;

/*
 * Asserts that a statement RAISES.
 *
 * Distinct from assert_rows(..., 0) on purpose. A denied TABLE read returns zero
 * rows; a denied FUNCTION raises. If both were checked as "zero rows", a
 * function that stopped refusing and started returning nothing would pass a test
 * written to prove it refuses — the assertion would be true and meaningless.
 */
create or replace function pg_temp.assert_error(
  p_area text, p_persona text, p_assertion text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into rls_results values (p_area, p_persona, p_assertion, 'raises', 'returned normally', false);
exception when others then
  insert into rls_results values (p_area, p_persona, p_assertion, 'raises', 'raised ' || sqlstate, true);
end $$;

/* Asserts a write SUCCEEDS — the control that stops "everything is denied" passing. */
create or replace function pg_temp.assert_allowed(
  p_area text, p_persona text, p_assertion text, p_sql text
) returns void language plpgsql as $$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  insert into rls_results values (p_area, p_persona, p_assertion, 'allowed', v_n || ' rows', v_n > 0);
exception when others then
  insert into rls_results values (p_area, p_persona, p_assertion, 'allowed', 'ERROR ' || sqlstate || ' ' || sqlerrm, false);
end $$;

/* Switches the session to a persona: the `authenticated` role plus their JWT sub. */
create or replace function pg_temp.become(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

/* Back to the owner, to seed or to switch persona. */
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed uuids so a failure is greppable.
--
-- auth.users rows are inserted directly; the handle_new_user trigger creates the
-- matching profiles rows (which also exercises the username allocator).
-- ---------------------------------------------------------------------------
\set dm      '''aaaaaaaa-0000-4000-8000-000000000001'''
\set p1      '''aaaaaaaa-0000-4000-8000-000000000002'''
\set p2      '''aaaaaaaa-0000-4000-8000-000000000003'''
\set out     '''aaaaaaaa-0000-4000-8000-000000000004'''
\set camp    '''bbbbbbbb-0000-4000-8000-000000000001'''
\set othcamp '''bbbbbbbb-0000-4000-8000-000000000002'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), '{}'::jsonb, jsonb_build_object('username', u.uname), now(), now()
from (values
  (:dm::uuid,  'rlsdm@qa.invalid',   'RlsDm'),
  (:p1::uuid,  'rlsp1@qa.invalid',   'RlsPlayerOne'),
  (:p2::uuid,  'rlsp2@qa.invalid',   'RlsPlayerTwo'),
  (:out::uuid, 'rlsout@qa.invalid',  'RlsOutsider')
) as u(id, email, uname);

-- The campaign under test, plus a second one the outsider owns (so "no rows"
-- can be distinguished from "the table is empty").
insert into public.campaigns (id, name, owner_id) values
  (:camp::uuid, 'RLS Matrix Campaign', :dm::uuid),
  (:othcamp::uuid, 'Outsider Campaign', :out::uuid);

-- campaigns_add_owner_as_dm already added the owners; add the two players.
insert into public.campaign_members (campaign_id, user_id, role) values
  (:camp::uuid, :p1::uuid, 'player'),
  (:camp::uuid, :p2::uuid, 'player');

insert into public.characters (id, campaign_id, owner_id, name) values
  ('cccccccc-0000-4000-8000-000000000001', :camp::uuid, :p1::uuid, 'P1 Character'),
  ('cccccccc-0000-4000-8000-000000000002', :camp::uuid, :p2::uuid, 'P2 Character');

-- An approved image in the campaign, for the 0058 token-artwork assertions.
insert into public.media_assets (id, campaign_id, uploaded_by, storage_path, mime, byte_size, moderation_status)
  values ('eeeeeeee-0000-4000-8000-000000000001', :camp::uuid, :dm::uuid, 'test/art.webp', 'image/webp', 1024, 'approved');

insert into public.sheet_sections (id, character_id, title, position) values
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Stats', 0);
insert into public.sheet_fields (section_id, label, value, position) values
  ('dddddddd-0000-4000-8000-000000000001', 'HP', '10', 0);
insert into public.inventory_items (character_id, name, position) values
  ('cccccccc-0000-4000-8000-000000000001', 'P1 Sword', 0);
insert into public.journal_entries (character_id, title, body, position) values
  ('cccccccc-0000-4000-8000-000000000001', 'P1 Private Journal', 'secret', 0);

insert into public.dm_notes (campaign_id, title, body, position) values
  (:camp::uuid, 'DM Secret', 'players must not see this', 0);
insert into public.npcs (campaign_id, name, position) values
  (:camp::uuid, 'Secret NPC', 0);
insert into public.quests (campaign_id, title, position) values
  (:camp::uuid, 'Secret Quest', 0);
insert into public.sessions (campaign_id, title, position) values
  (:camp::uuid, 'Session One', 0);
insert into public.shared_items (campaign_id, type, title, position) values
  (:camp::uuid, 'note', 'Shared Handout', 0);
insert into public.schedule_sessions (id, campaign_id, title, position) values
  ('eeeeeeee-0000-4000-8000-000000000001', :camp::uuid, 'Next Game', 0);
insert into public.schedule_rsvps (session_id, user_id, status) values
  ('eeeeeeee-0000-4000-8000-000000000001', :p1::uuid, 'yes');
insert into public.invite_codes (campaign_id, code, created_by) values
  (:camp::uuid, 'RLSQA1', :dm::uuid);
insert into public.campaign_subscriptions (campaign_id, status) values
  (:camp::uuid, 'active');

-- Playspace (Phase 9.1): one active map with three tokens — one owned by each
-- player, and one DM-controlled monster with no owner.
insert into public.playspace_maps (id, campaign_id, name, is_active) values
  ('ffffffff-0000-4000-8000-000000000001', :camp::uuid, 'Matrix Map', true);
insert into public.playspace_tokens (id, map_id, owner_user_id, label) values
  ('ffffffff-0000-4000-8000-000000000011', 'ffffffff-0000-4000-8000-000000000001', :p1::uuid, 'P1 token'),
  ('ffffffff-0000-4000-8000-000000000012', 'ffffffff-0000-4000-8000-000000000001', :p2::uuid, 'P2 token'),
  ('ffffffff-0000-4000-8000-000000000013', 'ffffffff-0000-4000-8000-000000000001', null,      'DM dragon');

-- A wall on the active map, for the 0060 assertions.
insert into public.playspace_walls (id, map_id, kind, points)
  values ('aaaabbbb-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'segment', '[[0,0],[100,100]]'::jsonb);

-- ===========================================================================
-- THE MATRIX
-- ===========================================================================

-- --- DM -------------------------------------------------------------------
select pg_temp.become(:dm::uuid);
select pg_temp.assert_rows('campaigns','DM','sees own campaign','select 1 from public.campaigns where id=' || quote_literal(:camp) || '::uuid', 1);
select pg_temp.assert_rows('campaigns','DM','does NOT see a campaign they are not in','select 1 from public.campaigns where id=' || quote_literal(:othcamp) || '::uuid', 0);
select pg_temp.assert_rows('roster','DM','sees all 3 members','select 1 from public.campaign_members where campaign_id=' || quote_literal(:camp) || '::uuid', 3);
select pg_temp.assert_rows('characters','DM','reads BOTH players'' characters','select 1 from public.characters where campaign_id=' || quote_literal(:camp) || '::uuid', 2);
select pg_temp.assert_rows('journal','DM','CANNOT read a player''s journal','select 1 from public.journal_entries', 0);
select pg_temp.assert_rows('dm_notes','DM','reads DM notes','select 1 from public.dm_notes', 1);
select pg_temp.assert_rows('npcs','DM','reads NPCs','select 1 from public.npcs', 1);
select pg_temp.assert_rows('quests','DM','reads quests','select 1 from public.quests', 1);
select pg_temp.assert_rows('sessions','DM','reads the session log','select 1 from public.sessions', 1);
select pg_temp.assert_rows('billing','DM','reads the subscription row','select 1 from public.campaign_subscriptions', 1);
select pg_temp.assert_rows('invites','DM','reads invite codes','select 1 from public.invite_codes', 1);
select pg_temp.assert_allowed('dm_notes','DM','can write a DM note','insert into public.dm_notes (campaign_id,title,position) values (' || quote_literal(:camp) || '::uuid,''new'',1)');
select pg_temp.assert_denied('journal','DM','cannot WRITE a player''s journal','update public.journal_entries set title=''hijacked''');
select pg_temp.assert_denied('campaigns','DM','direct DELETE of own campaign matches nothing (0034)','delete from public.campaigns where id=' || quote_literal(:camp) || '::uuid');
-- 0052: an ORDINARY DM must NOT be able to edit a player's sheet. This is the
-- assertion that matters most in this file, because it is the one that fails if
-- the dev-account write clause is ever widened past its allowlist. The positive
-- case below is a convenience; this one is the boundary.
select pg_temp.assert_rows('walls','DM','reads the map''s walls','select 1 from public.playspace_walls', 1);
select pg_temp.assert_allowed('walls','DM','can draw a wall','insert into public.playspace_walls (map_id,kind,points) values (''ffffffff-0000-4000-8000-000000000001'',''freehand'',''[[5,5],[9,9],[20,3]]''::jsonb)');
select pg_temp.assert_error('walls','DM','cannot store a one-point wall','insert into public.playspace_walls (map_id,points) values (''ffffffff-0000-4000-8000-000000000001'',''[[1,1]]''::jsonb)');
select pg_temp.assert_error('walls','DM','cannot store a non-numeric point','insert into public.playspace_walls (map_id,points) values (''ffffffff-0000-4000-8000-000000000001'',''[[1,1],["a","b"]]''::jsonb)');
select pg_temp.assert_allowed('playspace','DM','CAN set the ring on a player''s token (0059)','update public.playspace_tokens set ring=''on'' where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_allowed('playspace','DM','CAN resize a player''s token (0057)','update public.playspace_tokens set size_cells=3 where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_denied('characters','DM','cannot edit a player''s character (non-dev DM)','update public.characters set name=''dm-edited'' where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.assert_denied('sheet','DM','cannot edit a player''s sheet section (non-dev DM)','update public.sheet_sections set title=''dm-edited''');
select pg_temp.become_owner();

-- --- DM who IS an allowlisted dev account (0052) ---------------------------
-- The fixture DM is temporarily added to private.dev_accounts, exercised, then
-- removed. Safe against production for the same reason as everything else here:
-- the whole script runs in a transaction that always rolls back. The removal is
-- belt-and-braces so the later assertions cannot silently run as a dev account.
insert into private.dev_accounts (user_id) values (:dm::uuid);
select pg_temp.become(:dm::uuid);
select pg_temp.assert_rows('dev','dev DM','is_dev_account() is true once allowlisted','select 1 where public.is_dev_account()', 1);
select pg_temp.assert_allowed('dev','dev DM','CAN edit a player''s character','update public.characters set name=''dev-edited'' where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.assert_allowed('dev','dev DM','CAN edit a player''s sheet section','update public.sheet_sections set title=''dev-edited''');
-- The sheet is editable; ownership is not transferable through that path.
select pg_temp.assert_denied('dev','dev DM','cannot REASSIGN a character to themselves','update public.characters set owner_id=' || quote_literal(:dm) || '::uuid where owner_id=' || quote_literal(:p1) || '::uuid');
-- The journal is excluded on purpose: private even from a dev DM.
select pg_temp.assert_rows('dev','dev DM','still CANNOT read a player''s journal','select 1 from public.journal_entries', 0);
select pg_temp.assert_denied('dev','dev DM','still cannot WRITE a player''s journal','update public.journal_entries set title=''dev-hijacked''');
-- Deleting someone's sheet is not a testing need and has no undo.
select pg_temp.assert_denied('dev','dev DM','cannot DELETE a player''s character','delete from public.characters where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.become_owner();
delete from private.dev_accounts where user_id = :dm::uuid;
select pg_temp.become(:dm::uuid);
select pg_temp.assert_denied('dev','ex-dev DM','loses sheet write the moment they leave the allowlist','update public.characters set name=''revoked'' where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.become_owner();

-- --- Player 1 (member, owns a character) ----------------------------------
select pg_temp.become(:p1::uuid);
select pg_temp.assert_rows('campaigns','player','sees the campaign','select 1 from public.campaigns where id=' || quote_literal(:camp) || '::uuid', 1);
select pg_temp.assert_rows('roster','player','sees all 3 members','select 1 from public.campaign_members where campaign_id=' || quote_literal(:camp) || '::uuid', 3);
select pg_temp.assert_rows('characters','player','reads ONLY their own character','select 1 from public.characters', 1);
select pg_temp.assert_rows('sheet','player','reads own sheet fields','select 1 from public.sheet_fields', 1);
select pg_temp.assert_rows('inventory','player','reads own inventory','select 1 from public.inventory_items', 1);
select pg_temp.assert_rows('journal','player','reads own journal','select 1 from public.journal_entries', 1);
select pg_temp.assert_rows('dm_notes','player','CANNOT read DM notes','select 1 from public.dm_notes', 0);
select pg_temp.assert_rows('npcs','player','CANNOT read NPCs','select 1 from public.npcs', 0);
select pg_temp.assert_rows('quests','player','CANNOT read quests','select 1 from public.quests', 0);
select pg_temp.assert_rows('sessions','player','CANNOT read the session log','select 1 from public.sessions', 0);
select pg_temp.assert_rows('billing','player','CANNOT read the subscription row','select 1 from public.campaign_subscriptions', 0);
select pg_temp.assert_rows('invites','player','CANNOT read invite codes','select 1 from public.invite_codes', 0);
select pg_temp.assert_rows('shared','player','CAN read DM-shared items','select 1 from public.shared_items', 1);
select pg_temp.assert_rows('names','player','CAN see who plays what (0041)','select 1 from public.campaign_character_names(' || quote_literal(:camp) || '::uuid)', 2);
select pg_temp.assert_allowed('characters','player','can rename their own character','update public.characters set name=''Renamed'' where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.assert_denied('dm_notes','player','cannot write DM notes','insert into public.dm_notes (campaign_id,title,position) values (' || quote_literal(:camp) || '::uuid,''hack'',9)');
select pg_temp.assert_denied('shared','player','cannot write shared items','insert into public.shared_items (campaign_id,type,title,position) values (' || quote_literal(:camp) || '::uuid,''note'',''hack'',9)');
select pg_temp.assert_denied('campaigns','player','cannot rename the campaign','update public.campaigns set name=''hijacked'' where id=' || quote_literal(:camp) || '::uuid');
select pg_temp.assert_denied('roster','player','cannot remove another member','delete from public.campaign_members where user_id=' || quote_literal(:p2) || '::uuid');
select pg_temp.assert_denied('rsvp','player','cannot RSVP as somebody else','insert into public.schedule_rsvps (session_id,user_id,status) values (''eeeeeeee-0000-4000-8000-000000000001'',' || quote_literal(:p2) || '::uuid,''no'')');
select pg_temp.become_owner();

-- --- Player 2 (member, but not the owner of P1's data) --------------------
-- The most valuable persona: a legitimate member who must NOT see a peer's
-- private material. Every leak that matters inside a campaign looks like this.
select pg_temp.become(:p2::uuid);
select pg_temp.assert_rows('characters','other player','cannot read a PEER''s character','select 1 from public.characters where owner_id=' || quote_literal(:p1) || '::uuid', 0);
select pg_temp.assert_rows('sheet','other player','cannot read a peer''s sheet fields','select 1 from public.sheet_fields', 0);
select pg_temp.assert_rows('inventory','other player','cannot read a peer''s inventory','select 1 from public.inventory_items', 0);
select pg_temp.assert_rows('journal','other player','cannot read a peer''s journal','select 1 from public.journal_entries', 0);
select pg_temp.assert_rows('names','other player','CAN still see the peer''s character NAME','select 1 from public.campaign_character_names(' || quote_literal(:camp) || '::uuid)', 2);
select pg_temp.assert_denied('characters','other player','cannot edit a peer''s character','update public.characters set name=''stolen'' where owner_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.become_owner();

-- --- Non-member -----------------------------------------------------------
select pg_temp.become(:out::uuid);
select pg_temp.assert_rows('campaigns','non-member','cannot see the campaign','select 1 from public.campaigns where id=' || quote_literal(:camp) || '::uuid', 0);
select pg_temp.assert_rows('roster','non-member','cannot see the roster','select 1 from public.campaign_members where campaign_id=' || quote_literal(:camp) || '::uuid', 0);
select pg_temp.assert_rows('characters','non-member','cannot see any character','select 1 from public.characters where campaign_id=' || quote_literal(:camp) || '::uuid', 0);
select pg_temp.assert_rows('journal','non-member','cannot see journals','select 1 from public.journal_entries', 0);
select pg_temp.assert_rows('dm_notes','non-member','cannot see DM notes','select 1 from public.dm_notes', 0);
select pg_temp.assert_rows('shared','non-member','cannot see shared items','select 1 from public.shared_items', 0);
select pg_temp.assert_rows('profiles','non-member','cannot read a stranger''s profile','select 1 from public.profiles where id=' || quote_literal(:p1) || '::uuid', 0);
select pg_temp.assert_rows('profiles','non-member','CAN read their own profile','select 1 from public.profiles where id=' || quote_literal(:out) || '::uuid', 1);
select pg_temp.assert_error('names','non-member','character-name RPC RAISES rather than returning empty','select 1 from public.campaign_character_names(' || quote_literal(:camp) || '::uuid)');
select pg_temp.assert_denied('roster','non-member','cannot add themselves to the campaign','insert into public.campaign_members (campaign_id,user_id,role) values (' || quote_literal(:camp) || '::uuid,' || quote_literal(:out) || '::uuid,''player'')');
select pg_temp.become_owner();

-- --- Playspace battlemap (Phase 9.1) --------------------------------------
-- The headline rule: a player may move ONLY their own token. Everything else on
-- this map is somebody else's to drag.
select pg_temp.become(:p1::uuid);
select pg_temp.assert_rows('playspace','player','sees the active map','select 1 from public.playspace_maps where campaign_id=' || quote_literal(:camp) || '::uuid', 1);
select pg_temp.assert_rows('playspace','player','sees ALL tokens on it','select 1 from public.playspace_tokens', 3);
select pg_temp.assert_allowed('playspace','player','can move their OWN token','update public.playspace_tokens set x=120,y=240 where id=''ffffffff-0000-4000-8000-000000000011''');
-- 0056: size is part of the token row, so it inherits the movement rules. A
-- player resizing somebody else's monster would be as bad as moving it.
-- 0057: size is the DM's to set, even on a token the player owns and moves. The
-- FIRST of these used to assert the opposite (0056) and was changed deliberately
-- when the owner narrowed the rule.
-- 0058: token artwork. The point of copying the asset id ONTO the token is that
-- a player can then see a monster's portrait without being able to read the NPC
-- row it came from. Both halves are asserted, because either one alone would be
-- a different (and wrong) feature.
select pg_temp.assert_rows('playspace','player','CANNOT read the NPC row a token depicts','select 1 from public.npcs', 0);
select pg_temp.assert_rows('playspace','player','CAN read the campaign media a token points at','select 1 from public.media_assets where campaign_id=' || quote_literal(:camp) || '::uuid and moderation_status=''approved''', 1);
select pg_temp.assert_denied('playspace','player','CANNOT resize even their OWN token (0057)','update public.playspace_tokens set size_cells=2 where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_allowed('playspace','player','can still MOVE their own token after 0057','update public.playspace_tokens set x=140,y=140 where id=''ffffffff-0000-4000-8000-000000000011''');
-- 0059: the ring joins size as DM-only appearance. Asserted separately from
-- size, because they are guarded by one trigger and a change to it could
-- plausibly free one column while still holding the other.
-- Walls are DM-ONLY (0061, revising 0060). This assertion INVERTED when the
-- owner chose the stronger model: a player's client never receives wall
-- geometry, only the visibility polygon computed from it server-side (9.3).
-- It is the assertion the whole approach rests on — if it ever reads non-zero,
-- the map layout is leaking however good the fog looks on screen.
select pg_temp.assert_rows('walls','player','receives NO wall geometry at all (0061)','select 1 from public.playspace_walls', 0);
select pg_temp.assert_denied('walls','player','CANNOT draw a wall','insert into public.playspace_walls (map_id,points) values (''ffffffff-0000-4000-8000-000000000001'',''[[1,1],[2,2]]''::jsonb)');
select pg_temp.assert_denied('walls','player','CANNOT move a wall','update public.playspace_walls set points=''[[9,9],[8,8]]''::jsonb');
select pg_temp.assert_denied('walls','player','CANNOT delete a wall','delete from public.playspace_walls');
select pg_temp.assert_denied('playspace','player','CANNOT change the ring on their OWN token (0059)','update public.playspace_tokens set ring=''off'' where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_denied('playspace','player','CANNOT resize the DM''s monster','update public.playspace_tokens set size_cells=4 where id=''ffffffff-0000-4000-8000-000000000013''');
select pg_temp.assert_error('playspace','player','CANNOT set a nonsense token size','update public.playspace_tokens set size_cells=2.7 where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_denied('playspace','player','CANNOT move a peer''s token','update public.playspace_tokens set x=999 where id=''ffffffff-0000-4000-8000-000000000012''');
select pg_temp.assert_denied('playspace','player','CANNOT move the DM''s monster','update public.playspace_tokens set x=999 where id=''ffffffff-0000-4000-8000-000000000013''');
select pg_temp.assert_denied('playspace','player','CANNOT seize the DM''s monster by claiming it','update public.playspace_tokens set owner_user_id=' || quote_literal(:p1) || '::uuid where id=''ffffffff-0000-4000-8000-000000000013''');
select pg_temp.assert_denied('playspace','player','CANNOT give their token away','update public.playspace_tokens set owner_user_id=' || quote_literal(:p2) || '::uuid where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_denied('playspace','player','CANNOT orphan their token to DM control','update public.playspace_tokens set owner_user_id=null where id=''ffffffff-0000-4000-8000-000000000011''');
-- 0055: the DM's switch. The map fixture leaves players_can_place at its FALSE
-- default, so a player's own-token insert must now be refused — this is the
-- assertion that proves the switch is a real gate and not just a hidden button.
select pg_temp.assert_denied('playspace','player','CANNOT add their own token while the DM switch is off','insert into public.playspace_tokens (map_id,owner_user_id,label) values (''ffffffff-0000-4000-8000-000000000001'',' || quote_literal(:p1) || '::uuid,''mine'')');
select pg_temp.become_owner();
update public.playspace_maps set players_can_place = true where id = 'ffffffff-0000-4000-8000-000000000001';
select pg_temp.become(:p1::uuid);
select pg_temp.assert_allowed('playspace','player','CAN add their own token once the DM switches it on','insert into public.playspace_tokens (map_id,owner_user_id,label) values (''ffffffff-0000-4000-8000-000000000001'',' || quote_literal(:p1) || '::uuid,''mine'')');
-- ...but still only for THEIR character, never someone else's name (0055).
-- The peer's character id is written out LITERALLY, not looked up in a
-- subquery. A first draft used `(select id from characters where owner_id=p2)`
-- and the assertion passed for the wrong reason: that subquery runs as the
-- PLAYER, who cannot read a peer's character, so it returned NULL and the row
-- inserted as a plain unlinked marker — which the policy rightly allows. The
-- test proved nothing. Any fixture lookup inside an assertion is subject to the
-- very RLS being tested.
select pg_temp.assert_denied('playspace','player','CANNOT put a PEER''s character on a token','insert into public.playspace_tokens (map_id,owner_user_id,character_id,label) values (''ffffffff-0000-4000-8000-000000000001'',' || quote_literal(:p1) || '::uuid,''cccccccc-0000-4000-8000-000000000002'',''borrowed'')');
select pg_temp.become_owner();
update public.playspace_maps set players_can_place = false where id = 'ffffffff-0000-4000-8000-000000000001';
select pg_temp.become(:p1::uuid);
select pg_temp.assert_denied('playspace','player','CANNOT create a token for somebody else','insert into public.playspace_tokens (map_id,owner_user_id,label) values (''ffffffff-0000-4000-8000-000000000001'',' || quote_literal(:p2) || '::uuid,''forged'')');
select pg_temp.assert_denied('playspace','player','CANNOT delete a peer''s token','delete from public.playspace_tokens where id=''ffffffff-0000-4000-8000-000000000012''');
select pg_temp.assert_denied('playspace','player','CANNOT edit the map','update public.playspace_maps set grid_size=10 where campaign_id=' || quote_literal(:camp) || '::uuid');
select pg_temp.become_owner();

select pg_temp.become(:dm::uuid);
select pg_temp.assert_allowed('playspace','DM','can move ANY token','update public.playspace_tokens set x=50 where id=''ffffffff-0000-4000-8000-000000000011''');
select pg_temp.assert_allowed('playspace','DM','can edit the map','update public.playspace_maps set grid_size=100 where campaign_id=' || quote_literal(:camp) || '::uuid');
select pg_temp.become_owner();

select pg_temp.become(:out::uuid);
select pg_temp.assert_rows('playspace','non-member','sees no map','select 1 from public.playspace_maps', 0);
select pg_temp.assert_rows('walls','non-member','sees no walls','select 1 from public.playspace_walls', 0);
select pg_temp.assert_rows('playspace','non-member','sees no tokens','select 1 from public.playspace_tokens', 0);
select pg_temp.become_owner();

-- Owner rules from migration 0050. These are triggers rather than policies, but
-- they belong here: they are invariants a client could otherwise violate, and
-- this is the file that gets run on every schema change.
insert into public.playspace_maps (campaign_id, name) values
  (:camp::uuid, 'Prep 2'), (:camp::uuid, 'Prep 3'),
  (:camp::uuid, 'Prep 4'), (:camp::uuid, 'Prep 5');
select pg_temp.assert_rows('playspace','—','five maps per campaign are allowed','select 1 from public.playspace_maps where campaign_id=' || quote_literal(:camp) || '::uuid', 5);
select pg_temp.assert_error('playspace','—','a SIXTH map is refused','insert into public.playspace_maps (campaign_id,name) values (' || quote_literal(:camp) || '::uuid,''Prep 6'')');

-- Switching the live map is ONE update; the trigger clears the others.
update public.playspace_maps set is_active = true where campaign_id = :camp::uuid and name = 'Prep 3';
select pg_temp.assert_rows('playspace','—','switching maps leaves exactly one active','select 1 from public.playspace_maps where campaign_id=' || quote_literal(:camp) || '::uuid and is_active', 1);
select pg_temp.assert_rows('playspace','—','...and it is the one just chosen','select 1 from public.playspace_maps where campaign_id=' || quote_literal(:camp) || '::uuid and is_active and name=''Prep 3''', 1);
-- Put the original map back so later assertions see the fixture they expect.
update public.playspace_maps set is_active = true where id = 'ffffffff-0000-4000-8000-000000000001';

-- Relinquishing an NPC token: only to somebody actually in the campaign.
select pg_temp.assert_allowed('playspace','DM','can relinquish a token to a MEMBER','update public.playspace_tokens set owner_user_id=' || quote_literal(:p1) || '::uuid where id=''ffffffff-0000-4000-8000-000000000013''');
select pg_temp.assert_error('playspace','DM','CANNOT relinquish a token to a non-member','update public.playspace_tokens set owner_user_id=' || quote_literal(:out) || '::uuid where id=''ffffffff-0000-4000-8000-000000000013''');
select pg_temp.assert_allowed('playspace','DM','can reclaim it to DM control','update public.playspace_tokens set owner_user_id=null where id=''ffffffff-0000-4000-8000-000000000013''');

-- --- Locked tables: nobody, ever ------------------------------------------
-- RLS enabled with NO policies. These hold anti-abuse and erasure records; a
-- policy appearing on any of them is a bug, not a feature.
select pg_temp.become(:dm::uuid);
select pg_temp.assert_rows('locked','DM','trial_redemptions invisible','select 1 from public.trial_redemptions', 0);
select pg_temp.assert_rows('locked','DM','deleted_accounts invisible','select 1 from public.deleted_accounts', 0);
select pg_temp.assert_rows('locked','DM','orphaned_subscriptions invisible','select 1 from public.orphaned_subscriptions', 0);
-- 0051: the dev-account allowlist. Since 0052 this IS a security boundary — an
-- entry confers write access to other users' character sheets — so "no account
-- may add itself to it" is the assertion the whole feature rests on.
select pg_temp.assert_error('locked','DM','dev_accounts is unreadable','select 1 from private.dev_accounts');
select pg_temp.assert_error('locked','DM','cannot add SELF to dev_accounts','insert into private.dev_accounts (user_id) values (' || quote_literal(:dm) || '::uuid)');
select pg_temp.assert_rows('locked','DM','is_dev_account() is false for a normal account','select 1 where public.is_dev_account()', 0);
select pg_temp.become_owner();

-- --- Anonymous ------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', null, true);
select pg_temp.assert_rows('anon','anon','sees no campaigns','select 1 from public.campaigns', 0);
select pg_temp.assert_rows('anon','anon','sees no profiles','select 1 from public.profiles', 0);
select pg_temp.assert_rows('anon','anon','sees no walls','select 1 from public.playspace_walls', 0);
select pg_temp.assert_rows('anon','anon','sees no characters','select 1 from public.characters', 0);
select pg_temp.assert_rows('anon','anon','sees no journals','select 1 from public.journal_entries', 0);
select pg_temp.assert_rows('anon','anon','sees no DM notes','select 1 from public.dm_notes', 0);
select pg_temp.assert_denied('anon','anon','cannot create a campaign','insert into public.campaigns (name,owner_id) values (''anon camp'',' || quote_literal(:dm) || '::uuid)');
reset role;
select set_config('request.jwt.claims', null, true);

-- --- THE READ-ONLY LOCK (Phase 9.1 / migration 0049) ----------------------
-- "Everyone can still read everything, and nobody can write" is a claim the
-- Refunds page makes, so it needs a test rather than a comment.
--
-- enforce_active is switched ON for this section only; the transaction never
-- commits, so it is off again the moment this script ends. The seeded campaign
-- has an `active` subscription and acts as the CONTROL — without it, "all writes
-- are denied" would pass just as well if the lock were broken in the other
-- direction and froze everything.
update private.billing_config set enforce_active = true;

-- A second campaign with NO subscription: lapsed the moment enforcement is on.
insert into public.campaigns (id, name, owner_id)
values ('bbbbbbbb-0000-4000-8000-000000000003', 'Lapsed Campaign', :dm::uuid);
insert into public.characters (id, campaign_id, owner_id, name)
values ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000003', :dm::uuid, 'Frozen Character');
insert into public.dm_notes (campaign_id, title, position)
values ('bbbbbbbb-0000-4000-8000-000000000003', 'Frozen Note', 0);

select pg_temp.become(:dm::uuid);

-- Reads must still work. Data is preserved and exportable while frozen.
select pg_temp.assert_rows('lock','DM','CAN still read a lapsed campaign','select 1 from public.campaigns where id=''bbbbbbbb-0000-4000-8000-000000000003''', 1);
select pg_temp.assert_rows('lock','DM','CAN still read its DM notes','select 1 from public.dm_notes where campaign_id=''bbbbbbbb-0000-4000-8000-000000000003''', 1);
select pg_temp.assert_rows('lock','DM','CAN still read its characters','select 1 from public.characters where campaign_id=''bbbbbbbb-0000-4000-8000-000000000003''', 1);

-- Writes must not.
select pg_temp.assert_denied('lock','DM','cannot edit a DM note while lapsed','update public.dm_notes set title=''edited'' where campaign_id=''bbbbbbbb-0000-4000-8000-000000000003''');
select pg_temp.assert_denied('lock','DM','cannot add a DM note while lapsed','insert into public.dm_notes (campaign_id,title,position) values (''bbbbbbbb-0000-4000-8000-000000000003'',''new'',1)');
select pg_temp.assert_denied('lock','DM','cannot add an NPC while lapsed','insert into public.npcs (campaign_id,name,position) values (''bbbbbbbb-0000-4000-8000-000000000003'',''new npc'',0)');
select pg_temp.assert_denied('lock','DM','cannot rename their character while lapsed','update public.characters set name=''renamed'' where id=''cccccccc-0000-4000-8000-000000000003''');
select pg_temp.assert_denied('lock','DM','cannot delete content while lapsed','delete from public.dm_notes where campaign_id=''bbbbbbbb-0000-4000-8000-000000000003''');

-- CONTROL: the paid campaign is unaffected. Without this the section would pass
-- if the lock froze every campaign regardless of subscription.
select pg_temp.assert_allowed('lock','DM','CAN still write in a PAID campaign','insert into public.dm_notes (campaign_id,title,position) values (' || quote_literal(:camp) || '::uuid,''still working'',5)');

-- Leaving a campaign must always work, paid or not — see 0049.
select pg_temp.become(:p1::uuid);
select pg_temp.assert_allowed('lock','player','CAN still leave a lapsed campaign','delete from public.campaign_members where campaign_id=' || quote_literal(:camp) || '::uuid and user_id=' || quote_literal(:p1) || '::uuid');
select pg_temp.become_owner();

update private.billing_config set enforce_active = false;

-- --- Structural invariants ------------------------------------------------
-- Not per-persona: properties of the schema that must hold for the whole model
-- to mean anything.
insert into rls_results
select 'structural','—','every public table has RLS enabled','0',
       coalesce(string_agg(c.relname, ', '), '0'), count(*) = 0
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

insert into rls_results
select 'structural','—','no policy grants anything to anon','0',
       coalesce(string_agg(tablename || '.' || policyname, ', '), '0'), count(*) = 0
from pg_policies where schemaname='public' and 'anon' = any(roles);

insert into rls_results
select 'structural','—','service-role-only functions not executable by authenticated','0',
       coalesce(string_agg(p.proname, ', '), '0'), count(*) = 0
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('campaign_entitlements','account_deletion_targets',
                    'lapse_sweep_targets','record_lapse_warning','refresh_lapse_state')
  and has_function_privilege('authenticated', p.oid, 'execute');

insert into rls_results
select 'structural','—','every content write policy consults the read-only lock','0',
       coalesce(string_agg(tablename || '.' || policyname, ', '), '0'), count(*) = 0
from pg_policies
where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE')
  and coalesce(qual,'') not like '%campaign_is_active%'
  and coalesce(with_check,'') not like '%campaign_is_active%'
  and coalesce(qual,'') not like '%_can_write%'
  and coalesce(with_check,'') not like '%_can_write%'
  -- The five documented exclusions (migration 0049): creating a campaign,
  -- managing one, leaving one, revoking an invite, editing your own profile.
  and (tablename, policyname) not in (
    ('campaigns','campaigns_insert_own'),
    ('campaigns','campaigns_update_dm'),
    ('campaign_members','campaign_members_delete_self_or_dm'),
    ('invite_codes','invite_codes_delete_dm'),
    ('profiles','profiles_update_own')
  );

-- is_dev_account() must take NO argument: a one-arg version could be used to
-- probe whether any given account is on the list.
insert into rls_results
select 'structural','—','is_dev_account() takes no argument (cannot probe others)','0',
       coalesce(string_agg(pg_get_function_identity_arguments(p.oid), '; '), '0'),
       count(*) = 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_dev_account'
  and pg_get_function_identity_arguments(p.oid) <> '';

insert into rls_results
select 'structural','—','dev_accounts has zero policies','0',
       coalesce(string_agg(policyname, ', '), '0'), count(*) = 0
from pg_policies where schemaname = 'private' and tablename = 'dev_accounts';

insert into rls_results
select 'structural','—','locked tables still have zero policies','0',
       coalesce(string_agg(tablename, ', '), '0'), count(*) = 0
from pg_policies where schemaname='public'
  and tablename in ('trial_redemptions','deleted_accounts','orphaned_subscriptions');

-- ===========================================================================
-- REPORT + VERDICT
-- ===========================================================================
\echo ''
\echo '================== RLS MATRIX =================='
select area, persona, assertion, expected, actual, case when ok then 'PASS' else '*** FAIL ***' end as result
from rls_results order by area, persona, assertion;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed
from rls_results;

do $$
declare v_failed int; v_detail text;
begin
  select count(*), string_agg(area || '/' || persona || ': ' || assertion || ' (expected ' || expected || ', got ' || actual || ')', E'\n  ')
    into v_failed, v_detail
  from rls_results where not ok;
  if v_failed > 0 then
    -- Aborts the transaction, so the fixtures roll back too, and exits psql
    -- non-zero under ON_ERROR_STOP so the migrate deploy fails.
    raise exception E'RLS MATRIX FAILED — % assertion(s):\n  %', v_failed, v_detail;
  end if;
  raise notice 'RLS matrix OK — all assertions passed';
end $$;

-- Success path. Fixtures never persist.
rollback;
