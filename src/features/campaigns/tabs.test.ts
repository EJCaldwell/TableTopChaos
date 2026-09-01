/**
 * Tests for the tab catalog's role and game-mode filtering (9.1.2b).
 *
 * The Maps/Battlemap tabs added two new ways for the rail to be wrong — a
 * DM-only tab leaking to players, and the Battlemap panel appearing in a
 * campaign that already draws the map full-size. Both are pure functions of the
 * catalog, so both belong here rather than in a browser checklist.
 */
import { describe, expect, it } from 'vitest'
import { railTabs, tabsForRole } from './tabs'

const keys = (isDm: boolean) => tabsForRole(isDm).map((t) => t.key)

describe('tabsForRole — maps', () => {
  it('gives the DM the Maps tab', () => {
    expect(keys(true)).toContain('maps')
  })

  it('never gives a player the Maps tab', () => {
    // Switching the live map would let one person yank the shared view out
    // from under the whole table.
    expect(keys(false)).not.toContain('maps')
  })
})

describe('no battlemap tab', () => {
  it('is absent for both roles', () => {
    // The map fills the workspace area in ALL modes as of 2026-08-28. A tab
    // would be a second copy of what is already on screen. This test exists so
    // re-adding one is a deliberate act with a failing test to answer for.
    expect(keys(true)).not.toContain('battlemap')
    expect(keys(false)).not.toContain('battlemap')
  })
})

describe('rail', () => {
  it('draws Maps in the rail rather than hiding it', () => {
    const rail = railTabs(tabsForRole(true)).map((t) => t.key)
    expect(rail).toContain('maps')
  })
})
