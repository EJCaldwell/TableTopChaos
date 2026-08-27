-- ============================================================================
-- 0035_legal_acceptance.sql — record which version of the policies each user
-- accepted, and when (Phase 7.2.1).
--
-- WHY VERSIONED rather than a boolean. "They ticked a box once" is not evidence
-- of anything a year later, when the terms have changed twice. Storing the
-- version means you can answer "what exactly did this person agree to?" and can
-- re-prompt only the users who have not seen a material update — rather than
-- re-prompting everyone, or nobody.
--
-- The version string lives in the FRONTEND (src/features/legal/legalConfig.ts)
-- and is written here on acceptance. Deliberately not a foreign key to a
-- versions table: the documents are static files in the repo, and inventing a
-- table to mirror them would add a synchronisation problem without adding a
-- guarantee.
--
-- Acceptance is recorded through an RPC rather than a plain profile UPDATE so
-- the timestamp is stamped SERVER-SIDE. A client-supplied timestamp is worthless
-- as a record — it is the one field a user could backdate, and it is the field
-- that matters if acceptance is ever disputed.
-- ============================================================================

alter table public.profiles
  add column if not exists legal_version_accepted text,
  add column if not exists legal_accepted_at      timestamptz;

comment on column public.profiles.legal_version_accepted is
  'Version string of the Terms/Privacy the user accepted, from '
  'src/features/legal/legalConfig.ts. NULL = never accepted (pre-7.2 accounts).';
comment on column public.profiles.legal_accepted_at is
  'When acceptance was recorded. Stamped server-side by '
  'public.record_legal_acceptance() — never client-supplied.';

-- ---------------------------------------------------------------------------
-- record_legal_acceptance(p_version) — record that the CALLING user accepted
-- the given policy version, as of now.
--
-- Takes no user id and reads auth.uid(), so it cannot be aimed at another
-- account. SECURITY DEFINER only so the timestamp cannot be forged; the row it
-- touches is still the caller's own.
--
-- Idempotent by nature: accepting the same version again simply re-stamps the
-- time, which is harmless and avoids the client needing to check first.
-- ---------------------------------------------------------------------------
create or replace function public.record_legal_acceptance(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_version is null or length(trim(p_version)) = 0 then
    raise exception 'A policy version is required.';
  end if;

  update public.profiles
     set legal_version_accepted = p_version,
         legal_accepted_at      = now()
   where id = auth.uid();
end;
$$;

comment on function public.record_legal_acceptance(text) is
  'Phase 7.2: records the CALLING user''s acceptance of a policy version, '
  'timestamped server-side. Reads auth.uid() so it cannot be aimed at another '
  'account.';

-- Callable by signed-in users only. Revoked from anon and PUBLIC BY NAME —
-- `revoke ... from public` alone does NOT restrict a function here, because
-- default privileges grant execute to anon/authenticated at creation time (see
-- migration 0031 and railway/scripts/90_grant_app_privileges.sql).
--
-- NOT added to the service-role-only list in the grant sweep: this function
-- reads auth.uid() and can only ever touch the caller's own row, so
-- `authenticated` is exactly the right grant.
revoke execute on function public.record_legal_acceptance(text) from public, anon;
grant  execute on function public.record_legal_acceptance(text) to authenticated;
