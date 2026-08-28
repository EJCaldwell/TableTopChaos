-- ============================================================================
-- 0047_username_filter_letters_only.sql — compare usernames by their LETTERS.
--
-- OWNER REQUEST (2026-08-27): "make it so the underscore is also not allowed for
-- the swear block — make it track just letters, and if the letters spell out a
-- swear it gets blocked."
--
-- So normalisation strips everything that is not a letter, then matches:
--   f_u_c_k     -> fuck      -> BLOCKED
--   F.U.C.K     -> fuck      -> BLOCKED
--   Fuck123     -> fuck      -> BLOCKED
--   xXfuckXx    -> xxfuckxx  -> BLOCKED (contains it)
--   sh1t        -> sht       -> allowed (the digit is gone, so the letters do
--                              not spell it — consistent with "creative is fine")
--
-- THE COST, STATED UP FRONT: removing separators JOINS words that were apart,
-- and the join can spell something the name never contained. The real example
-- found while testing this migration:
--
--     Magic_Untold  ->  magicuntold  ->  contains "cunt"  ->  BLOCKED
--
-- Nobody wrote a swear there; `magi(cunt)old` appeared when the underscore was
-- removed. This is the same class of problem as Scunthorpe, but worse, because
-- it cannot be predicted from reading the name — the words are innocent and only
-- their junction is not. It is an accepted consequence of matching by letters,
-- not a defect to be surprised by later.
--
-- The mitigation is the one already in place: `private.allowed_username_terms`
-- is a TABLE, so a false positive is fixed with one INSERT and no deploy. Anyone
-- who reports "it won't let me use my name" gets unblocked in seconds.
-- ============================================================================

create or replace function private.normalize_username(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Letters only: case folded, with digits, underscores and punctuation removed
  -- so the LETTERS are what gets compared (0047).
  --
  -- Deliberately does not fold digits to lookalike letters — `sh1t` becomes
  -- `sht` and passes. That is the owner's line: block a swear that is actually
  -- spelled out, ignore creative respellings (0046).
  select regexp_replace(lower(coalesce(p_name, '')), '[^a-z]', '', 'g');
$$;

comment on function private.normalize_username(text) is
  'Reduces a username to its LETTERS (lower case, digits/underscores/punctuation '
  'removed) for blocklist comparison. Blocks f_u_c_k and Fuck123; allows sh1t. '
  'Note this JOINS words across separators, which can spell a term the name did '
  'not contain (Magic_Untold -> magicuntold -> "cunt") — fix those by adding to '
  'private.allowed_username_terms. See 0047.';

-- The allowlist is matched on the normalised form, so its entries must be
-- letters-only too. They already are; this is here so the invariant is asserted
-- rather than assumed.
do $$
declare v_bad text;
begin
  select string_agg(term, ', ') into v_bad
  from private.allowed_username_terms
  where term <> regexp_replace(lower(term), '[^a-z]', '', 'g');
  if v_bad is not null then
    raise exception 'allowed_username_terms must be letters-only, found: %', v_bad;
  end if;

  select string_agg(term, ', ') into v_bad
  from private.blocked_username_terms
  where term <> regexp_replace(lower(term), '[^a-z]', '', 'g');
  if v_bad is not null then
    raise exception 'blocked_username_terms must be letters-only, found: %', v_bad;
  end if;
end $$;

-- The one real false positive found while testing this change. Added now rather
-- than waiting for somebody to hit it.
--
-- Only real cases belong here. A list padded with hypothetical junctions would
-- rot and would obscure the entries that were added for an actual reason.
insert into private.allowed_username_terms (term, reason) values
  ('magicuntold', 'Magic_Untold — "cunt" appears only at the word junction')
on conflict (term) do nothing;
