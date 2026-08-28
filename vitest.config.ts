/**
 * Vitest configuration (Phase 8.1).
 *
 * Kept separate from vite.config.ts on purpose: that file describes how the app
 * is BUILT and served, this one how it is TESTED. Merging them would mean every
 * production build parses test-only settings, and every change to one config
 * risks the other.
 *
 * `environment: 'jsdom'` because the component tests render React. The pure-logic
 * tests do not need a DOM, but splitting the suite into two environments costs
 * more in config than jsdom costs in startup.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Registers the jest-dom matchers (toBeInTheDocument, toHaveTextContent…)
    // and their TypeScript augmentations.
    setupFiles: ['./src/test/setup.ts'],
    // Tests live next to the code they cover, so a module and its test move
    // together and an untested module is visible in the file listing.
    include: ['src/**/*.test.{ts,tsx}'],
    // Deliberately NOT using globals. Importing describe/it/expect explicitly
    // keeps the app's tsconfig free of test-only ambient types, and makes it
    // obvious in each file what it depends on.
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only what tests could reasonably cover. Excluding the rest keeps the
      // percentage meaningful instead of measuring how much of the app is
      // untestable glue.
      include: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/lib/database.types.ts'],
    },
  },
})
