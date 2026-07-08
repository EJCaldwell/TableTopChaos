-- ============================================================================
-- 0005_billing.sql — Phase 1.5 monetization: database foundation.
--
-- What this migration owns:
--   * private.billing_config   — a singleton table of TUNABLE limits + a global
--                                enforcement kill-switch (so billing rules can
--                                land now without freezing the app before the
--                                Stripe flow exists).
--   * public.campaign_subscriptions — one row per campaign mirroring the Stripe
--                                subscription. Written only by the Stripe webhook
--                                (service role, bypasses RLS); a campaign's DM may
--                                READ it, nobody else.
--   * public.trial_redemptions — anti-abuse ledger of card fingerprints that have
--                                already consumed a free trial. Fully locked (no
--                                RLS policies): only SECURITY DEFINER functions and
--                                the service-role webhook touch it.
--   * private entitlement helpers — the single source every limit check reads:
--                                campaign_is_active / campaign_player_cap /
--                                campaign_storage_cap.
--   * redeem_invite_code — extended to enforce the read-only lock and the player
--                                cap server-side (behind the kill-switch).
--
-- NOT in this migration (needs a live Stripe account + secrets, done separately):
--   the create-checkout-session / stripe-webhook / create-billing-portal-session
--   Edge Functions, and flipping enforce_active on.
--
-- Enforcement kill-switch: private.billing_config.enforce_active starts FALSE.
-- While false, campaign_is_active() returns true for every campaign and no cap is
-- imposed, so existing/dev campaigns keep working exactly as before. Flip it to
-- true only once Checkout + webhook are live and DMs can actually subscribe;
-- otherwise every campaign (having no subscription row) would be frozen read-only
-- with no way to unfreeze.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tunable config (singleton). Lives in the non-exposed `private` schema so it is
-- never reachable over the REST API and is read only by SECURITY DEFINER helpers.
-- Values are intentionally editable at runtime (UPDATE), not baked into function
-- bodies, so tuning a cap does not require a migration.
-- ----------------------------------------------------------------------------
create table private.billing_config (
  -- Single-row guard: id is always true, so a second insert conflicts.
  id boolean primary key default true,
  -- Master switch. FALSE = billing not enforced (dev/pre-launch); campaigns are
  -- always "active" and uncapped. TRUE = entitlements gate access.
  enforce_active boolean not null default false,
  -- Player cap during the 30-day trial.
  trial_player_cap int not null default 6,
  -- Player cap on paid Pro. NULL = unlimited (no cap enforced).
  paid_player_cap int,
  -- Image-storage cap in bytes during the trial (~500 MB).
  trial_storage_bytes bigint not null default 524288000,
  -- Image-storage cap in bytes on paid Pro (~5 GB).
  paid_storage_bytes bigint not null default 5368709120,
  constraint billing_config_singleton check (id)
);

-- Seed the single config row with the Phase 1.5 defaults (enforcement off).
insert into private.billing_config (id) values (true);

-- ----------------------------------------------------------------------------
-- campaign_subscriptions — one row per campaign, mirrors the Stripe subscription.
-- Authoritative writer is the stripe-webhook Edge Function using the service-role
-- key (which bypasses RLS). The DM may read their campaign's row for the billing
-- UI; players and non-members cannot see it at all.
-- ----------------------------------------------------------------------------
create table public.campaign_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- One subscription per campaign; the unique constraint also prevents a campaign
  -- from ever holding two rows (e.g. a second trial).
  campaign_id uuid not null unique
    references public.campaigns (id) on delete cascade,
  -- Stripe references — non-sensitive identifiers only (PCI SAQ-A: no card data).
  stripe_customer_id text,
  stripe_subscription_id text,
  -- Product tier; only 'pro' exists today but kept explicit for future tiers.
  plan text not null default 'pro',
  -- Billing interval chosen by the DM. NULL until a plan/interval is selected.
  interval text check (interval in ('monthly', 'semiannual', 'annual')),
  -- Raw Stripe subscription status: trialing | active | past_due | canceled |
  -- incomplete | incomplete_expired | unpaid. Stored verbatim from the webhook.
  status text,
  -- Non-sensitive card display + the anti-abuse fingerprint (also recorded in
  -- trial_redemptions). Never any PAN/CVV/expiry.
  card_fingerprint text,
  card_brand text,
  card_last4 text,
  -- Timestamps mirrored from Stripe for UI countdowns and lifecycle logic.
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh on webhook upserts (trigger func from 0001).
create trigger set_campaign_subscriptions_updated_at
  before update on public.campaign_subscriptions
  for each row execute function public.set_updated_at();

alter table public.campaign_subscriptions enable row level security;

-- SELECT: only the campaign's DM may read the subscription row (for the billing
-- screen). No INSERT/UPDATE/DELETE policies exist, so the anon/authenticated
-- clients can never write it — the webhook uses the service role, which bypasses
-- RLS entirely.
create policy campaign_subscriptions_select_dm
  on public.campaign_subscriptions
  for select
  to authenticated
  using (private.is_campaign_dm(campaign_id));

