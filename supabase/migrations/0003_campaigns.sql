-- ===========================================================================
-- Migration 0003 — Campaigns, membership & invite codes.
--
-- Introduces the core multi-tenant model and the two access predicates that
-- nearly every later policy depends on:
--   - campaigns          : one row per campaign; owner_id is the founding DM.
--   - campaign_members    : who belongs to a campaign and in what role.
--   - invite_codes        : shareable codes that let a user join a campaign.
--   - private.is_campaign_member() / private.is_campaign_dm() : membership tests.
--   - public.redeem_invite_code() : the atomic "join by code" RPC.
--
-- KEY DESIGN NOTE — avoiding recursive RLS:
--   The RLS policies on campaign_members need to ask "is the caller a member of
--   this campaign?" — which is itself a query against campaign_members. If that
--   check ran under RLS it would recurse infinitely. So the membership
--   predicates are SECURITY DEFINER functions that bypass RLS, and they live in
--   a `private` schema that PostgREST does NOT expose, so they never become
--   callable REST RPCs (keeps the security advisors clean).
-- ===========================================================================

-- A schema for internal helpers we deliberately do NOT expose over the API.
-- PostgREST only serves the `public` schema, so nothing here is a REST endpoint.
create schema if not exists private;
comment on schema private is
  'Internal helpers (RLS predicates, generators) intentionally NOT exposed via PostgREST.';

-- Role a member holds within a single campaign. Exactly one member per campaign
-- holds 'dm' — the owner, enrolled by the add_owner_as_dm trigger below. There is
-- no supported way to add a second DM; invite codes only ever grant 'player'.
create type public.campaign_role as enum ('dm', 'player');
comment on type public.campaign_role is
  'A member''s role within one campaign. Exactly one ''dm'' per campaign (the owner); everyone else is ''player''.';

-- ---------------------------------------------------------------------------
-- Helper: private.generate_invite_code()
-- Defined early because invite_codes.code uses it as a column DEFAULT. Produces
-- an 8-character code from an unambiguous alphabet (no I/L/O/0/1) so codes are
-- easy to read aloud and type. Not security definer (no elevated rights
-- needed); volatile because it calls random().
-- ---------------------------------------------------------------------------
create or replace function private.generate_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr(
      'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
      floor(random() * 31)::int + 1,
      1
    ),
    ''
  )
  from generate_series(1, 8);
$$;

comment on function private.generate_invite_code() is
  'Returns a random 8-char invite code from an unambiguous alphabet. Used as invite_codes.code default.';

-- ---------------------------------------------------------------------------
-- Table: campaigns
-- One row per campaign. owner_id is the founding DM and the billing owner
-- (Phase 1.5 / 5.2). Deleting the owning auth user cascades the campaign away.
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.campaigns is
  'A single campaign. owner_id = founding DM / billing owner. RLS: members read; DMs write.';

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: campaign_members
-- The membership join table: which user belongs to which campaign, in what
-- role. UNIQUE(campaign_id, user_id) means a user has exactly one role per
-- campaign. Rows are created ONLY via server-side paths (the campaign-insert
-- trigger below, and redeem_invite_code) — there is intentionally no client
-- INSERT policy, so joins always go through validated code redemption.
-- ---------------------------------------------------------------------------
create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.campaign_role not null default 'player',
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

comment on table public.campaign_members is
  'Membership: user <-> campaign + role. Inserted only server-side (trigger / redeem_invite_code RPC).';

-- Speeds up the membership predicates, which filter by user_id. The UNIQUE
-- constraint already indexes (campaign_id, user_id) for campaign-scoped lookups.
create index campaign_members_user_id_idx on public.campaign_members (user_id);

-- ---------------------------------------------------------------------------
-- Table: invite_codes
-- A DM-created code that grants the bearer membership (in a fixed role) when
-- redeemed. Supports optional expiry and a max-use count. `code` defaults to a
-- generated human-friendly string (see private.generate_invite_code()).
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  code text not null unique default private.generate_invite_code(),
  role public.campaign_role not null default 'player',
  max_uses integer check (max_uses is null or max_uses > 0), -- null = unlimited
  uses integer not null default 0,
  expires_at timestamptz,                                    -- null = never expires
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.invite_codes is
  'Shareable join codes. Optional expiry/max_uses. Redeemed atomically via redeem_invite_code().';

