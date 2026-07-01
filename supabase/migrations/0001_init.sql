-- ===========================================================================
-- Migration 0001 — Initial schema: profiles + default-deny baseline.
--
-- This migration establishes the security FOUNDATION for the whole app:
--   1. The `profiles` table (1:1 with auth.users) — app-level user data.
--   2. A reusable `updated_at` trigger function.
--   3. RLS ENABLED on profiles with NO policies yet  ->  default-deny.
--
-- Why no policies here: subphase 1.1 deliberately ships a pure default-deny
-- posture so QA 1.1.3 can prove "an unauthenticated (or any) query returns no
-- rows". The own-profile read/update policies and the signup trigger that
-- populates this table arrive in migration 0002 (subphase 1.2 — Auth).
--
-- Postgres RLS reminder: enabling RLS on a table with zero policies denies ALL
-- access through the anon/authenticated API roles. The service-role key (used
-- only by Edge Functions) bypasses RLS and is never shipped to the browser.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: set_updated_at()
-- Generic trigger function that stamps NEW.updated_at = now() on every UPDATE.
-- Defined once here and reused by every table that has an updated_at column,
-- so we never hand-maintain timestamps in application code.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Always overwrite with the server clock; clients must not control this.
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger helper: forces updated_at to the server time. Reused by all tables with an updated_at column.';

-- ---------------------------------------------------------------------------
-- Table: profiles
-- One row per user, keyed by and cascading from auth.users.id. Holds app-level
-- identity (display name, avatar) we surface inside campaigns. We keep this
-- separate from auth.users because the auth schema is managed by Supabase and
-- should not be extended directly.
--
-- The row is created automatically on signup by a trigger added in migration
-- 0002; nothing in the client inserts profiles directly.
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- PK = the auth user's id. ON DELETE CASCADE so deleting the auth user
  -- (account deletion, Phase 5.1) automatically removes the profile.
  id uuid primary key references auth.users (id) on delete cascade,

  -- User-facing name shown to other campaign members. Nullable until the user
  -- sets it; the UI prompts for it after signup.
  display_name text,

  -- Storage path/URL of the avatar image (uploaded via the 1.6 media pipeline).
  avatar_url text,

  -- Audit timestamps in UTC. created_at is immutable; updated_at is maintained
  -- by the set_updated_at() trigger below.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  '1:1 with auth.users. App-level user identity (display name, avatar). RLS default-deny until 1.2 adds own-profile policies.';

-- Keep updated_at fresh on every change to a profile row.
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enable Row-Level Security — DEFAULT DENY.
-- With RLS on and no policies defined, the anon and authenticated roles can
-- neither read nor write any row. Policies are added per-feature in later
-- migrations. This is the security backbone: every table is locked by default
-- and opened only by an explicit, commented policy.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
