-- ===========================================================================
-- Migration 0004 — Let campaign co-members read each other's profiles.
--
-- Until now profiles were readable only by their owner (0002). But a campaign
-- roster / party view needs to show the display name + avatar of the OTHER
-- members you share a campaign with. This adds a second, additive SELECT policy
-- on profiles: you may read a profile if you share at least one campaign with
-- that user. (RLS policies for the same command are OR-ed, so own-profile reads
-- from 0002 still work.)
--
-- The overlap test is a SECURITY DEFINER helper in the private schema so it can
-- read campaign_members without tripping that table's own RLS, and so it never
-- becomes an exposed REST RPC (advisors stay clean).
-- ===========================================================================

-- True if the current user and p_other are both members of some common
-- campaign. Answers only about the caller's relationships → no data leak.
create or replace function private.shares_campaign_with(p_other uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members me
    join public.campaign_members them
      on them.campaign_id = me.campaign_id
    where me.user_id = (select auth.uid())
      and them.user_id = p_other
  );
$$;

comment on function private.shares_campaign_with(uuid) is
  'True if the current user shares at least one campaign with p_other. Used to widen profile visibility to co-members.';

grant execute on function private.shares_campaign_with(uuid) to authenticated;

-- Additive read policy: co-members can see each other's profile row.
create policy "profiles_select_comembers"
  on public.profiles
  for select
  to authenticated
  using ( private.shares_campaign_with(id) );

comment on policy "profiles_select_comembers" on public.profiles is
  'A profile is also readable by anyone who shares a campaign with that user (roster/party view).';
