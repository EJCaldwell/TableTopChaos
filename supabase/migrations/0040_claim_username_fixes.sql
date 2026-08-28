-- ============================================================================
-- 0040_claim_username_fixes.sql — two defects in 0039's signup allocator.
--
-- Found 2026-08-27 by exercising private.claim_username directly, before any
-- signup used it.
--
-- DEFECT 1 — RESERVED WORDS WERE ONLY ONE DIGIT AWAY.
--   claim_username('admin', …)  →  'admin2'
-- The reserved check ran on the CANDIDATE, so a reserved word was rejected and
-- then immediately used as the BASE for the suffix loop. Someone asking for
-- `admin` was handed `admin2`, which is exactly the impersonation the reserved
-- list exists to prevent — the list stops the literal string and nothing else.
-- Fix: a reserved request makes the base unusable, so it falls through to the
-- email-derived base like any other garbage input.
--
-- DEFECT 2 — SHORT NAMES LOST THE USER'S INTENT.
--   claim_username('ab', …)  →  'player'
-- Anything under 3 characters was discarded wholesale and replaced with the
-- generic fallback. But the suffix loop already produces legal names from short
-- bases ('ab' → 'ab2'), so throwing the input away was gratuitous: the user gets
-- an unrecognisable handle where a near-miss of what they asked for was
-- available. Fix: keep any non-empty sanitized base and let the loop extend it.
--
-- Neither defect could affect an existing row — 0039's backfill uses its own
-- inline logic and had already run. This changes signups from here on.
-- ============================================================================

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

  -- The happy path: legal, unreserved, and nobody holds it.
  if v_desired is not null
     and private.is_valid_username(v_desired)
     and not exists (
       select 1 from public.profiles q where lower(q.username) = lower(v_desired)
     )
  then
    return query select v_desired, false;
    return;
  end if;

  -- Otherwise build a base. A RESERVED request contributes nothing — deriving
  -- from it is what produced 'admin' → 'admin2'. Strip to legal characters, and
  -- keep whatever survives even if it is only one or two characters: the loop
  -- below extends it to a legal length, which preserves more of what the user
  -- asked for than falling straight through to 'player'.
  if v_desired is not null and not private.is_reserved_username(v_desired) then
    v_base := regexp_replace(v_desired, '[^A-Za-z0-9_]', '', 'g');
  else
    v_base := '';
  end if;

  -- Must begin with a letter or digit; a leading-underscore base can never
  -- become legal by suffixing, so trim the leading underscores first.
  v_base := regexp_replace(v_base, '^_+', '');

  if v_base = '' then
    v_base := regexp_replace(coalesce(split_part(p_email, '@', 1), ''), '[^A-Za-z0-9_]', '', 'g');
    v_base := regexp_replace(v_base, '^_+', '');
  end if;

  if v_base = '' then
    v_base := 'player';
  end if;
  v_base := left(v_base, 16);

  -- First free, legal, unreserved variant. `not is_valid_username` in the
  -- condition is what lengthens a 1–2 character base rather than rejecting it.
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

revoke execute on function private.claim_username(text, text)
  from public, anon, authenticated;
