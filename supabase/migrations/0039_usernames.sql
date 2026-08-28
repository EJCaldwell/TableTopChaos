-- ============================================================================
-- 0039_usernames.sql — Phase 7.4.1: display_name → a required, globally unique
-- username.
--
-- OWNER DECISION (2026-08-17). The trade-off is real and is recorded in
-- PLANNING so it is not rediscovered as a surprise: a username identifies
-- nothing in this app today (you join by invite code; there is no search, no
-- @mentions, no directory), so global uniqueness charges every signup some
-- friction to solve a problem that only exists inside a ~5-person campaign. It
-- is done now because retrofitting unique-and-required onto real accounts means
-- forcing a rename on strangers — cheap today, rude later.
--
-- The concrete win: display_name is nullable and usually NULL, so the roster
-- renders most members as "Unnamed adventurer". That, not two Alexes, is the
-- collision users actually hit.
--
-- ORDER MATTERS AND IS NOT NEGOTIABLE. NOT NULL and UNIQUE cannot be applied
-- while rows are null or colliding, so this migration is strictly:
--   1. rename            2. add the provisional flag
--   3. BACKFILL every row into a legal, unique value
--   4. only then: CHECK constraints, the unique index, NOT NULL
--   5. finally: the signup trigger, which depends on the helpers above
-- Any other order fails on live data.
--
-- CASE-INSENSITIVE UNIQUENESS. The index is on lower(username); a plain unique
-- index would let `alex` and `Alex` coexist and achieve nothing. The column
-- still stores the casing the user typed — `AlexC` should render as `AlexC`,
-- it just cannot be claimed twice.
--
-- NO AVAILABILITY-CHECK RPC, DELIBERATELY. profiles is readable only by
-- yourself and your co-members (0002 + 0004), so nobody can enumerate who
-- exists. A SECURITY DEFINER `username_available()` would work and would undo
-- exactly that. Callers instead attempt the write and handle SQLSTATE 23505.
-- That is still a narrow oracle — an authenticated user can probe one name per
-- request — but it is authenticated, rate-limited by being a write, and reveals
-- only that a handle is taken, never an email address.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rename. A rename rather than a new column + copy: the data is the same
-- data, and a copy would leave two columns to keep in sync during the window
-- where both exist.
-- ----------------------------------------------------------------------------
alter table public.profiles rename column display_name to username;

-- ----------------------------------------------------------------------------
-- 2. The provisional flag.
--
-- Every account must end this migration with a legal unique username, but most
-- existing ones never chose a name at all — theirs is generated. This marks
-- those rows so the UI can prompt for a real one, and so "backfilled" is a
-- queryable fact rather than something inferred from the shape of a string.
--
-- It is also set at SIGNUP when a requested name was already taken (see
-- claim_username below), which is what lets signup never fail on a collision.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column username_is_provisional boolean not null default false;

comment on column public.profiles.username_is_provisional is
  'True when the username was generated rather than chosen — either backfilled '
  'by migration 0039, or assigned at signup because the requested name was '
  'taken. The UI prompts these users to pick their own.';

-- ----------------------------------------------------------------------------
-- 3. The rules, as functions, so the constraint and the generator cannot drift.
-- ----------------------------------------------------------------------------

-- Reserved handles. Anything that could let an account impersonate the service
-- or a role, plus the words a future route or @mention would want. Cheap to
-- reserve now; impossible to reclaim once somebody holds it.
create function private.is_reserved_username(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_name) = any (array[
    'admin', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
    'moderator', 'mod', 'staff', 'team', 'official', 'security', 'abuse',
    'billing', 'payments', 'noreply', 'no-reply', 'postmaster', 'webmaster',
    'api', 'www', 'app', 'auth', 'login', 'signup', 'settings', 'profile',
    'campaign', 'campaigns', 'dm', 'gm', 'tabletopchaos', 'ttc',
    'me', 'you', 'everyone', 'anyone', 'anonymous', 'deleted', 'null',
    'undefined', 'none', 'unknown', 'guest'
  ]);
$$;

comment on function private.is_reserved_username(text) is
  'Handles nobody may claim. IMMUTABLE so it can be used in a CHECK constraint. '
  'Adding a name here does NOT retroactively free an existing row — check for '
  'holders before extending the list.';

