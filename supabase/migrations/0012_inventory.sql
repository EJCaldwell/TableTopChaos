-- ============================================================================
-- 0012_inventory.sql — Phase 2.2 backend: per-character inventory.
--
-- Owns the persistence side of a character's inventory — the gear/items the
-- character carries. One row per item, scoped to a single character:
--   * public.inventory_items (character, name, qty, notes, equipped flag).
--
-- ACCESS MODEL — identical to the character sheet (2.1): the owning player has
-- full read/write; the campaign DM has READ-ONLY; other players have no access.
-- Rather than re-deriving that here, inventory reuses the SECURITY DEFINER
-- predicates from migration 0010:
--   private.can_read_character(character_id)  — owner OR campaign DM
--   private.can_write_character(character_id) — owner only
-- So inventory access stays automatically consistent with the character it hangs
-- off, and there is no separate policy logic to keep in sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: inventory_items
-- One row per item a character carries. Deleting the character cascades its
-- items away. `qty` is a positive count (default 1); `notes` is free text;
-- `equipped` is an optional flag the UI can toggle (e.g. worn armor / wielded
-- weapon). `position` gives the player a stable manual ordering, mirroring the
-- sheet's sections/fields convention.
-- ----------------------------------------------------------------------------
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  -- Item name (1..200 chars — a touch longer than sheet labels since item names
  -- like "Potion of Greater Healing (x3, from the vault)" run long).
  name text not null check (char_length(name) between 1 and 200),
  -- How many the character has. Positive; defaults to a single item.
  qty integer not null default 1 check (qty > 0),
  -- Free-text notes (description, attunement, where it came from). '' when unset.
  notes text not null default '',
  -- Whether the item is currently equipped/worn/wielded. Purely a UI flag.
  equipped boolean not null default false,
  -- Manual display order within the character's inventory (lowest first).
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inventory_items is
  'Items a character carries. RLS reuses migration 0010 predicates: owner read/write, campaign DM read-only, other players no access.';

-- Inventory is always fetched/ordered per character.
create index inventory_items_character_id_idx
  on public.inventory_items (character_id, position);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- Row-Level Security — mirrors sheet_sections/sheet_fields (0010).
-- ============================================================================

alter table public.inventory_items enable row level security;

-- Read: anyone who may read the parent character (owner or campaign DM).
create policy "inventory_items_select_readable"
  on public.inventory_items
  for select
  to authenticated
  using (private.can_read_character(character_id));

comment on policy "inventory_items_select_readable" on public.inventory_items is
  'An inventory item is readable by anyone who can read its character (owner or campaign DM).';

-- Insert: only the character's owner, attaching to a character they own.
create policy "inventory_items_insert_owner"
  on public.inventory_items
  for insert
  to authenticated
  with check (private.can_write_character(character_id));

comment on policy "inventory_items_insert_owner" on public.inventory_items is
  'Only the character''s owner may add inventory items.';

-- Update: owner only. WITH CHECK prevents re-parenting an item onto a character
-- the caller does not own.
create policy "inventory_items_update_owner"
  on public.inventory_items
  for update
  to authenticated
  using (private.can_write_character(character_id))
  with check (private.can_write_character(character_id));

comment on policy "inventory_items_update_owner" on public.inventory_items is
  'Only the character''s owner may edit inventory items.';

-- Delete: owner only.
create policy "inventory_items_delete_owner"
  on public.inventory_items
  for delete
  to authenticated
  using (private.can_write_character(character_id));

comment on policy "inventory_items_delete_owner" on public.inventory_items is
  'Only the character''s owner may delete inventory items.';
