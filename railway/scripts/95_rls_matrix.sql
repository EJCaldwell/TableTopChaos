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

-- --- Locked tables: nobody, ever ------------------------------------------
-- RLS enabled with NO policies. These hold anti-abuse and erasure records; a
-- policy appearing on any of them is a bug, not a feature.
select pg_temp.become(:dm::uuid);
select pg_temp.assert_rows('locked','DM','trial_redemptions invisible','select 1 from public.trial_redemptions', 0);
select pg_temp.assert_rows('locked','DM','deleted_accounts invisible','select 1 from public.deleted_accounts', 0);
select pg_temp.assert_rows('locked','DM','orphaned_subscriptions invisible','select 1 from public.orphaned_subscriptions', 0);
select pg_temp.become_owner();

-- --- Anonymous ------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', null, true);
select pg_temp.assert_rows('anon','anon','sees no campaigns','select 1 from public.campaigns', 0);
select pg_temp.assert_rows('anon','anon','sees no profiles','select 1 from public.profiles', 0);
select pg_temp.assert_rows('anon','anon','sees no characters','select 1 from public.characters', 0);
select pg_temp.assert_rows('anon','anon','sees no journals','select 1 from public.journal_entries', 0);
select pg_temp.assert_rows('anon','anon','sees no DM notes','select 1 from public.dm_notes', 0);
select pg_temp.assert_denied('anon','anon','cannot create a campaign','insert into public.campaigns (name,owner_id) values (''anon camp'',' || quote_literal(:dm) || '::uuid)');
reset role;
select set_config('request.jwt.claims', null, true);

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