-- ---------------------------------------------------------------------------
-- Membership predicates (SECURITY DEFINER, in private schema).
-- These bypass RLS (so they can read campaign_members without recursing into
-- its own policies) and answer only about the CURRENT user, so they leak
-- nothing. STABLE: result is fixed within a statement, letting the planner
-- cache it. search_path pinned to '' → everything fully qualified.
-- ---------------------------------------------------------------------------
create or replace function private.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function private.is_campaign_member(uuid) is
  'True if the current user is a member of the campaign. SECURITY DEFINER to avoid recursive RLS on campaign_members.';

create or replace function private.is_campaign_dm(p_campaign_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.user_id = (select auth.uid())
      and m.role = 'dm'
  );
$$;

comment on function private.is_campaign_dm(uuid) is
  'True if the current user is a DM (role=dm member) of the campaign. Backbone of DM-only write policies.';

-- Authenticated users must be able to CALL these from within RLS policy
-- evaluation. Granting USAGE on the schema + EXECUTE on the functions is enough;
-- since `private` is not an exposed schema, they still are not REST endpoints.
grant usage on schema private to authenticated;
grant execute on function private.is_campaign_member(uuid) to authenticated;
grant execute on function private.is_campaign_dm(uuid) to authenticated;
grant execute on function private.generate_invite_code() to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: add the founding owner as a DM member on campaign creation.
-- Keeps the membership model consistent (the owner IS a dm member), which is
-- what is_campaign_dm() checks. SECURITY DEFINER so it can insert past the
-- (absent) client INSERT policy on campaign_members; EXECUTE revoked so it is
-- never callable as an RPC (advisors 0028/0029).
-- ---------------------------------------------------------------------------
create or replace function public.add_owner_as_dm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, new.owner_id, 'dm');
  return new;
end;
$$;

comment on function public.add_owner_as_dm() is
  'AFTER INSERT on campaigns: enrolls the owner as the campaign''s single dm member, so every DM predicate can just check campaign_members.';

create trigger campaigns_add_owner_as_dm
  after insert on public.campaigns
  for each row
  execute function public.add_owner_as_dm();

revoke execute on function public.add_owner_as_dm() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- RPC: public.redeem_invite_code(p_code)
-- The one supported way to JOIN a campaign. Runs SECURITY DEFINER because the
-- joining user is not yet a member (so cannot read the code under RLS) and has
-- no INSERT policy on campaign_members. It validates the code atomically and,
-- on success, enrolls the caller and bumps the use count. Returns the joined
-- campaign_id so the client can navigate there.
--
-- NOTE: this function is intentionally SECURITY DEFINER *and* callable by the
-- authenticated role — that is precisely what a join-by-code RPC must be. The
-- security advisor will flag it (0029) as a heads-up; it is a deliberate,
-- reviewed exception, safe because it only ever enrolls the CURRENT user and
-- validates the code first.
--
-- Player-cap enforcement (reject joins past campaign_player_cap()) is added in
-- Phase 1.5 once the entitlement helpers exist; the check point is marked below.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invite_codes%rowtype;
begin
  -- Must be signed in.
  if v_uid is null then
    raise exception 'You must be signed in to join a campaign.'
      using errcode = 'P0001';
  end if;

  -- Look up the code (case-insensitive; codes are stored uppercase).
  select * into v_invite
  from public.invite_codes
  where code = upper(btrim(p_code));

  if not found then
    raise exception 'That invite code is not valid.' using errcode = 'P0001';
  end if;

  -- Expiry check.
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'That invite code has expired.' using errcode = 'P0001';
  end if;

  -- Use-count check.
  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'That invite code has already been used up.' using errcode = 'P0001';
  end if;

  -- Already a member? Treat as a no-op success so re-entering a code is harmless.
  if exists (
    select 1 from public.campaign_members
    where campaign_id = v_invite.campaign_id and user_id = v_uid
  ) then
    return v_invite.campaign_id;
  end if;

  -- >>> Phase 1.5 hook: reject here if members >= campaign_player_cap(campaign_id).

  -- Enroll the caller in the code's role and count the use atomically.
  insert into public.campaign_members (campaign_id, user_id, role)
  values (v_invite.campaign_id, v_uid, v_invite.role);

  update public.invite_codes
  set uses = uses + 1
  where id = v_invite.id;

  return v_invite.campaign_id;
