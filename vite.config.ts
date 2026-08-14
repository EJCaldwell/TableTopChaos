/**
 * Vite build/dev configuration for the TableTopChaos SPA.
 *
 * Owns: the dev server and production bundling for the React/TypeScript front
 * end. There is no app server in this project — the built static assets talk
 * directly to Supabase — so this config stays intentionally minimal.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Fail loudly if 5173 is taken rather than silently picking another port,
    // so the dev URL is predictable (useful later for Supabase auth redirects).
    port: 5173,
    strictPort: false,
  },
})
