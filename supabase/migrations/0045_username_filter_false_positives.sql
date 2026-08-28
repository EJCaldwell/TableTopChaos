-- ============================================================================
-- 0045_username_filter_false_positives.sql — stop the language filter blocking
-- real words and real names.
--
-- FOUND 2026-08-27, immediately, by testing the filter against names that
-- SHOULD pass rather than only against ones that should fail:
--     Scunthorpe  -> blocked (contains "cunt")
--     Shitake     -> blocked (contains "shit")
-- The literal Scunthorpe problem, on the first run. Worth stating plainly: had
-- the test only checked that `FuckFace` was rejected, this would have shipped
-- and the first report would have come from a user who could not register their
-- own surname.
--
-- Reviewing the rest of the substring list for the same fault found four more
-- that had not been tested and would have bitten later:
--   * `rape`  is inside Grape and Drape          -> demoted to exact
--   * `coon`  is inside Raccoon, Tycoon, Cooney  -> demoted to exact
--   * `spic`  is inside Spicy and Suspicion      -> demoted to exact
--   * `nazi`  is inside Nazir, Nazia, Nazim, Shahnaz — common given names —
--             but demoting it would let `grammarnazi` through, so it stays a
--             substring match and those names are allowlisted instead.
-- `rapist` stays a substring: no innocent word contains it, so demoting `rape`
-- costs nothing against the case that matters.
--
-- TWO MECHANISMS, BECAUSE ONE IS NOT ENOUGH. Demoting to exact fixes terms whose
-- innocent uses are open-ended (anything containing "coon"). An allowlist fixes
-- the opposite shape: a term that genuinely should match anywhere, with a small
-- known set of real words that contain it. Neither alone would do.
--
-- STILL BEST-EFFORT. `Scunthorpe_Fan` remains blocked — the allowlist is an
-- exact match, and doing better needs word-boundary analysis that a handle with
-- no spaces cannot support. That is a deliberate stopping point, not an
-- oversight: the escape hatch is that both lists are TABLES, so the fix for the
-- next false positive is one INSERT, not a migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Allowlist. Checked FIRST, and wins outright.
-- ----------------------------------------------------------------------------
create table private.allowed_username_terms (
  -- Normalised, whole-name match (see private.normalize_username).
  term text primary key,
  -- Why it is here, so a future reader does not delete it as noise.
  reason text,
  added_at timestamptz not null default now()
);

comment on table private.allowed_username_terms is
  'Names that would otherwise trip the blocked-term filter. Exact match on the '
  'normalised name, checked before the blocklist. Add an entry when a real word '
  'or surname is caught — no migration needed. See 0045.';

insert into private.allowed_username_terms (term, reason) values
  ('scunthorpe', 'English town; contains "cunt" — the canonical false positive'),
  ('shitake',    'mushroom; contains "shit"'),
  ('shiitake',   'mushroom, correct spelling'),
  ('penistone',  'English town; contains "penis"'),
  ('clitheroe',  'English town'),
  ('lightwater', 'place name'),
  ('nazir',      'given name; contains "nazi"'),
  ('nazia',      'given name'),
  ('nazim',      'given name'),
  ('nazish',     'given name'),
  ('shahnaz',    'given name'),
  ('cockburn',   'surname'),
  ('assange',    'surname'),
  ('cummings',   'surname'),
  ('cumbria',    'English county')
on conflict (term) do nothing;

-- ----------------------------------------------------------------------------
-- Demote the four substring terms with open-ended innocent uses.
-- ----------------------------------------------------------------------------
update private.blocked_username_terms
   set match_mode = 'exact'
 where term in ('rape', 'coon', 'spic');

-- `rape` was not in the original seed as its own entry; ensure it exists so the
-- exact form is still caught on its own.
insert into private.blocked_username_terms (term, match_mode)
values ('rape', 'exact')
on conflict (term) do update set match_mode = 'exact';

-- ----------------------------------------------------------------------------
-- Consult the allowlist first.
-- ----------------------------------------------------------------------------
create or replace function private.username_has_blocked_term(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- An allowlisted name is permitted outright, whatever it contains.
    when exists (
      select 1 from private.allowed_username_terms a
      where a.term = private.normalize_username(p_name)
    ) then false
    else exists (
      select 1
      from private.blocked_username_terms t
      where (t.match_mode = 'substring'
               and private.normalize_username(p_name) like '%' || t.term || '%')
         or (t.match_mode = 'exact'
               and private.normalize_username(p_name) = t.term)
    )
  end;
$$;

revoke execute on function private.username_has_blocked_term(text)
  from public, anon, authenticated;
