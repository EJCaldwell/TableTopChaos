-- ============================================================================
-- 0036_campaign_lapse.sql — Phase 7.2: the lapse clock behind the Refunds page.
--
-- WHAT THIS OWNS
--   * private.billing_config  — three new tunables: a SECOND kill-switch for
--                               deletion, the grace window, and the warning
--                               schedule.
--   * public.campaigns        — read_only_since / lapse_warned_days: the clock
--                               itself and how far through the warnings we are.
--   * private.refresh_lapse_state()   — starts, clears and never rewinds the
--                               clock. The only writer of read_only_since.
--   * public.campaign_lapse_status()  — members-readable countdown for the UI.
--   * public.lapse_sweep_targets()    — service-role work list for the cron.
--   * public.record_lapse_warning()   — service-role warning bookkeeping.
--
-- WHY THIS EXISTS. The Refunds page (7.2) states that a campaign read-only for
-- three months is deleted after warnings at 30/7/1 days. Nothing implemented
-- that, which made the sentence a false statement in a legal document. This is
-- the half that makes it true.
--
-- THE CLOCK NEVER RUNS RETROACTIVELY. read_only_since is set to now() the first
-- time a sweep OBSERVES a campaign as read-only — it is not derived from when
-- the subscription actually lapsed. That is deliberate and load-bearing: while
-- `enforce_active` is false every campaign is "active", so the first sweep after
-- the launch flip starts a fresh 90-day clock for everyone rather than finding a
-- year of accumulated lapse and deleting the whole database on day one.
--
-- TWO INDEPENDENT SWITCHES GUARD DELETION.
--   enforce_active      — off means nothing is ever read-only, so no clock runs.
--   lapse_delete_enabled — off means clocks run and warnings are visible, but
--                          nothing is ever deleted or emailed.
-- Both must be true. This lets the countdown be observed in production for a
-- full cycle before anything irreversible is switched on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Config. Tunable at runtime by design (see 0005) — changing the grace window
-- or the warning schedule must not require a migration, because the Refunds
-- page and these values have to agree and the page is the harder one to change.
-- ----------------------------------------------------------------------------
alter table private.billing_config
  -- Second kill-switch, independent of enforce_active. FALSE = observe only:
  -- clocks tick and the UI shows a countdown, but no email is sent and no
  -- campaign is deleted.
  add column lapse_delete_enabled boolean not null default false,
  -- How long a campaign may stay read-only before deletion. 90 days ≈ the
  -- "three months" the Refunds page promises; they must not drift apart.
  add column lapse_grace_days int not null default 90,
  -- Days-before-deletion at which the owner is warned. Descending order is
  -- assumed by the sweep. Must match the Refunds page.
  add column lapse_warn_days int[] not null default '{30,7,1}';

-- ----------------------------------------------------------------------------
-- The clock, stored on the campaign itself rather than on
-- campaign_subscriptions, for one decisive reason: a campaign that NEVER
-- subscribed has no subscription row at all, and after the enforce_active flip
-- it is read-only exactly like a lapsed one. Hanging the clock off the
-- subscription would silently exempt the largest group of read-only campaigns.
-- ----------------------------------------------------------------------------
alter table public.campaigns
  -- When this campaign was first OBSERVED read-only. NULL = currently writable.
  add column read_only_since timestamptz,
  -- The smallest warning threshold already sent (30 → 7 → 1). NULL = none sent.
  -- Cleared whenever the clock clears, so a resubscribe-then-lapse-again cycle
  -- warns again from the top instead of jumping straight to deletion.
  add column lapse_warned_days int;

-- Partial index: sweeps and the deletion query only ever look at lapsed
-- campaigns, which should be the small minority.
create index campaigns_read_only_since_idx
  on public.campaigns (read_only_since)
  where read_only_since is not null;

comment on column public.campaigns.read_only_since is
  'When this campaign was first observed read-only by refresh_lapse_state(). '
  'NOT when its subscription lapsed — the clock never runs retroactively.';