end;
$$;

comment on function public.redeem_invite_code(text) is
  'Atomically validates an invite code and enrolls the CURRENT user in the campaign; returns campaign_id. SECURITY DEFINER by necessity (see 0003 migration notes).';

-- Only signed-in users may redeem; anon cannot.
revoke execute on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

-- ---- campaigns ------------------------------------------------------------
alter table public.campaigns enable row level security;

-- Read: any member of the campaign, plus the owner directly (the owner-id
-- branch also guarantees the INSERT ... RETURNING row is visible before the
-- membership-adding AFTER trigger's row is considered).
create policy "campaigns_select_members"
  on public.campaigns
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or private.is_campaign_member(id)
  );

comment on policy "campaigns_select_members" on public.campaigns is
  'A campaign is readable by its owner and by any of its members.';

-- Create: any signed-in user may create a campaign they own.
create policy "campaigns_insert_own"
  on public.campaigns
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

comment on policy "campaigns_insert_own" on public.campaigns is
  'A user may create a campaign only with themselves as owner.';

-- Update: only the campaign's DM (which is its owner).
create policy "campaigns_update_dm"
  on public.campaigns
  for update
  to authenticated
  using (private.is_campaign_dm(id))
  with check (private.is_campaign_dm(id));

comment on policy "campaigns_update_dm" on public.campaigns is
  'Only the campaign''s DM (which is its owner) may update it.';

-- Delete: only the owner (billing owner) may delete the whole campaign.
create policy "campaigns_delete_owner"
  on public.campaigns
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

comment on policy "campaigns_delete_owner" on public.campaigns is
  'Only the owner may delete a campaign outright.';

-- ---- campaign_members -----------------------------------------------------
alter table public.campaign_members enable row level security;

-- Read: members can see the roster of campaigns they belong to.
create policy "campaign_members_select_members"
  on public.campaign_members
  for select
  to authenticated
  using (private.is_campaign_member(campaign_id));

comment on policy "campaign_members_select_members" on public.campaign_members is
  'Members can view the member list of their own campaigns.';

-- No INSERT / UPDATE policy on purpose: enrollment happens only through the
-- SECURITY DEFINER paths (owner trigger, redeem_invite_code). Role changes come
-- with Phase 5.2. Delete is allowed so a member can leave and a DM can remove.
create policy "campaign_members_delete_self_or_dm"
  on public.campaign_members
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())          -- a member may leave
    or private.is_campaign_dm(campaign_id)  -- a DM may remove someone
  );

comment on policy "campaign_members_delete_self_or_dm" on public.campaign_members is
  'A user may remove their own membership; a DM may remove any member of their campaign.';

-- ---- invite_codes ---------------------------------------------------------
alter table public.invite_codes enable row level security;

-- Read: only a DM of the campaign can see its codes. (Redemption reads the code
-- inside the SECURITY DEFINER RPC, so joiners never need direct read access.)
create policy "invite_codes_select_dm"
  on public.invite_codes
  for select
  to authenticated
  using (private.is_campaign_dm(campaign_id));

comment on policy "invite_codes_select_dm" on public.invite_codes is
  'Only a DM may list a campaign''s invite codes.';

-- Create: a DM may create codes for their campaign, attributed to themselves.
create policy "invite_codes_insert_dm"
  on public.invite_codes
  for insert
  to authenticated
  with check (
    private.is_campaign_dm(campaign_id)
    and created_by = (select auth.uid())
  );

comment on policy "invite_codes_insert_dm" on public.invite_codes is
  'A DM may create invite codes for their own campaign.';

-- Delete: a DM may revoke codes.
create policy "invite_codes_delete_dm"
  on public.invite_codes
  for delete
  to authenticated
  using (private.is_campaign_dm(campaign_id));

comment on policy "invite_codes_delete_dm" on public.invite_codes is
  'A DM may revoke (delete) invite codes for their own campaign.';
