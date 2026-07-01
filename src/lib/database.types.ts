/**
 * Generated database type definitions for the typed Supabase client.
 *
 * Owns: the TypeScript shape of every table/view/function exposed by the
 * Postgres schema, so client queries are type-checked against the real schema.
 *
 * IMPORTANT: This file is normally GENERATED, not hand-edited. Once a Supabase
 * project exists, regenerate it after each migration with:
 *
 *   supabase gen types typescript --linked > src/lib/database.types.ts
 *
 * For now it is a hand-written stub matching migration 0001 (the `profiles`
 * table) so the app type-checks before a project is provisioned. Replace this
 * whole file with the generated output as soon as the project is linked.
 */

/** JSON value type used by Supabase's generated types. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * The `public` schema. Mirrors migration 0001_init.sql.
 *
 * `profiles` is 1:1 with `auth.users` and holds app-level user info we don't
 * want to (or can't) keep in the auth schema. RLS currently denies all access
 * (default-deny); read/write policies arrive in subphase 1.2.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          /** Primary key; equals `auth.users.id`. */
          id: string
          /** User-facing name shown in campaigns. Nullable until set. */
          display_name: string | null
          /** Storage path/URL of the avatar image. Nullable. */
          avatar_url: string | null
          /** Row creation timestamp (UTC, ISO 8601). */
          created_at: string
          /** Last update timestamp (UTC, ISO 8601). */
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
