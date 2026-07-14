-- ============================================================================
-- 0011_sheet_field_label_optional.sql — allow a blank sheet-field label.
--
-- Phase 2.1 UX tweak: a freshly-added field should show ghost/placeholder text
-- ("Label") rather than a literal pre-filled word the player has to delete. That
-- means a field may legitimately have an EMPTY label until the player types one,
-- so we relax the original `char_length(label) between 1 and 120` check (which
-- forbade '') to `char_length(label) <= 120`. Label stays NOT NULL with a ''
-- default; only the lower bound is dropped. Value was already free-form.
-- ============================================================================

-- Drop the original 1..120 check (auto-named `sheet_fields_label_check` when the
-- inline `check (...)` was declared in 0010) and replace it with an upper-bound
-- only, so '' is now valid. `if exists` keeps this re-runnable.
alter table public.sheet_fields
  drop constraint if exists sheet_fields_label_check;

alter table public.sheet_fields
  add constraint sheet_fields_label_check
  check (char_length(label) <= 120);