-- Format rule, in one place so the UI, the generator and the constraint agree.
--   * 3–20 characters — long enough to be distinctive, short enough to fit a
--     roster line next to a character name.
--   * letters, digits and underscore only. No dots, hyphens or spaces:
--     `alex.c` / `alex-c` / `alex c` are the classic near-miss impersonation
--     trio, and excluding them costs nothing before anyone has a handle.
--   * must start with a letter or digit, so a name cannot lead with `_` and
--     sort or read oddly.
create function private.is_valid_username(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name ~ '^[A-Za-z0-9][A-Za-z0-9_]{2,19}$'
     and not private.is_reserved_username(p_name);
$$;

comment on function private.is_valid_username(text) is
  'Format + reserved-word rule for usernames. The single source of truth: the '
  'CHECK constraint, the backfill and the signup trigger all call this.';

-- Both are needed by `authenticated`, not just the first: the CHECK constraint
-- is evaluated as the CURRENT user, is_valid_username is not SECURITY DEFINER,
-- so its nested call to is_reserved_username also runs as that user. Granting
-- only the outer one would make every profile UPDATE fail with "permission
-- denied for function is_reserved_username" — from a constraint, which is not
-- where anyone would think to look.
grant execute on function private.is_valid_username(text) to authenticated;
grant execute on function private.is_reserved_username(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. BACKFILL — before any constraint exists.
--
-- Three groups need fixing, and they overlap: rows with no name at all, rows
-- whose existing name breaks the new format, and rows that collide with another
-- row case-insensitively. Handling them in one pass, ordered by created_at so
-- the OLDEST account keeps the plain form of a contested name — arbitrary, but
-- stable and defensible, and better than whichever row the planner happened to
-- reach first.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_base text;
  v_candidate text;
  v_suffix int;
begin
  for r in
    select p.id, p.username, u.email::text as email
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at
  loop
    -- Keep an existing name only if it is already legal AND unclaimed. The
    -- claimed-check is against rows already processed in this loop, which is
    -- why the ordering above matters.
    if r.username is not null
       and private.is_valid_username(r.username)
       and not exists (
         select 1 from public.profiles q
         where q.id <> r.id and lower(q.username) = lower(r.username)
       )
    then
      continue;
    end if;

    -- Derive a base: the email local-part, stripped to legal characters. Falls
    -- back to 'player' when there is no usable email (a fixture account, or a
    -- local-part that is entirely punctuation).
    v_base := regexp_replace(coalesce(split_part(r.email, '@', 1), ''), '[^A-Za-z0-9_]', '', 'g');
    v_base := left(v_base, 16);
    if length(v_base) < 3 or v_base !~ '^[A-Za-z0-9]' then
      v_base := 'player';
    end if;

    -- First free variant. Starts bare, then numbers upward. The loop is bounded
    -- only by finding a gap; with a 16-char base and a 4-digit suffix there is
    -- no realistic exhaustion.
    v_candidate := v_base;
    v_suffix := 1;
    while exists (
      select 1 from public.profiles q
      where q.id <> r.id and lower(q.username) = lower(v_candidate)
    ) or private.is_reserved_username(v_candidate)
    loop
      v_suffix := v_suffix + 1;
      v_candidate := left(v_base, 20 - length(v_suffix::text)) || v_suffix::text;
    end loop;

    update public.profiles
       set username = v_candidate,
           -- Generated, not chosen — so the UI asks for a real one.
           username_is_provisional = true
     where id = r.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Constrain. Safe only because step 4 ran.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_username_valid check (private.is_valid_username(username));

alter table public.profiles
  alter column username set not null;

-- Case-insensitive uniqueness. An expression index rather than citext: no
-- extension to install, and it makes the case-folding visible at the point it
-- is enforced instead of hidden in a column type.
create unique index profiles_username_lower_key
  on public.profiles (lower(username));

comment on column public.profiles.username is
  'Required, globally unique handle. Stored with the casing the user typed; '
  'uniqueness is enforced case-insensitively by profiles_username_lower_key, so '
  'alex and Alex cannot both exist. Format: private.is_valid_username.';

-- ----------------------------------------------------------------------------
-- 6. claim_username — pick a free handle at signup, NEVER fail.
--
-- WHY THIS EXISTS. The profile row is created by a trigger on auth.users, so a
-- collision there would abort the INSERT and GoTrue would return an opaque
-- "Database error saving new user" — a signup failed by a race the user cannot
-- see or fix. Instead the trigger always succeeds: it takes the requested name
-- if it is free and legal, otherwise assigns a suffixed variant and marks it
-- provisional. The UI then tells the user their choice was taken and asks them
-- to pick another, with their account already working.
--
-- @returns the granted name, and whether it differs from what was asked for.
-- ----------------------------------------------------------------------------
create function private.claim_username(p_desired text, p_email text)
returns table (granted text, provisional boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix int := 1;
begin
  v_candidate := nullif(trim(coalesce(p_desired, '')), '');

  -- The happy path: they asked for something legal and nobody holds it.
  if v_candidate is not null
     and private.is_valid_username(v_candidate)
     and not exists (
       select 1 from public.profiles q where lower(q.username) = lower(v_candidate)
     )
  then
    return query select v_candidate, false;
    return;
  end if;

  -- Otherwise derive a base from what they asked for, falling back to the email
  -- local-part and then to 'player'. Same rules as the backfill.
  v_base := regexp_replace(coalesce(v_candidate, ''), '[^A-Za-z0-9_]', '', 'g');
  if length(v_base) < 3 or v_base !~ '^[A-Za-z0-9]' then
    v_base := regexp_replace(coalesce(split_part(p_email, '@', 1), ''), '[^A-Za-z0-9_]', '', 'g');
  end if;
  v_base := left(v_base, 16);
  if length(v_base) < 3 or v_base !~ '^[A-Za-z0-9]' then
    v_base := 'player';
  end if;

  v_candidate := v_base;
  while exists (
    select 1 from public.profiles q where lower(q.username) = lower(v_candidate)
  ) or private.is_reserved_username(v_candidate) or not private.is_valid_username(v_candidate)
  loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 20 - length(v_suffix::text)) || v_suffix::text;
  end loop;

  return query select v_candidate, true;
end $$;

-- Not a client RPC: it lives in `private` (unreachable over PostgREST) and is
-- called only by the signup trigger. Exposing it would be an enumeration oracle
-- that answers without even requiring a write.
revoke execute on function private.claim_username(text, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. The signup trigger, replacing the 0002 version.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_granted text;
  v_provisional boolean;
begin
  -- `username` is the new metadata key; `display_name` is still read as a
  -- fallback so a signup issued by an older client (or a cached bundle mid
  -- deploy) does not land with a generated handle for no reason.
  select granted, provisional into v_granted, v_provisional
  from private.claim_username(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      nullif(new.raw_user_meta_data ->> 'display_name', '')
    ),
    new.email::text
  );

  insert into public.profiles (id, username, username_is_provisional)
  values (new.id, v_granted, v_provisional);

  return new;
end;
$$;