-- ----------------------------------------------------------------------------
-- Keep the sweep out of updated_at.
--
-- campaigns_set_updated_at (0003) fires on every UPDATE, so the daily refresh
-- would restamp updated_at on every lapsed campaign — turning "last edited" into
-- "last swept" for exactly the campaigns nobody is editing, and making a
-- long-abandoned campaign look freshly touched every morning. The WHEN clause
-- fires the trigger only when something OTHER than the two lapse columns
-- changed, so a real edit still stamps normally.
--
-- Recreated rather than altered: a trigger's WHEN clause cannot be changed in
-- place. Definition is otherwise identical to 0003.
-- ----------------------------------------------------------------------------
drop trigger campaigns_set_updated_at on public.campaigns;

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row
  when (
    old.read_only_since is not distinct from new.read_only_since
    and old.lapse_warned_days is not distinct from new.lapse_warned_days
  )
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- refresh_lapse_state — reconcile every campaign''s clock with its entitlement.
--
-- The ONLY writer of read_only_since. Idempotent, and safe to run as often as
-- you like: a campaign already on the clock is left alone (the clock never
-- rewinds), and a campaign that has become writable again has it cleared.
--
-- Returns one row: how many clocks started and how many cleared this run. The
-- cron logs these, which is what makes "the sweep ran and did nothing" and "the
-- sweep did not run" distinguishable.
--
-- SECURITY DEFINER: reads private.billing_config and writes every campaign
-- regardless of RLS. Not granted to any client role (see the revokes below).
-- ----------------------------------------------------------------------------
create function private.refresh_lapse_state()
returns table (started int, cleared int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started int;
  v_cleared int;
begin
  -- Start the clock on campaigns now read-only that are not already on it.
  -- While enforce_active is false campaign_is_active() returns true for every
  -- campaign, so this matches nothing and the whole feature stays dormant.
  with started as (
    update public.campaigns c
       set read_only_since = now()
     where c.read_only_since is null
       and not private.campaign_is_active(c.id)
    returning 1
  )
  select count(*)::int into v_started from started;

  -- Clear the clock on campaigns that are writable again. Resetting
  -- lapse_warned_days in the same statement is what stops a campaign that
  -- resubscribed after its 7-day warning from being deleted a week into its
  -- next lapse without ever seeing a 30-day warning.
  with cleared as (
    update public.campaigns c
       set read_only_since = null,
           lapse_warned_days = null
     where c.read_only_since is not null
       and private.campaign_is_active(c.id)
    returning 1
  )
  select count(*)::int into v_cleared from cleared;

  return query select v_started, v_cleared;
end;
$$;

-- ----------------------------------------------------------------------------
-- campaign_lapse_status — the countdown, for anyone in the campaign.
--
-- Readable by every MEMBER, not just the DM, on purpose: the read-only freeze
-- hits players too (their own character sheets stop saving), so "this campaign
-- is deleted in 12 days" is not billing information — it is the notice that
-- their data is about to be destroyed. Billing amounts stay DM-only; this
-- exposes no money, no card and no Stripe id.
--
-- Returns a single row always, so the caller never has to distinguish "no row"
-- from "not lapsed":
--   read_only_since  — NULL when the campaign is writable
--   delete_after     — when deletion becomes due, NULL when not on the clock
--   days_remaining   — whole days left, NULL when not on the clock
--   deletion_enabled — whether deletion is actually armed; false means the
--                      countdown is informational and nothing will be deleted
--
-- SECURITY DEFINER + an explicit is_campaign_member() gate. The definer rights
-- are needed to read billing_config; the membership check is what keeps this
-- from being a public campaign-existence oracle.
-- ----------------------------------------------------------------------------
create function public.campaign_lapse_status(p_campaign_id uuid)
returns table (
  read_only_since timestamptz,
  delete_after timestamptz,
  days_remaining int,
  deletion_enabled boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_cfg private.billing_config%rowtype;
  v_since timestamptz;
  v_after timestamptz;
begin
  -- Non-members get nothing at all — not even "that campaign is not lapsed".
  if not private.is_campaign_member(p_campaign_id) then
    raise exception 'Not a member of this campaign'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_cfg from private.billing_config where id;
  select c.read_only_since into v_since
    from public.campaigns c where c.id = p_campaign_id;

  if v_since is not null then
    v_after := v_since + make_interval(days => v_cfg.lapse_grace_days);
  end if;

  return query
  select
    v_since,
    v_after,
    case
      when v_after is null then null
      -- ceil, so the last partial day still reads as "1 day left" rather than
      -- "0 days left" for the final 24 hours.
      else greatest(0, ceil(extract(epoch from (v_after - now())) / 86400)::int)
    end,
    coalesce(v_cfg.enforce_active, false)
      and coalesce(v_cfg.lapse_delete_enabled, false);
end;
$$;

-- ----------------------------------------------------------------------------
-- lapse_sweep_targets — the cron''s work list.
--
-- One row per campaign currently on the clock, carrying everything the sweep
-- needs so the Edge Function makes ONE query instead of N+1 (owner email lives
-- in auth.users, which PostgREST cannot reach at all).
--
--   warn_days     — the threshold to warn at NOW, or NULL if no warning is due
--   due_for_delete — the grace window has expired AND the final warning was
--                    sent at least a day ago
--
-- The final-warning condition is a safety interlock, not bookkeeping: without
-- it, a campaign whose warning emails all failed to send would be deleted in
-- silence. If warnings cannot be delivered, nothing is ever deleted.
-- ----------------------------------------------------------------------------
create function public.lapse_sweep_targets()
returns table (
  campaign_id uuid,
  campaign_name text,
  owner_id uuid,
  owner_email text,
  read_only_since timestamptz,
  delete_after timestamptz,
  days_remaining int,
  warned_days int,
  warn_days int,
  due_for_delete boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  with cfg as (
    select * from private.billing_config where id
  ), base as (
    select
      c.id,
      c.name,
      c.owner_id,
      u.email::text as owner_email,
      c.read_only_since,
      c.lapse_warned_days,
      c.read_only_since + make_interval(days => cfg.lapse_grace_days) as delete_after,
      cfg.lapse_warn_days,
      cfg.lapse_delete_enabled and cfg.enforce_active as armed
    from public.campaigns c
    cross join cfg
    left join auth.users u on u.id = c.owner_id
    where c.read_only_since is not null
  ), calc as (
    select
      b.*,
      greatest(0, ceil(extract(epoch from (b.delete_after - now())) / 86400)::int) as days_left
    from base b
  )
  select
    calc.id,
    calc.name,
    calc.owner_id,
    calc.owner_email,
    calc.read_only_since,
    calc.delete_after,
    calc.days_left,
    calc.lapse_warned_days,
    -- The smallest threshold this campaign has already passed and not yet been
    -- warned at. Picking the SMALLEST (not the largest) matters for a campaign
    -- first observed late — one that appears with 3 days left gets the 7-day
    -- warning skipped and the 1-day one sent, rather than three emails at once.
    (
      select min(w)
      from unnest(calc.lapse_warn_days) as w
      where calc.days_left <= w
        and (calc.lapse_warned_days is null or w < calc.lapse_warned_days)
    ),
    calc.armed
      and now() >= calc.delete_after
      -- Never delete without a delivered final warning that has had a day to be
      -- read. lapse_warned_days is only written after a successful send.
      and calc.lapse_warned_days is not null
      and calc.lapse_warned_days <= (select min(w) from unnest(calc.lapse_warn_days) as w)
  from calc;
$$;

-- ----------------------------------------------------------------------------
-- record_lapse_warning — mark a warning as SENT.
--
-- Called only after the email provider accepted the message. Deliberately a
-- separate call rather than part of the sweep query: a warning must never be
-- recorded for mail that failed, because the record is what unlocks deletion.
-- ----------------------------------------------------------------------------
create function public.record_lapse_warning(p_campaign_id uuid, p_days int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.campaigns
     set lapse_warned_days = p_days
   where id = p_campaign_id
     -- Monotonic: only ever move DOWN the schedule (30 → 7 → 1). Guards against
     -- an out-of-order or retried call resetting progress and re-arming a
     -- deletion interlock that had already been satisfied.
     and (lapse_warned_days is null or p_days < lapse_warned_days);
$$;

-- ----------------------------------------------------------------------------
-- Privileges.
--
-- A newly created FUNCTION is EXECUTE-able by PUBLIC, and this project''s
-- default privileges additionally grant EXECUTE to `authenticated` BY NAME — so
-- `revoke ... from public` alone restricts nothing. Both leaks found in Phase
-- 7.1 (campaign_entitlements, account_deletion_targets) came from exactly that.
-- Every revoke below therefore names the roles explicitly.
--
-- Left un-revoked, lapse_sweep_targets() would hand any signed-in user the
-- email address of every lapsed campaign''s owner.
-- ----------------------------------------------------------------------------
revoke execute on function private.refresh_lapse_state()
  from public, anon, authenticated;
revoke execute on function public.lapse_sweep_targets()
  from public, anon, authenticated;
revoke execute on function public.record_lapse_warning(uuid, int)
  from public, anon, authenticated;

grant execute on function public.lapse_sweep_targets() to service_role;
grant execute on function public.record_lapse_warning(uuid, int) to service_role;

-- The countdown is the one function here clients may call. refresh_lapse_state
-- is reachable by the service role through the sweep wrapper below.
grant execute on function public.campaign_lapse_status(uuid) to authenticated;

-- Public wrapper so the Edge Function can drive the private refresh over
-- PostgREST, which cannot see the `private` schema (same pattern as 0009).
create function public.refresh_lapse_state()
returns table (started int, cleared int)
language sql
security definer
set search_path = ''
as $$
  select * from private.refresh_lapse_state();
$$;

revoke execute on function public.refresh_lapse_state()
  from public, anon, authenticated;
grant execute on function public.refresh_lapse_state() to service_role;
