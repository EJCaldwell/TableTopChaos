-- ============================================================================
-- 0030_account_deletion.sql — the read side of "delete my account" (Phase 7.1).
--
-- WHAT THIS FILE DOES *NOT* DO: it does not delete anything. The destructive
-- path lives in the `delete-account` Edge Function, because two of the three
-- things that must happen are outside Postgres entirely — cancelling Stripe
-- subscriptions and removing Storage objects. Putting half the cascade in SQL
-- and half in a function is how you end up with a user row deleted and a live
-- subscription still billing.
--
-- WHY THE DATABASE ALREADY DOES MOST OF THE WORK: the cascade rules PLANNING
-- 7.1.1 specifies are already enforced by foreign keys created back in 0001-0003:
--
--   campaigns.owner_id    -> auth.users ON DELETE CASCADE
--       so deleting the user deletes every campaign they DM, and every FK
--       hanging off those campaigns (members, subscriptions, npcs, encounters,
--       quests, dm_notes, sessions, media_assets, …) cascades in turn.
--   characters.owner_id   -> auth.users ON DELETE CASCADE
--       so their character in someone else's campaign disappears, taking its
--       sheet/inventory/abilities/spells/journal with it, and leaving that
--       campaign and its other players untouched.
--   campaign_members.user_id, invite_codes.created_by, schedule_rsvps.user_id,
--   profiles.id -> all ON DELETE CASCADE.
--
-- Deliberately NOT cascade-deleted, and each for a reason:
--
--   trial_redemptions.campaign_id -> ON DELETE SET NULL. The anti-abuse record
--       (one trial per card fingerprint) must outlive both the campaign and the
--       account, or deleting your account resets the trial limit and the control
--       is worthless. NOTE FOR 7.2: this means a card fingerprint is RETAINED
--       after erasure, which the privacy policy has to disclose as a
--       fraud-prevention legitimate interest.
--   media_assets.uploaded_by -> ON DELETE SET NULL. Correct for assets living in
--       a campaign that survives (the DM still needs the image), but it would
--       leave the departing user's OWN uploads — including a character portrait
--       that may be a photograph of a real person — sitting in someone else's
--       campaign forever. The Edge Function therefore deletes rows the user
--       uploaded *before* deleting the user, while uploaded_by still points at
--       them. Order matters: after the user row goes, the link is gone and those
--       files are unattributable.
--
-- So all this migration adds is the *preview* the UI needs to tell someone
-- honestly what they are about to destroy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- account_deletion_preview() — what deleting MY account would remove.
--
-- Takes no arguments and reads auth.uid() directly: a caller must never be able
-- to ask what deleting *someone else's* account would remove, which is exactly
-- what a p_user_id parameter would allow. SECURITY DEFINER is needed because it
-- counts rows across campaigns the caller cannot otherwise see in full (their
-- own campaigns' subscription rows, other members' counts), and `stable` because
-- it only reads.
--
-- Returns json rather than a composite type so 7.2/7.3 can add fields without a
-- breaking signature change.
--
-- @return json {
--   dm_campaigns:        [{id, name, member_count}]   campaigns to be DELETED
--   player_campaign_count: int                        campaigns merely left
--   character_count:     int
--   media_file_count:    int                          own uploads to be deleted
--   media_byte_count:    bigint
--   active_subscription_count: int                    Stripe subs to cancel
-- }
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_preview()
returns json
language sql
security definer
stable
set search_path = ''
as $$
  select json_build_object(
    -- Campaigns the caller DMs: these are destroyed for every member, so the UI
    -- shows names and member counts. Anything less makes the consequence for
    -- other people invisible at the moment of confirming.
    'dm_campaigns', coalesce((
      select json_agg(json_build_object(
               'id', c.id,
               'name', c.name,
               'member_count', (
                 select count(*) from public.campaign_members m
                 where m.campaign_id = c.id
               )
             ) order by c.created_at)
      from public.campaigns c
      where c.owner_id = auth.uid()
    ), '[]'::json),

    -- Campaigns where they are only a player: unaffected apart from losing this
    -- member and their character.
    'player_campaign_count', (
      select count(*) from public.campaign_members m
      where m.user_id = auth.uid() and m.role <> 'dm'
    ),

    'character_count', (
      select count(*) from public.characters ch where ch.owner_id = auth.uid()
    ),

    -- Their own uploads, across every campaign. Counted from media_assets
    -- because that is what the function iterates when deleting Storage objects,
    -- so the number shown is the number acted on.
    'media_file_count', (
      select count(*) from public.media_assets a where a.uploaded_by = auth.uid()
    ),
    'media_byte_count', (
      select coalesce(sum(a.byte_size), 0) from public.media_assets a
      where a.uploaded_by = auth.uid()
    ),

    -- Subscriptions that would keep billing if the function failed to cancel
    -- them. 'canceled' rows are excluded; anything else (active, trialing,
    -- past_due, unpaid, incomplete) still represents a live Stripe object.
    'active_subscription_count', (
      select count(*)
      from public.campaign_subscriptions s
      join public.campaigns c on c.id = s.campaign_id
      where c.owner_id = auth.uid()
        and s.status <> 'canceled'
        and s.stripe_subscription_id is not null
    )
  );
