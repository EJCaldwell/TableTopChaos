-- ============================================================================
-- 0009_campaign_entitlements_rpc.sql — service-role entitlement snapshot.
--
-- The upload-media Edge Function must know, for a campaign: is it writable right
-- now (read-only lock), what is its storage cap, and how many bytes are already
-- used. Those live in private.campaign_is_active / campaign_storage_cap /
-- campaign_storage_used — but the `private` schema is not exposed to PostgREST,
-- so an Edge Function's supabase-js client can't call them directly.
--
-- This exposes ONE public wrapper the service role can call via .rpc(). It takes
-- a campaign id (no caller identity needed — none of the three helpers use
-- auth.uid()). Execute is granted to service_role only and revoked from PUBLIC,
-- so it is not a general client RPC.
-- ============================================================================
create function public.campaign_entitlements(p_campaign_id uuid)
returns table (is_active boolean, storage_cap bigint, storage_used bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select
    private.campaign_is_active(p_campaign_id),
    private.campaign_storage_cap(p_campaign_id),
    private.campaign_storage_used(p_campaign_id);
$$;

revoke all on function public.campaign_entitlements(uuid) from public;
grant execute on function public.campaign_entitlements(uuid) to service_role;
