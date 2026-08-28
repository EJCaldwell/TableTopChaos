-- ============================================================================
-- 0038_avatar_storage.sql — profile avatars in the existing `media` bucket
-- (Phase 7.3.1).
--
-- WHAT THIS OWNS: one additional read policy on storage.objects, and the
-- definition of what profiles.avatar_url actually contains.
--
-- WHY AVATARS NEED A POLICY OF THEIR OWN. The 0008 read policy admits an object
-- only when an APPROVED `media_assets` row points at that exact path and the
-- caller is a member of that asset's campaign. An avatar belongs to a PERSON,
-- not a campaign — it has no campaign_id, so it can have no media_assets row,
-- so under 0008 alone nobody could ever read one, including its owner. Policies
-- on a table are OR-ed, so this is purely additive: it widens reads for
-- `avatars/…` paths and changes nothing about campaign media.
--
-- WHY NOT A SEPARATE PUBLIC BUCKET. A public bucket would make every avatar
-- readable by URL to anyone on the internet, forever, with no way to revoke it.
-- Keeping avatars in the private bucket means they are reachable only through a
-- short-lived signed URL that this policy has to authorise first.
--
-- WHO CAN SEE YOUR AVATAR: you, and anyone you share a campaign with. That is
-- exactly the visibility your PROFILE already has (`profiles_select_comembers`,
-- migration 0004), and the two must agree — an avatar visible to someone who
-- cannot see the profile it belongs to would be a quiet widening of what the
-- roster discloses.
--
-- PATH CONVENTION, which this policy depends on:
--     avatars/<user_id>/<random>.webp
-- The user id is the SECOND segment. It is a random filename rather than a
-- fixed one so that replacing an avatar produces a new path: a fixed path
-- overwritten in place would keep serving the old image from cache, and
-- "I changed my avatar and nothing happened" is indistinguishable from a bug.
-- The Edge Function deletes the previous object after the profile row is
-- updated, so a failure leaves an orphaned file rather than a broken avatar.
--
-- Only the service role writes here; there are still no INSERT/UPDATE/DELETE
-- policies on storage.objects for any client role.
-- ============================================================================

-- avatar_url holds a storage PATH, not a URL. Named `avatar_url` since 0001 and
-- not renamed here — a column rename is a breaking change for one word — but
-- the distinction matters: the bucket is private, so a URL would be a
-- short-lived signed one and storing it would mean storing something that
-- expires in an hour.
comment on column public.profiles.avatar_url is
  'Storage PATH of the avatar within the private `media` bucket '
  '(avatars/<user_id>/<random>.webp), NOT a URL. Resolve with createSignedUrl. '
  'Written only by the upload-media Edge Function (service role). See 0038.';

create policy media_objects_read_avatars
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'media'
    and storage.objects.name like 'avatars/%'
    -- Guard the cast: split_part returns '' for a malformed path, and ''::uuid
    -- raises rather than returning null — inside a policy that would surface as
    -- an opaque error on an unrelated read. Only the service role can write
    -- these paths, so this should be unreachable; it costs nothing to be sure.
    and split_part(storage.objects.name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    and (
      split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
      or private.shares_campaign_with(split_part(storage.objects.name, '/', 2)::uuid)
    )
  );

comment on policy media_objects_read_avatars on storage.objects is
  'Avatars are readable by their owner and by anyone sharing a campaign with '
  'them — the same visibility as the profile row itself (0004). Additive to '
  'media_objects_read_members, which cannot admit them (no media_assets row).';
