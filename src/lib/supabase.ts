/**
 * The single shared Supabase client for the whole app.
 *
 * Owns: constructing one typed `SupabaseClient` and exporting it. Importing a
 * single instance everywhere (rather than calling `createClient` per module)
 * matters because the client holds the auth session and its realtime/refresh
 * timers — multiple instances would fight over the stored session.
 *
 * The client is typed with `Database` (src/lib/database.types.ts), so
 * `supabase.from('profiles')` is fully type-checked against the schema.
 *
 * Security note: this uses the PUBLIC anon key. It can only do what Row-Level
 * Security policies permit. Never swap in the service-role key here — that key
 * bypasses RLS and must live only in server-side Edge Functions.
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'
import type { Database } from './database.types'

/**
 * App-wide Supabase client.
 *
 * Auth options:
 *  - persistSession: keep the session in localStorage so a refresh stays logged in.
 *  - autoRefreshToken: transparently refresh the access token before expiry.
 *  - detectSessionInUrl: needed so email-confirmation / OAuth redirects that
 *    carry tokens in the URL hash are picked up automatically.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
