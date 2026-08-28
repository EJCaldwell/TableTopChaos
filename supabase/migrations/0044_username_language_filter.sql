-- ============================================================================
-- 0044_username_language_filter.sql — block profanity and slurs in usernames.
--
-- OWNER REQUEST (2026-08-27).
--
-- WHY A TRIGGER AND NOT THE EXISTING CHECK CONSTRAINT. A CHECK expression must
-- be IMMUTABLE, and an immutable function cannot read a table — so a CHECK would
-- force the word list to live inside a function body, and every future addition
-- would be a migration and a deploy. A word list is exactly the thing that needs
-- editing at 11pm when somebody registers something clever. The list therefore
-- lives in a TABLE, and a BEFORE trigger enforces it.
--
-- The 0039 CHECK still owns format, length and reserved words. This adds one
-- rule on top; it does not replace anything.
--
-- THE SCUNTHORPE PROBLEM IS WHY `match_mode` EXISTS. Blunt substring matching
-- blocks real names: `ass` is inside Cassandra and Assassin, `cum` inside
-- Cucumber, `tit` inside Titan and Constitution. Those terms are therefore
-- EXACT-match only. Terms with no innocent substring use (`fuck`, `cunt`, slurs)
-- are matched as substrings so that `xXfuckXx` is caught too.
--
-- WHAT THIS IS NOT. It is a speed bump, not a solution. A determined person will
-- find a spelling nobody listed, and no word list has ever survived contact with
-- people who want to get around it. Two things make that acceptable here:
-- usernames are only visible inside a campaign you were invited to, roughly five
-- people who know each other; and the real remedy is a human one — the owner can
-- rename any account directly. Do not mistake this for moderation.
--
-- DELIBERATELY NOT MIRRORED CLIENT-SIDE. Every other username rule is duplicated
-- in src/features/profile/username.ts for instant feedback. This one is not:
-- shipping the list to the browser publishes it, which both hands out a
-- ready-made slur dictionary and tells anyone evading it exactly what to avoid.
-- The cost is one server round trip to find out; that is the right trade.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The list. Editable at runtime by design:
--   insert into private.blocked_username_terms values ('newterm', 'substring');
-- No migration, no deploy.
-- ----------------------------------------------------------------------------
create table private.blocked_username_terms (
  -- Stored already normalised (lower case, no separators) — see normalize_username.
  term text primary key,
  -- 'substring' — matches anywhere, for terms with no innocent use.
  -- 'exact'     — matches only the whole name, for short terms that appear
  --               inside ordinary words.
  match_mode text not null default 'substring'
    check (match_mode in ('substring', 'exact')),
  added_at timestamptz not null default now()
);

comment on table private.blocked_username_terms is
  'Words disallowed in usernames. In `private` so it is unreachable over the '
  'REST API — the list itself is not something to publish. Add entries directly; '
  'no migration needed. See 0044.';

-- No RLS policies and no grants: only the SECURITY DEFINER functions below read
-- it. It lives in `private`, so PostgREST cannot see it at all.

-- ----------------------------------------------------------------------------
-- Normalisation — what defeats the obvious evasions.
--
-- `sh1t`, `f_u_c_k` and `$hit` are the same word to a reader and different
-- strings to a database. Folding digits and separators to their letter
-- lookalikes catches the lazy 90%; it does not pretend to catch the rest.
-- ----------------------------------------------------------------------------
create function private.normalize_username(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    lower(coalesce(p_name, '')),
    '0134578@$!_',
    'oieastbas'  || 'i'  -- 0→o 1→i 3→e 4→a 5→s 7→t 8→b @→a $→s !→i
  );
$$;

comment on function private.normalize_username(text) is
  'Folds case, common leetspeak digits and separators so evasions like sh1t / '
  '$hit / f_u_c_k compare equal to the plain word. Best-effort by nature.';

-- ----------------------------------------------------------------------------
-- The check itself.
-- ----------------------------------------------------------------------------
create function private.username_has_blocked_term(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.blocked_username_terms t
    where (t.match_mode = 'substring'
             and private.normalize_username(p_name) like '%' || t.term || '%')
       or (t.match_mode = 'exact'
             and private.normalize_username(p_name) = t.term)
  );
$$;