-- ----------------------------------------------------------------------------
-- trial_redemptions — anti-abuse ledger. One row per card fingerprint that has
-- ever started a trial. The create-checkout-session Edge Function checks this
-- before granting a trial; a fingerprint already present is denied a new trial
-- (offered immediate billing instead), so a new account with the same card can't
-- farm free trials.
--
-- Deliberately has RLS ENABLED with NO policies: it is invisible and unwritable
-- to all client roles. Only SECURITY DEFINER functions and the service-role
-- webhook read/write it. campaign_id is SET NULL on campaign delete so the
-- anti-abuse record survives even after the campaign is gone.
-- ----------------------------------------------------------------------------
create table public.trial_redemptions (
  id uuid primary key default gen_random_uuid(),
  card_fingerprint text not null unique,
  first_used_at timestamptz not null default now(),
  campaign_id uuid references public.campaigns (id) on delete set null
);

alter table public.trial_redemptions enable row level security;
-- (No policies on purpose — default-deny for every client role.)

-- ----------------------------------------------------------------------------
-- Entitlement helpers (private schema, SECURITY DEFINER, STABLE).
--
-- These are the single source of truth every limit check and RLS write-lock
-- reads. They live in `private` so they are not exposed as REST RPCs, and run as
-- the owner so they can read billing_config + campaign_subscriptions regardless
-- of the caller's RLS. All honor the enforce_active kill-switch.
-- ----------------------------------------------------------------------------

-- campaign_is_active: is the campaign entitled to writes right now?
--   * enforce_active = false → always true (billing not enforced yet).
--   * otherwise true when the subscription status is one that counts as usable:
--     trialing, active, or past_due (Stripe's dunning grace window). Any other
--     status, or no subscription row at all, → false (campaign is read-only).
create function private.campaign_is_active(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_enforce boolean;
  v_status text;
begin
  select enforce_active into v_enforce from private.billing_config where id;
  if not coalesce(v_enforce, false) then
    return true;
  end if;

  select status into v_status
  from public.campaign_subscriptions
  where campaign_id = p_campaign_id;

  return v_status in ('trialing', 'active', 'past_due');
end;
$$;

-- campaign_player_cap: max members allowed, or NULL for "no limit".
--   * enforce_active = false → NULL (uncapped in dev/pre-launch).
--   * trialing → trial_player_cap (default 6).
--   * active / past_due → paid_player_cap (NULL = unlimited).
--   * anything else (read-only / no sub) → 0 (no new members; the read-only lock
--     in redeem_invite_code will have already rejected the join with a clearer
--     message, so this is a belt-and-suspenders floor).
create function private.campaign_player_cap(p_campaign_id uuid)
returns int
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_cfg private.billing_config%rowtype;
  v_status text;
begin
  select * into v_cfg from private.billing_config where id;
  if not coalesce(v_cfg.enforce_active, false) then
    return null;
  end if;

  select status into v_status
  from public.campaign_subscriptions
  where campaign_id = p_campaign_id;

  if v_status = 'trialing' then
    return v_cfg.trial_player_cap;
  elsif v_status in ('active', 'past_due') then
    return v_cfg.paid_player_cap;   -- NULL = unlimited
  else
    return 0;
  end if;
end;
$$;

-- campaign_storage_cap: max image bytes for the campaign (source of truth for the
-- Phase 1.6 upload pipeline; nothing enforces it yet).
--   * enforce_active = false → paid cap (lenient default in dev).
--   * trialing → trial_storage_bytes; active/past_due → paid_storage_bytes.
--   * otherwise 0 (read-only: no new bytes).
create function private.campaign_storage_cap(p_campaign_id uuid)
returns bigint
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_cfg private.billing_config%rowtype;
  v_status text;
begin
  select * into v_cfg from private.billing_config where id;
  if not coalesce(v_cfg.enforce_active, false) then
    return v_cfg.paid_storage_bytes;
  end if;

  select status into v_status
  from public.campaign_subscriptions
  where campaign_id = p_campaign_id;

  if v_status = 'trialing' then
    return v_cfg.trial_storage_bytes;
  elsif v_status in ('active', 'past_due') then
    return v_cfg.paid_storage_bytes;
  else
    return 0;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Extend redeem_invite_code to enforce the read-only lock and player cap.
--
-- Same behavior as before, plus two server-side gates added right before a NEW
-- membership is inserted (so already-members still no-op cleanly and the gates
-- never fire on a re-join):
--   1. Read-only lock — reject joins when the campaign is not active.
--   2. Player cap — reject joins that would exceed campaign_player_cap().
-- Both are no-ops while enforce_active is false (is_active=true, cap=NULL).
-- Enforcing here covers the only client path that adds a player, since
-- campaign_members has no INSERT policy (direct inserts are already blocked).
-- ----------------------------------------------------------------------------
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
  -- member count at or below the cap.
  v_cap := private.campaign_player_cap(v_invite.campaign_id);
  if v_cap is not null then
    select count(*) into v_count
    from public.campaign_members
    where campaign_id = v_invite.campaign_id;
    if v_count >= v_cap then
      raise exception 'This campaign is full (% player limit reached).', v_cap
        using errcode = 'P0001';
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
