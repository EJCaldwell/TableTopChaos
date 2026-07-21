-- ============================================================================
-- 0019_revert_encounters.sql — reverts 0018 (encounters + encounter_images).
--
-- The Phase 3.2 encounters feature was rolled back at the user's request so it
-- can be re-specified from scratch. This drops both tables (encounter_images
-- first, for the FK) and the private.is_encounter_dm helper. `if exists` keeps a
-- fresh-database replay harmless (the 0018 file was removed, so the tables were
-- never created on a clean run).
-- ============================================================================
drop table if exists public.encounter_images;
drop table if exists public.encounters;
drop function if exists private.is_encounter_dm(uuid);
