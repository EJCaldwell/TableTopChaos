-- ============================================================================
-- 0008_media_pipeline.sql — Phase 1.6 media upload pipeline: database + storage.
--
-- Owns the persistence side of the one shared image path (portraits, encounter
-- images, handouts). The actual validate/process/moderate/store work happens in
-- the `upload-media` Edge Function (service role); this migration provides:
--   * public.media_assets   — one row per stored image (+ its thumbnail), the
--                             source of truth for what exists, who owns it, how
--                             many bytes it costs, and its moderation state.
--   * public.media_reports  — the report-and-takedown ledger (one report per
--                             user per asset).
--   * private.campaign_storage_used() — current bytes used, checked against
--                             private.campaign_storage_cap() (from 0005) before
--                             an upload is accepted.
--   * report_media() / set_media_status() — the report + DM-moderation RPCs.
--   * a PRIVATE `media` Storage bucket + RLS so members can read only APPROVED
--     images in their own campaigns (blocked/flagged media is never served).
--
-- Moderation model (automated provider deferred — see 1.6 plan): uploads are
-- 'approved' on arrival (the Edge Function's moderation hook is currently a
-- pass-through). A member report flags an asset (hidden immediately); the DM can
-- block or re-approve. The automated-provider hook plugs in later without schema
-- change (it just sets 'blocked'/'flagged' at upload time instead of 'approved').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- media_assets — one row per uploaded image. Written ONLY by the upload-media
-- Edge Function via the service role (no client insert/update/delete policies).
-- byte_size is the TOTAL stored bytes for the asset (re-encoded original + thumb)
-- and is what counts against the campaign storage cap.
-- ----------------------------------------------------------------------------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  -- The campaign this image belongs to; its first path segment in Storage.
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- Who uploaded it. Kept for attribution/moderation; nulled if the user is
  -- deleted so the asset (and its byte accounting) survives.
  uploaded_by uuid references auth.users (id) on delete set null,
  -- Storage object paths within the private `media` bucket. Convention:
  -- '<campaign_id>/<asset_id>/original.<ext>' and '.../thumb.<ext>'.
  storage_path text not null unique,
  thumb_path text,
  -- The stored (re-encoded) mime type, e.g. image/webp. From the allowlist.
  mime text not null,
  -- Total bytes stored for this asset (original + thumbnail). Counted by
  -- private.campaign_storage_used() against the cap.
  byte_size bigint not null,
  -- Pixel dimensions of the processed original (for layout/UX).
  width int,
  height int,
  -- Original client filename (display only; never used to build a Storage path).
  original_filename text,
  -- Moderation state. 'approved' = servable; 'flagged' = reported, hidden pending
  -- DM review; 'blocked' = taken down, never served; 'pending' reserved for a
  -- future automated provider that needs an async decision.
  moderation_status text not null default 'approved'
    check (moderation_status in ('pending', 'approved', 'flagged', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership/cap reads filter by campaign_id; usage sums do too.
create index media_assets_campaign_idx on public.media_assets (campaign_id);

create trigger set_media_assets_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

alter table public.media_assets enable row level security;

-- SELECT: a campaign member sees APPROVED assets in their campaigns; the DM sees
-- every status in their campaign (so they can review flagged/blocked media).
-- No write policies — the Edge Function (service role) and the SECURITY DEFINER
-- RPCs below are the only writers.
create policy media_assets_select
  on public.media_assets
  for select
  to authenticated
  using (
    (moderation_status = 'approved' and private.is_campaign_member(campaign_id))
    or private.is_campaign_dm(campaign_id)
  );

-- ----------------------------------------------------------------------------
-- media_reports — report-and-takedown ledger. One row per (asset, reporter).
-- Written only via report_media(); DMs may read reports for their campaigns.
-- ----------------------------------------------------------------------------
create table public.media_reports (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (media_asset_id, reporter_id)
);

alter table public.media_reports enable row level security;

-- DMs can read reports for assets in campaigns they run (moderation queue).
create policy media_reports_select_dm
  on public.media_reports
  for select
  to authenticated
  using (
    exists (
      select 1 from public.media_assets a
      where a.id = media_asset_id and private.is_campaign_dm(a.campaign_id)
    )
  );

-- ----------------------------------------------------------------------------
-- campaign_storage_used — total stored bytes for a campaign, summed across all
-- of its assets (blocked ones still occupy Storage until physically deleted, so
-- they count too). Paired with private.campaign_storage_cap() from 0005: the
-- upload-media function accepts an upload only if used + new <= cap.
-- ----------------------------------------------------------------------------
create function private.campaign_storage_used(p_campaign_id uuid)
returns bigint
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(sum(byte_size), 0)::bigint
  from public.media_assets
  where campaign_id = p_campaign_id;
$$;

-- ----------------------------------------------------------------------------
-- report_media — a member reports an asset. Records the report and immediately
-- QUARANTINES the asset (flagged → hidden from serving) if it was approved, so
-- objectionable content stops being served the moment it is reported, pending a
-- DM decision. Never downgrades a blocked asset.
-- ----------------------------------------------------------------------------
create function public.report_media(p_asset_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_campaign uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to report media.' using errcode = 'P0001';
  end if;

  select campaign_id into v_campaign from public.media_assets where id = p_asset_id;
  if v_campaign is null then
    raise exception 'That media does not exist.' using errcode = 'P0001';
  end if;
  if not private.is_campaign_member(v_campaign) then
    raise exception 'You can only report media in your own campaigns.' using errcode = 'P0001';
  end if;

  insert into public.media_reports (media_asset_id, reporter_id, reason)
  values (p_asset_id, v_uid, p_reason)
  on conflict (media_asset_id, reporter_id)
    do update set reason = excluded.reason, created_at = now();

  -- Hide immediately on first report; a DM can re-approve or block via
  -- set_media_status. Leave 'blocked'/'flagged' as-is.
  update public.media_assets
  set moderation_status = 'flagged'
  where id = p_asset_id and moderation_status = 'approved';
end;
$$;

-- ----------------------------------------------------------------------------
-- set_media_status — DM moderation decision. Only the campaign's DM may approve
-- (un-hide) or block (permanent takedown) an asset. Physical deletion of a
-- blocked asset's Storage bytes is handled out-of-band by the upload-media
-- function's takedown path; here we only flip serving eligibility.
-- ----------------------------------------------------------------------------
create function public.set_media_status(p_asset_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  if p_status not in ('approved', 'blocked') then
    raise exception 'Status must be approved or blocked.' using errcode = 'P0001';
  end if;

  select campaign_id into v_campaign from public.media_assets where id = p_asset_id;
  if v_campaign is null then
    raise exception 'That media does not exist.' using errcode = 'P0001';
  end if;
  if not private.is_campaign_dm(v_campaign) then
    raise exception 'Only the campaign DM can moderate media.' using errcode = 'P0001';
  end if;

  update public.media_assets set moderation_status = p_status where id = p_asset_id;
end;
$$;

grant execute on function private.campaign_storage_used(uuid) to authenticated;
grant execute on function public.report_media(uuid, text) to authenticated;
grant execute on function public.set_media_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Storage: a PRIVATE `media` bucket. public=false means objects are reachable
-- only via signed URLs, and only to roles the RLS policy below admits. The
-- bucket-level type/size limits are a coarse backstop; the Edge Function does the
-- authoritative magic-byte + size + cap checks.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Read policy: an authenticated user may read a `media` object only if there is
-- an APPROVED media_assets row pointing at that exact path AND they are a member
-- of that asset's campaign. This is what makes createSignedUrl succeed for
-- members and fail for everyone else — and ensures flagged/blocked media (no
-- longer 'approved') can't be fetched even by someone who knows the path.
-- Writes/updates/deletes have NO policy: only the service-role Edge Function
-- (which bypasses RLS) mutates Storage.
create policy media_objects_read_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'media'
    and exists (
      select 1 from public.media_assets a
      where (a.storage_path = storage.objects.name or a.thumb_path = storage.objects.name)
        and a.moderation_status = 'approved'
        and private.is_campaign_member(a.campaign_id)
    )
  );
