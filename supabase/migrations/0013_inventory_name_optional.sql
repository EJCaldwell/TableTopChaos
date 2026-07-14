-- ============================================================================
-- 0013_inventory_name_optional.sql — allow a blank inventory item name.
--
-- Phase 2.2 UX tweak (mirrors 0011 for sheet fields): a freshly-added item should
-- show ghost/placeholder text ("Item name") rather than a literal pre-filled
-- word the player must delete. That means an item may legitimately have an EMPTY
-- name until the player types one, so we relax the original
-- `char_length(name) between 1 and 200` check to `char_length(name) <= 200`.
-- name stays NOT NULL with a '' default; only the lower bound is dropped.
-- ============================================================================

alter table public.inventory_items
  drop constraint if exists inventory_items_name_check;

alter table public.inventory_items
  add constraint inventory_items_name_check
  check (char_length(name) <= 200);
