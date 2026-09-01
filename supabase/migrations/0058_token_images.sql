-- ============================================================================
-- 0058 — token artwork (9.1.2g)
--
-- Owner request: a player's token shows the portrait they chose for their
-- character; a DM's token shows whichever creature the DM picks.
--
-- WHY THE ASSET ID LIVES ON THE TOKEN, and not read through character_id/npc_id
-- at render time. This is the whole design decision, and it is a permissions
-- one:
--
--   * `npcs` is DM-only. A player cannot read an NPC row, so they cannot follow
--     npc_id -> portrait_asset_id. A monster on the board would be a blank
--     circle for exactly the people who need to see it.
--   * `characters` is owner-or-DM. One player cannot read another player's
--     character row either, so the same hole exists for party portraits.
--   * But `media_assets` and `storage.objects` are scoped to CAMPAIGN
--     MEMBERSHIP (0008), not to the row that happens to reference the image. A
--     member may read any approved asset in their campaign — they just have to
--     know its id.
--
-- So copying the asset id onto the token, which every member may already read,
-- makes the picture visible to the table without widening a single policy. The
-- alternative — letting players read NPC rows, or peers' characters — would
-- have traded a monster's portrait for the DM's notes on it.
--
-- The copy is deliberate, not a cache to keep in step: changing a character's
-- portrait later does not silently change the token already on the board, and
-- re-placing the token is how you take the new one. A token is a piece on a
-- table, not a live view of a character sheet.
-- ============================================================================

alter table public.playspace_tokens
  add column if not exists image_asset_id uuid
    references public.media_assets (id) on delete set null;

comment on column public.playspace_tokens.image_asset_id is
  'Artwork for this token. A COPY of a character or NPC portrait''s asset id, taken when the token is placed — not a live reference. Stored here because media_assets is campaign-scoped while npcs/characters are not, so this is what lets every member see the picture without being able to read the row it came from. See migration 0058.';

-- No new policies. The column rides on the token row, which members already read
-- and only its owner (or the DM) may write, and the image itself is already
-- governed by media_assets_select / media_objects_read_members from 0008.
--
-- Asserted rather than asserted-by-comment: if a future migration adds an anon
-- policy to either media table, the picture would leak to signed-out visitors
-- along with everything else, and this is the cheapest place to notice.
do $$
declare v_anon int;
begin
  select count(*) into v_anon
  from pg_policies
  where schemaname = 'public' and tablename = 'media_assets' and 'anon' = any (roles);
  if v_anon > 0 then
    raise exception '0058: media_assets has % anon policy(s); token art would be public', v_anon;
  end if;
end $$;
