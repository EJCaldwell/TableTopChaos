/**
 * Vitest setup — runs once before every test file.
 *
 * Two jobs:
 *
 * 1. **Register the jest-dom matchers.** Importing the `/vitest` entry point
 *    (rather than the bare package) wires them into Vitest's `expect` *and*
 *    augments its TypeScript types, so `toBeInTheDocument()` is both available at
 *    runtime and known to tsc.
 *
 * 2. **Unmount rendered components between tests.** React Testing Library
 *    normally registers this itself — but ONLY when a global `afterEach` exists,
 *    which it does not here because `globals: false` is set in vitest.config.ts.
 *    Without it, every `render()` accumulates in the same document: queries start
 *    matching elements left over from earlier tests, and the symptom is
 *    "Found multiple elements" or an assertion passing against a stale render.
 *
 *    Found the hard way while writing the first component test, where three
 *    accumulated renders made a member-count query ambiguous and a rejected-
 *    promise test read a previous test's successful output.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