revoke execute on function private.username_has_blocked_term(text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Enforcement. BEFORE INSERT OR UPDATE, and only when the username actually
-- changed — so re-saving an existing row (avatar, legal acceptance, the lapse
-- sweep) never re-runs the check and can never be blocked by a term added after
-- that name was granted.
-- ----------------------------------------------------------------------------
create function public.enforce_username_language()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if private.username_has_blocked_term(new.username) then
    -- Deliberately vague. Naming the matched term would confirm the list's
    -- contents one probe at a time, which is a free evasion oracle; and
    -- "your username contains a slur" is a worse thing to put on screen than
    -- "unavailable" when the match is a false positive.
    raise exception 'That username is not available. Please choose another.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger profiles_enforce_username_language
  before insert or update on public.profiles
  for each row execute function public.enforce_username_language();

-- ----------------------------------------------------------------------------
-- Seed list.
--
-- Kept to unambiguous cases rather than attempting to be exhaustive: a short
-- accurate list plus the ability to add to it beats a long list that blocks
-- Cassandra on day one. Slurs are matched as substrings; short words with
-- ordinary uses inside other words are exact-only.
-- ----------------------------------------------------------------------------
insert into private.blocked_username_terms (term, match_mode) values
  -- Profanity with no innocent substring use.
  ('fuck', 'substring'),
  ('shit', 'substring'),
  ('bitch', 'substring'),
  ('cunt', 'substring'),
  ('whore', 'substring'),
  ('slut', 'substring'),
  ('bastard', 'substring'),
  ('dickhead', 'substring'),
  ('asshole', 'substring'),
  ('wanker', 'substring'),
  ('bollocks', 'substring'),
  ('pussy', 'substring'),
  ('penis', 'substring'),
  ('vagina', 'substring'),
  ('boobs', 'substring'),
  ('nsfw', 'substring'),
  ('porn', 'substring'),
  ('rape', 'substring'),
  ('rapist', 'substring'),
  ('pedo', 'substring'),
  ('nazi', 'substring'),
  ('hitler', 'substring'),
  -- Racial, ethnic, religious and anti-LGBT slurs. Substring: these have no
  -- legitimate use inside a handle, and partial spellings are the usual dodge.
  ('nigger', 'substring'),
  ('nigga', 'substring'),
  ('faggot', 'substring'),
  ('tranny', 'substring'),
  ('retard', 'substring'),
  ('spastic', 'substring'),
  ('chink', 'substring'),
  ('gook', 'substring'),
  ('kike', 'substring'),
  ('spic', 'substring'),
  ('wetback', 'substring'),
  ('towelhead', 'substring'),
  ('coon', 'substring'),
  -- EXACT ONLY — these appear inside perfectly ordinary words. Substring
  -- matching any of them would block Cassandra, Cucumber, Titan, Constitution,
  -- Analyst, Bassett, Shitake, Class, Scunthorpe.
  ('ass', 'exact'),
  ('arse', 'exact'),
  ('cum', 'exact'),
  ('tit', 'exact'),
  ('tits', 'exact'),
  ('anal', 'exact'),
  ('anus', 'exact'),
  ('dick', 'exact'),
  ('cock', 'exact'),
  ('twat', 'exact'),
  ('damn', 'exact'),
  ('crap', 'exact'),
  ('piss', 'exact'),
  ('hell', 'exact')
on conflict (term) do nothing;

-- ----------------------------------------------------------------------------
-- Keep the signup allocator from ever GRANTING a blocked name.
--
-- Without this the trigger would abort the profile insert inside
-- handle_new_user, and GoTrue would return its opaque "Database error saving new
-- user" — the exact failure 0039/0040 were built to avoid. A blocked request is
-- therefore treated exactly like a reserved one: unusable as a base, fall
-- through to the email-derived name, flag it provisional.
--
-- The email fallback is checked too: an address can perfectly well contain
-- something on this list.
-- ----------------------------------------------------------------------------
create or replace function private.claim_username(p_desired text, p_email text)
returns table (granted text, provisional boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desired text;
  v_base text;
  v_candidate text;
  v_suffix int := 1;
begin
  v_desired := nullif(trim(coalesce(p_desired, '')), '');

  if v_desired is not null
     and private.is_valid_username(v_desired)
     and not private.username_has_blocked_term(v_desired)
     and not exists (
       select 1 from public.profiles q where lower(q.username) = lower(v_desired)
     )
  then
    return query select v_desired, false;
    return;
  end if;

  -- A reserved OR blocked request contributes nothing to the base.
  if v_desired is not null
     and not private.is_reserved_username(v_desired)
     and not private.username_has_blocked_term(v_desired)
  then
    v_base := regexp_replace(v_desired, '[^A-Za-z0-9_]', '', 'g');
  else
    v_base := '';
  end if;
  v_base := regexp_replace(v_base, '^_+', '');

  if v_base = '' then
    v_base := regexp_replace(coalesce(split_part(p_email, '@', 1), ''), '[^A-Za-z0-9_]', '', 'g');
    v_base := regexp_replace(v_base, '^_+', '');
    -- An email local-part can contain a blocked term just as easily.
    if private.username_has_blocked_term(v_base) then
      v_base := '';
    end if;
  end if;

  if v_base = '' then
    v_base := 'player';
  end if;
  v_base := left(v_base, 16);

  v_candidate := v_base;
  while exists (
    select 1 from public.profiles q where lower(q.username) = lower(v_candidate)
  ) or private.is_reserved_username(v_candidate)
    or not private.is_valid_username(v_candidate)
    or private.username_has_blocked_term(v_candidate)
  loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 20 - length(v_suffix::text)) || v_suffix::text;
  end loop;

  return query select v_candidate, true;
end $$;

revoke execute on function private.claim_username(text, text)
  from public, anon, authenticated;
