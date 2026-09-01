/**
 * Tests for the scheduling panel's date handling (Phase 4.3, tested 2026-09-01).
 *
 * Timezone conversion is the classic place for a bug that is invisible to
 * whoever wrote it — it works perfectly until someone in another timezone uses
 * it. These assertions are written to hold in ANY timezone the suite runs in,
 * which is why most of them check round-trips and relationships rather than
 * literal strings.
 */
import { describe, expect, it } from 'vitest'
import {
  isoToLocalInput,
  localInputToIso,
  nowLocalInput,
  sortSessions,
  startOfCurrentMinute,
} from './when'
import type { ScheduleSession } from './api'

const session = (proposed_at: string | null, created_at = '2026-01-01T00:00:00Z') =>
  ({ proposed_at, created_at }) as unknown as ScheduleSession

describe('isoToLocalInput / localInputToIso', () => {
  it('round-trips an instant back to itself', () => {
    // The property that matters, and it holds in every timezone: display the
    // stored instant, hand it back unchanged, and get the same instant.
    const iso = '2026-09-15T18:30:00.000Z'
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso)
  })

  it('round-trips a range of instants across the year', () => {
    // Spread across months so a DST transition in the runner's zone is included.
    for (const iso of [
      '2026-01-15T08:00:00.000Z',
      '2026-03-29T02:30:00.000Z',
      '2026-07-04T23:59:00.000Z',
      '2026-11-01T06:00:00.000Z',
    ]) {
      expect(localInputToIso(isoToLocalInput(iso))).toBe(iso)
    }
  })

  it('produces exactly the shape the input expects', () => {
    // "YYYY-MM-DDTHH:mm" — no seconds, no zone. A stray "Z" or ":00" makes the
    // input silently refuse the value and render blank.
    expect(isoToLocalInput('2026-09-15T18:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('is NOT a naive slice of the ISO string', () => {
    // `iso.slice(0, 16)` would pass the shape check above and show a user in
    // Denver a session six hours from when it actually is. This test only means
    // something in a non-UTC zone, so it is written to be a no-op in UTC rather
    // than a false failure.
    const iso = '2026-09-15T18:30:00.000Z'
    const offset = new Date(iso).getTimezoneOffset()
    if (offset !== 0) {
      expect(isoToLocalInput(iso)).not.toBe(iso.slice(0, 16))
    }
  })

  it('treats empty values as absent, both ways', () => {
    expect(isoToLocalInput(null)).toBe('')
    expect(localInputToIso('')).toBeNull()
  })
})

describe('startOfCurrentMinute', () => {
  it('discards seconds and milliseconds', () => {
    const now = new Date('2026-09-01T12:34:56.789Z')
    expect(startOfCurrentMinute(now)).toBe('2026-09-01T12:34:00.000Z')
  })

  it('is never AFTER what the Now button produces — the bug this exists for', () => {
    // The defect: comparing a proposal against the exact moment rejected the
    // app's own "Now" shortcut, because the button truncates to the minute and
    // is therefore a second or two "in the past" by the time you click Propose.
    for (const s of [0, 1, 30, 59]) {
      const now = new Date(`2026-09-01T12:34:${String(s).padStart(2, '0')}.500Z`)
      const floor = Date.parse(startOfCurrentMinute(now))
      const button = Date.parse(localInputToIso(nowLocalInput(now))!)
      expect(button).toBeGreaterThanOrEqual(floor)
    }
  })

  it('does not mutate the date it is given', () => {
    // setSeconds mutates; a caller reusing its own `now` afterwards would find
    // it silently changed.
    const now = new Date('2026-09-01T12:34:56.789Z')
    startOfCurrentMinute(now)
    expect(now.toISOString()).toBe('2026-09-01T12:34:56.789Z')
  })
})

describe('sortSessions', () => {
  it('puts the soonest session first', () => {
    const out = sortSessions([
      session('2026-10-01T00:00:00Z'),
      session('2026-09-01T00:00:00Z'),
    ])
    expect(out[0].proposed_at).toBe('2026-09-01T00:00:00Z')
  })

  it('puts undated sessions LAST, not first', () => {
    // A "Time TBD" proposal sorting to the top would push the actual next
    // session out of view, which is the one thing the panel is for.
    const out = sortSessions([
      session(null),
      session('2026-09-01T00:00:00Z'),
      session(null),
    ])
    expect(out[0].proposed_at).toBe('2026-09-01T00:00:00Z')
    expect(out[1].proposed_at).toBeNull()
  })

  it('orders two undated sessions by creation, so the list is stable', () => {
    const out = sortSessions([
      session(null, '2026-02-01T00:00:00Z'),
      session(null, '2026-01-01T00:00:00Z'),
    ])
    expect(out[0].created_at).toBe('2026-01-01T00:00:00Z')
  })

  it('does not mutate the array it is given', () => {
    // The panel holds this array in state; sorting it in place would mutate
    // state directly and can leave React showing a stale order.
    const input = [session('2026-10-01T00:00:00Z'), session('2026-09-01T00:00:00Z')]
    sortSessions(input)
    expect(input[0].proposed_at).toBe('2026-10-01T00:00:00Z')
  })
})
