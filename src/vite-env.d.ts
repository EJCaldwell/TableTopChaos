/// <reference types="vite/client" />

/**
 * Ambient typing for our `VITE_`-prefixed environment variables, so
 * `import.meta.env.VITE_SUPABASE_URL` is typed rather than `any`.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
