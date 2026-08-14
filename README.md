# TableTopChaos

A "glorified notepad" web app for running and storing tabletop RPG campaigns.
DMs keep private organizing tabs and can view every player's sheet; each player
maintains a free-form character workspace. See [PLANNING.md](./PLANNING.md) for
the full phased implementation plan and locked-in decisions.

**Stack:** React + TypeScript + Vite, talking directly to Supabase (Auth,
Postgres with Row-Level Security, Storage, Edge Functions). No app server.

## Current status

**Phase 1.1 — Project & Supabase setup.** The repo scaffold, typed Supabase
client, and the initial migration (`profiles` + default-deny RLS) are in place.

## Getting started

### Prerequisites

- Node.js LTS (project tested on v24)
- A Supabase project — either the hosted cloud project or a local stack via the
  [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from
# Supabase → Project Settings → API.
```

### 3. Apply database migrations

Migrations live in `supabase/migrations/` and are checked into the repo.

```bash
# Local stack:
supabase start
supabase db reset          # applies all migrations in order

# Or, against a linked remote project:
supabase link --project-ref <your-project-ref>
supabase db push
```

After applying migrations, regenerate the typed client definitions:

```bash
supabase gen types typescript --linked > src/lib/database.types.ts
```

### 4. Run the app

```bash
npm run dev
```

Open http://localhost:5173. The landing page runs a **Supabase connection
check**: it should report a successful query returning **0 rows**, which proves
the database is reachable *and* in a default-deny RLS posture (QA 1.1.3).

## Project layout

```
src/
  lib/
    env.ts              # validated env-var access
    supabase.ts         # the single shared, typed Supabase client
    database.types.ts   # generated schema types (stub until project is linked)
  features/
    health/             # ConnectionCheck — temporary setup/QA panel
  styles/
    tokens.css          # design tokens + base reset
  App.tsx               # route table
  main.tsx              # entry point / providers
supabase/
  config.toml           # Supabase CLI config
  migrations/           # SQL migrations (source of truth for the schema)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check without emitting |
# dnd-management
