-- ============================================================================
-- 0007_invite_cap_message.sql — clearer "campaign full" message on the player cap.
--
-- redeem_invite_code (from 0005) rejected an over-cap join with a generic
-- "This campaign is full (N player limit reached)." message. When the cap is the
-- TRIAL cap, that hides *why* the limit is low and what to do about it. This
-- recreates the function with identical logic except a trial-aware message:
-- while trialing, it explains the free-trial player limit and points at
-- subscribing; otherwise it keeps the plain "full" message.
--
-- Only the player-cap RAISE differs from 0005; everything else is unchanged.
-- ============================================================================
create or replace function public.redeem_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invite_codes%rowtype;
  v_cap int;
  v_count int;
  v_status text;   -- subscription status, used only to phrase the cap message
begin
  if v_uid is null then
    raise exception 'You must be signed in to join a campaign.'
      using errcode = 'P0001';
  end if;

  select * into v_invite
  from public.invite_codes
  where code = upper(btrim(p_code));

  if not found then
    raise exception 'That invite code is not valid.' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'That invite code has expired.' using errcode = 'P0001';
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'That invite code has already been used up.' using errcode = 'P0001';
  end if;

  -- Already a member: no-op (never blocked by lock/cap; they are already in).
  if exists (
    select 1 from public.campaign_members
    where campaign_id = v_invite.campaign_id and user_id = v_uid
  ) then
    return v_invite.campaign_id;
  end if;

  -- (1) Read-only lock: a lapsed campaign accepts no new members.
  if not private.campaign_is_active(v_invite.campaign_id) then
    raise exception 'This campaign is read-only and is not accepting new players right now.'
      using errcode = 'P0001';
  end if;

  -- (2) Player cap: NULL cap means unlimited; otherwise the join must keep the
  -- member count at or below the cap. The message distinguishes the free-trial
  -- cap (which a subscription would lift) from a general "full" campaign.
  v_cap := private.campaign_player_cap(v_invite.campaign_id);
  if v_cap is not null then
    select count(*) into v_count
    from public.campaign_members
    where campaign_id = v_invite.campaign_id;
    if v_count >= v_cap then
      select status into v_status
      from public.campaign_subscriptions
      where campaign_id = v_invite.campaign_id;

      if v_status = 'trialing' then
        raise exception
          'This campaign is on a free trial, which is limited to % players — that limit is reached. The DM can subscribe to add more players.',
          v_cap
          using errcode = 'P0001';
      else
        raise exception 'This campaign is full (% player limit reached).', v_cap
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.campaign_members (campaign_id, user_id, role)
  values (v_invite.campaign_id, v_uid, v_invite.role);

  update public.invite_codes
  set uses = uses + 1
  where id = v_invite.id;

  return v_invite.campaign_id;
end;
$$;
