-- ============================================================================
-- 0029_single_dm_comments.sql — drop the "co-DM" idea from the schema's docs.
--
-- Co-DM (more than one member with role = 'dm' in a campaign) was never built
-- and is explicitly out of scope, but 0003's comments described the role enum as
-- a co-DM model "coming in 5.2". Nothing in the app has ever created a second DM
-- member: the only writer of role = 'dm' is the add_owner_as_dm trigger, and
-- client-minted invite codes always grant 'player'.
--
-- COMMENTS ONLY — no table, type, policy or function behaviour changes here. The
-- matching comment text in 0003_campaigns.sql was corrected in place as well, so
-- a fresh database built from the migrations and an existing one that runs this
-- file end up describing themselves identically.
--
-- INVARIANT going forward: exactly one 'dm' member per campaign — its owner.
-- Anything that needs "can this user administer the campaign?" should keep using
-- private.is_campaign_dm(); anything destructive stays owner-based
-- (campaigns_delete_owner). Do not add a path that grants a second 'dm'.
-- ============================================================================

comment on type public.campaign_role is
  'A member''s role within one campaign. Exactly one ''dm'' per campaign (the owner); everyone else is ''player''.';

comment on function public.add_owner_as_dm() is
  'AFTER INSERT on campaigns: enrolls the owner as the campaign''s single dm member, so every DM predicate can just check campaign_members.';

comment on policy "campaigns_update_dm" on public.campaigns is
  'Only the campaign''s DM (which is its owner) may update it.';
