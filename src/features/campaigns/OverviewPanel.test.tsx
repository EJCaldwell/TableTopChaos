/**
 * Component tests for the campaign roster (Phase 8.1, closing a Phase 7.4 gap).
 *
 * WHY THESE EXIST. 7.4's server-side QA proved the DATA is right — usernames are
 * required and unique, and `campaign_character_names` returns identical results
 * to a DM and to a player. What it could not prove is that React draws it. A
 * component that fetched perfectly and then rendered a field that no longer
 * exists would have passed every one of those checks and been visibly broken.
 *
 * These assert the three things the owner actually asked for:
 *   1. the roster reads "username (Character)";
 *   2. it reads the SAME for a player as for the DM — the entire reason
 *      migration 0041 exists;
 *   3. no member ever renders as "Unnamed adventurer", the fallback 7.4 deleted.
 *
 * `./api` is mocked wholesale: this is a test of rendering, not of the network,
 * and the data layer it stands in for is already covered by the server-side QA.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPanel } from './OverviewPanel'
import type { Campaign, Member } from './api'

// Hoisted so the factory below can see them — vi.mock is lifted above imports.
const { listCharacterNames, listInviteCodes } = vi.hoisted(() => ({
  listCharacterNames: vi.fn(),
  listInviteCodes: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  // Keep the real GAME_MODES and types; replace only what touches the network.
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, listCharacterNames, listInviteCodes }
})

// SchedulePanel opens its own Supabase queries and a realtime channel on mount.
// It is a sibling concern with its own coverage; stubbing it keeps a roster test
// from failing for reasons that have nothing to do with the roster.
vi.mock('../schedule/SchedulePanel', () => ({
  SchedulePanel: () => null,
}))

const DM_ID = '11111111-1111-1111-1111-111111111111'
const PLAYER_ID = '22222222-2222-2222-2222-222222222222'
const NO_CHARACTER_ID = '33333333-3333-3333-3333-333333333333'

const campaign = {
  id: 'c0000000-0000-0000-0000-000000000000',
  name: 'Test Campaign',
  owner_id: DM_ID,
  game_mode: 'tabletop',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  read_only_since: null,
  lapse_warned_days: null,
} as unknown as Campaign

const members: Member[] = [
  { userId: DM_ID, role: 'dm', username: 'EJ' },
  { userId: PLAYER_ID, role: 'player', username: 'yrdy' },
  { userId: NO_CHARACTER_ID, role: 'player', username: 'EJ_Test' },
]

/** Renders the panel as a given viewer and waits for the character names. */
async function renderAs(opts: { isDm: boolean; currentUserId: string }) {
  render(
    <MemoryRouter>
      <OverviewPanel
        campaign={campaign}
        members={members}
        isDm={opts.isDm}
        currentUserId={opts.currentUserId}
      />
    </MemoryRouter>,
  )
  await waitFor(() => expect(listCharacterNames).toHaveBeenCalledWith(campaign.id))
}

/** The roster as rendered, one string per member row. */
function rosterLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim())
}

beforeEach(() => {
  vi.clearAllMocks()
  listInviteCodes.mockResolvedValue([])
  listCharacterNames.mockResolvedValue(
    new Map([
      [DM_ID, 'Thorin'],
      [PLAYER_ID, 'EJ'],
    ]),
  )
})

describe('OverviewPanel roster', () => {
  it('renders each member as "username (Character)"', async () => {
    await renderAs({ isDm: true, currentUserId: DM_ID })
    await waitFor(() => expect(rosterLines()[1]).toContain('yrdy (EJ)'))
  })

  it('marks the viewer with "(you)" without losing their character name', async () => {
    await renderAs({ isDm: true, currentUserId: DM_ID })
    await waitFor(() => {
      expect(rosterLines()[0]).toContain('EJ (Thorin)')
      expect(rosterLines()[0]).toContain('(you)')
    })
  })

  it('shows a member with no character as bare username — no empty brackets', async () => {
    await renderAs({ isDm: true, currentUserId: DM_ID })
    await waitFor(() => {
      const line = rosterLines().find((l) => l.startsWith('EJ_Test'))
      expect(line).toBeDefined()
      expect(line).not.toContain('()')
    })
  })

  it('renders IDENTICALLY for a player and for the DM', async () => {
    // The whole point of migration 0041. Before it, a player could not read
    // another player's character name and the roster read inconsistently.
    await renderAs({ isDm: true, currentUserId: DM_ID })
    const asDm = rosterLines()
    expect(asDm).toHaveLength(3)

    // cleanup() between renders comes from src/test/setup.ts; without it the
    // second render would stack on top of the first and every query below would
    // be matching six rows.
    cleanup()
    await renderAs({ isDm: false, currentUserId: PLAYER_ID })
    const asPlayer = rosterLines()

    // Strip the viewer marker, which is the one thing that SHOULD differ.
    const strip = (l: string[]) => l.map((s) => s.replace(' (you)', ''))
    expect(strip(asPlayer)).toEqual(strip(asDm))
  })

  it('never renders the deleted "Unnamed adventurer" fallback', async () => {
    await renderAs({ isDm: true, currentUserId: DM_ID })
    expect(screen.queryByText(/Unnamed adventurer/i)).toBeNull()
  })

  it('renders usernames even when the character lookup fails', async () => {
    // The countdown/name lookup is a nicety; the roster is not. A failure must
    // degrade the line, never lose it.
    listCharacterNames.mockRejectedValue(new Error('rls said no'))
    await renderAs({ isDm: true, currentUserId: DM_ID })
    await waitFor(() => {
      expect(rosterLines()[0]).toContain('EJ')
      expect(rosterLines()[1]).toContain('yrdy')
    })
    expect(rosterLines()[1]).not.toContain('(')
  })

  it('shows the member count', async () => {
    await renderAs({ isDm: true, currentUserId: DM_ID })
    expect(screen.getByText(/Members \(3\)/)).toBeInTheDocument()
  })
})
