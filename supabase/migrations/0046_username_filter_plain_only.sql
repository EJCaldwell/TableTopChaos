-- ============================================================================
-- 0046_username_filter_plain_only.sql — narrow the language filter to what the
-- owner actually asked for, and say "not allowed" when it fires.
--
-- OWNER CLARIFICATION (2026-08-27): *"I just don't want swears out in the open.
-- If people get creative with them it's fine — but if there is just a swear, and
-- they wanted it just because the name has a swear, then block it."*
--
-- 0044 went further than that. It folded leetspeak and separators, so `sh1t`,
-- `$hit` and `f_u_c_k` were all treated as the plain word. That is chasing
-- evasion, which the owner has explicitly said is out of scope — and chasing
-- evasion is what generates false positives, because every fold makes more
-- innocent strings collide with the list.
--
-- SO: normalisation is now CASE ONLY.
--   `FuckFace`  -> still blocked (a swear, in the open)
--   `sh1t`      -> now ALLOWED (creative; deliberately not our problem)
--   `f_u_c_k`   -> now ALLOWED
--   `$hitlord`  -> now ALLOWED
-- That is a real loosening and it is intentional. It is recorded here so nobody
-- later reads `sh1t` passing as a bug and "fixes" it back.
--
-- Substring matching stays for unambiguous terms, so `FuckFace` and `xXcuntXx`
-- are still caught — a swear stuck to another word is still a swear in the open.
-- The 0045 allowlist stays with it, because `Scunthorpe` still contains `cunt`
-- however little folding is done.
--
-- The message also changes. "Not available" reads like "someone has it" — which
-- sends the user off trying variations of a name that will never be accepted.
-- "Not allowed" says it is the name, not the timing. It still does not name the
-- matched word: doing so would confirm the list one probe at a time.
-- ============================================================================

create or replace function private.normalize_username(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Case only. The digit/symbol folding that used to live here was removed in
  -- 0046 on purpose — see the header. Do not reinstate it without checking
  -- whether the owner still wants evasion chased, and re-running the
  -- false-positive matrix if so.
  select lower(coalesce(p_name, ''));
$$;

comment on function private.normalize_username(text) is
  'Case-folds a username for list comparison. Deliberately does NOT fold '
  'leetspeak or separators (0046): the policy is to block plain swears, not to '
  'chase creative spellings.';

create or replace function public.enforce_username_language()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when the username actually changes. profiles is also written by the
  -- avatar upload, legal acceptance and the lapse sweep; without this, a term
  -- added to the list later would start failing writes on rows that have held
  -- their name for months.
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if private.username_has_blocked_term(new.username) then
    raise exception 'That username isn''t allowed. Please choose another.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