$$;

comment on function public.account_deletion_preview() is
  'Phase 7.1: summarises what deleting the CALLING user''s account would remove. '
  'Reads auth.uid() with no parameter so it cannot be aimed at another account. '
  'Read-only — the destructive path is the delete-account Edge Function.';

-- Callable by any signed-in user, for their own account only (enforced by the
-- auth.uid() body, not by a grant). Revoked from PUBLIC so an anonymous caller
-- cannot invoke it: with no JWT auth.uid() is null and every count would be 0,
-- which is harmless but meaningless, and there is no reason to answer.
revoke all on function public.account_deletion_preview() from public;
grant execute on function public.account_deletion_preview() to authenticated;

-- ===========================================================================
-- SUPERSEDED BY 0031 — read this before reusing anything below.
--
-- `public.account_deletion_targets(uuid)` (defined at the end of this file) was
-- DROPPED by migration 0031, because the `revoke all … from public` it ends with
-- does not actually restrict anything: Postgres grants EXECUTE on a new function
-- to PUBLIC by default, and this stack's default privileges additionally grant it
-- to `anon` and `authenticated` BY NAME — which a revoke from PUBLIC leaves
-- untouched. It was therefore callable by any signed-in user, with any user id,
-- returning that user's Storage paths.
--
-- The delete-account Edge Function now queries media_assets and
-- campaign_subscriptions directly with the service role, which bypasses RLS —
-- so the RPC bought nothing and cost a leak.
--
-- **Do not copy the revoke pattern below into a new migration.** Revoke from
-- `anon` and `authenticated` by name, and add the function to the
-- service-role-only list in railway/scripts/90_grant_app_privileges.sql so the
-- sweep re-applies it (default privileges re-grant execute on every new
-- function, so this must be standing, not one-off).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- private.account_owned_media(p_user_id) — Storage paths to delete, and the rows
-- that reference them.
--
-- RETAINED (unlike the public wrapper): the `private` schema is not exposed to
-- PostgREST at all, which is the one protection here that does not depend on
-- getting a grant right. Currently unused — the Edge Function reads the table
-- directly — but kept as the correct shape for any future server-side caller.
--
-- Used by the Edge Function (via the service role) to remove the departing
-- user's own uploads from the bucket. Returns BOTH paths per asset: the original
-- and the thumbnail are separate Storage objects, and deleting only the original
-- leaves a visible thumbnail behind — an erasure that did not erase.
--
-- Lives in `private` (not exposed to PostgREST) and takes an explicit user id
-- because the service role has no auth.uid().
-- ---------------------------------------------------------------------------
create or replace function private.account_owned_media(p_user_id uuid)
returns table (asset_id uuid, storage_path text, thumb_path text)
language sql
security definer
stable
set search_path = ''
as $$
  select a.id, a.storage_path, a.thumb_path
  from public.media_assets a
  where a.uploaded_by = p_user_id;
$$;

revoke all on function private.account_owned_media(uuid) from public;
grant execute on function private.account_owned_media(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- public.account_deletion_targets(p_user_id) — PostgREST-callable wrapper.
--
-- The Edge Function's supabase-js client can only reach the `public` schema, and
-- `private` is deliberately not exposed (see 0009 for the same pattern). Returns
-- the media rows plus the Stripe subscription ids to cancel, in one round trip,
-- so the function cannot get half of the picture.
--
-- service_role ONLY. This takes a user id and reports on any account, so it must
-- never be reachable by `authenticated` — that would leak who uploaded what.
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_targets(p_user_id uuid)
returns json
language sql
security definer
stable
set search_path = ''
as $$
  select json_build_object(
    'media', coalesce((
      select json_agg(json_build_object(
               'asset_id', m.asset_id,
               'storage_path', m.storage_path,
               'thumb_path', m.thumb_path))
      from private.account_owned_media(p_user_id) m
    ), '[]'::json),
    'subscriptions', coalesce((
      select json_agg(json_build_object(
               'campaign_id', s.campaign_id,
               'stripe_subscription_id', s.stripe_subscription_id,
               'status', s.status))
      from public.campaign_subscriptions s
      join public.campaigns c on c.id = s.campaign_id
      where c.owner_id = p_user_id
        and s.status <> 'canceled'
        and s.stripe_subscription_id is not null
    ), '[]'::json)
  );
$$;

comment on function public.account_deletion_targets(uuid) is
  'Phase 7.1: the out-of-Postgres work required to delete an account — Storage '
  'paths to remove and Stripe subscriptions to cancel. service_role only; it '
  'reports on an arbitrary user id.';

revoke all on function public.account_deletion_targets(uuid) from public;
grant execute on function public.account_deletion_targets(uuid) to service_role;
