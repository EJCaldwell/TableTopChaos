/**
 * Centralized, validated access to build-time environment variables.
 *
 * Owns: reading Vite's `import.meta.env` once, asserting the Supabase config is
 * present, and re-exporting it as typed constants. Every other module imports
 * from here instead of touching `import.meta.env` directly, so a missing var
 * fails fast at startup with a clear message rather than as a confusing
 * "fetch to undefined" error deep in the Supabase client.
 */

/**
 * Reads a required `VITE_`-prefixed env var, throwing if it is empty/missing.
 *
 * @param key - The full env var name (e.g. `VITE_SUPABASE_URL`).
 * @returns The trimmed string value.
 * @throws Error at module load if the variable is unset — this is intentional:
 *         the app cannot function without Supabase config, so we want a loud,
 *         immediate failure during development rather than a silent broken state.
 */
function requireEnv(key: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${key}". ` +
        `Copy .env.example to .env and fill in your Supabase project values.`,
    )
  }
  return value.trim()
}

/** Base URL of the Supabase project (e.g. https://xxxx.supabase.co). */
export const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL')

/**
 * Supabase publishable/anon key. PUBLIC by design — it only grants whatever
 * Row-Level Security policies allow for anonymous/authenticated roles.
 */
export const SUPABASE_ANON_KEY = requireEnv('VITE_SUPABASE_ANON_KEY')
