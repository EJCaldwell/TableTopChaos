-- ============================================================================
-- 0037_campaign_is_active_null.sql — campaign_is_active() returned NULL, not
-- false, for a campaign with no subscription row.
--
-- FOUND: 2026-08-26, by the first execution of the 0036 lapse clock (QA area
-- A4). The fixture campaign — deliberately subscription-less — never got a
-- clock, while campaigns holding a `canceled` subscription row did.
--
-- THE BUG. private.campaign_is_active (migration 0005) ends with:
--
--     select status into v_status from public.campaign_subscriptions
--      where campaign_id = p_campaign_id;
--     return v_status in ('trialing', 'active', 'past_due');
--
-- With no row, v_status is NULL, and `NULL in (...)` is NULL — not false. So
-- the function returns NULL for exactly the campaigns that have never
-- subscribed.
--
-- WHY IT WAS INVISIBLE FOR TWO PHASES. Every existing caller uses the result in
-- a context where NULL and false are indistinguishable:
--   * RLS `using (...)` — NULL denies, same as false.
--   * `if not coalesce(...)` in the player-cap helper — already coalesced.
--   * the upload-media Edge Function — JS `!null` is `!false`.
-- It has never produced a wrong answer. 0036 was the first caller to write
-- `not private.campaign_is_active(c.id)` in a WHERE clause, where `not NULL` is
-- NULL and the row simply does not match.
--
-- THE CONSEQUENCE HAD THIS SHIPPED. The lapse clock would have started only for
-- campaigns holding a lapsed subscription ROW, and never for campaigns that had
-- never subscribed at all — which after the enforce_active flip is the larger
-- group, and the one 0036 explicitly claims to cover ("hanging the clock off the
-- subscription would silently exempt the largest group of read-only campaigns").
-- The read-only freeze would have applied to them correctly; the deletion the
-- Refunds page describes would silently never have happened. A legal document
-- promising something the code does not do is the precise failure 7.2 exists to
-- avoid, so this is a correctness fix, not a tidy-up.
--
-- THE FIX, in two places:
--   1. The root cause: coalesce the result to false. Behaviour is unchanged for
--      every pre-existing caller (all of them already treated NULL as false),
--      and the function now means what its name says.
--   2. Belt and braces at the 0036 call site, so a future NULL-returning
--      entitlement helper cannot silently empty the sweep again. A WHERE clause
--      that matches nothing looks exactly like "there is no work to do".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Root cause. Identical to 0005 except for the final coalesce.
-- ----------------------------------------------------------------------------
create or replace function private.campaign_is_active(p_campaign_id uuid)
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

  -- coalesce, because `NULL in (...)` is NULL and a campaign that never
  -- subscribed has no row at all. Returning false says the true thing: it is
  -- not entitled to writes.
  return coalesce(v_status in ('trialing', 'active', 'past_due'), false);
end;
$$;

comment on function private.campaign_is_active(uuid) is
  'Is the campaign entitled to writes right now? Always true while '
  'billing_config.enforce_active is false. Returns FALSE (never NULL) for a '
  'campaign with no subscription row — see migration 0037.';

-- ----------------------------------------------------------------------------
-- 2. The 0036 call site. Unchanged apart from the two coalesces.
-- ----------------------------------------------------------------------------
create or replace function private.refresh_lapse_state()
returns table (started int, cleared int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started int;
  v_cleared int;
begin
  -- `not coalesce(..., false)` rather than `not ...`: a three-valued result
  -- here does not raise, it just quietly matches no rows, and a sweep that
  -- matches nothing is indistinguishable from a sweep with nothing to do.
  with started as (
    update public.campaigns c
       set read_only_since = now()
     where c.read_only_since is null
       and not coalesce(private.campaign_is_active(c.id), false)
    returning 1
  )
  select count(*)::int into v_started from started;

  with cleared as (
    update public.campaigns c
       set read_only_since = null,
           lapse_warned_days = null
     where c.read_only_since is not null
       and coalesce(private.campaign_is_active(c.id), false)
    returning 1
  )
  select count(*)::int into v_cleared from cleared;

  return query select v_started, v_cleared;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Correcting a WRONG COMMENT in 0036's lapse_sweep_targets.
--
-- The body is unchanged and correct; only the comment above the warn_days
-- subquery is replaced. It claimed a campaign first observed with 3 days left
-- would have "the 7-day warning skipped and the 1-day one sent". QA A8 showed
-- it sends the 7-day warning, and that is the RIGHT answer: at 3 days left the
-- 1-day threshold has not been reached yet. It then sends the 1-day warning
-- when it is, so the campaign still gets a final notice and the deletion
-- interlock still opens.
--
-- Recreated in full rather than edited in place, because a `--` comment inside
-- a function body is part of the stored definition: editing 0036's file would
-- leave the repo describing something the database does not contain. Comments
-- that are wrong about the subtle part are worse than no comments.
-- ----------------------------------------------------------------------------
create or replace function public.lapse_sweep_targets()
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
    -- The most urgent threshold that has actually been REACHED and not yet
    -- warned at: the smallest w with days_left <= w. A campaign first observed
    -- with 3 days left therefore gets the 7-day warning now and the 1-day
    -- warning when it is genuinely 1 day out — one email per run, never the
    -- whole schedule at once, and never a warning for a threshold that has not
    -- arrived. Verified by QA A8/A8b, which is where the previous comment here
    -- was found to be wrong.
    (
      select min(w)
      from unnest(calc.lapse_warn_days) as w
      where calc.days_left <= w
        and (calc.lapse_warned_days is null or w < calc.lapse_warned_days)
    ),
    calc.armed
      and now() >= calc.delete_after
      and calc.lapse_warned_days is not null
      and calc.lapse_warned_days <= (select min(w) from unnest(calc.lapse_warn_days) as w)
  from calc;
$$;

-- create or replace does NOT restore privileges lost to a drop, but it also does
-- not add any — re-revoking by name anyway, because this function returns every
-- lapsed owner's email address and the cost of being wrong is a bulk address
-- leak. The migrate job asserts the result on every run.
revoke execute on function public.lapse_sweep_targets()
  from public, anon, authenticated;
grant execute on function public.lapse_sweep_targets() to service_role;
