/**
 * schedule/when.ts — the date handling behind the scheduling panel.
 *
 * Extracted from SchedulePanel on 2026-09-01 so it can be tested. These are the
 * functions that move a session time between three representations — a stored
 * ISO instant (UTC), an `<input type="datetime-local">` value (local, minute
 * precision), and a human string — and every conversion between them is a place
 * a session can land an hour or a day out for somebody in another timezone.
 *
 * One bug has already come from here: proposing a session at the time the app's
 * own "Now" button produced was rejected as being in the past. See
 * {@link startOfCurrentMinute}.
 */
import type { ScheduleSession } from './api'

/** Sorts sessions soonest-dated first (undated last) — mirrors listSessions. */
export function sortSessions(list: ScheduleSession[]): ScheduleSession[] {
  return [...list].sort((a, b) => {
    if (a.proposed_at == null && b.proposed_at == null) return a.created_at.localeCompare(b.created_at)
    if (a.proposed_at == null) return 1
    if (b.proposed_at == null) return -1
    return a.proposed_at.localeCompare(b.proposed_at)
  })
}

/**
 * Converts a stored ISO timestamp to a value for `<input type="datetime-local">`.
 *
 * The offset dance is necessary because `toISOString()` always renders UTC,
 * while the input expects LOCAL wall-clock time. Shifting by the offset first
 * makes the UTC rendering read as local — the standard trick, and the reason
 * this is not simply `iso.slice(0, 16)`, which would show a user in Denver a
 * session six hours from when it is.
 *
 * @param iso - Stored instant, or null.
 * @returns "YYYY-MM-DDTHH:mm" in local time, or '' for null.
 */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const tzMs = d.getTime() - d.getTimezoneOffset() * 60000
  return new Date(tzMs).toISOString().slice(0, 16)
}

/**
 * Converts a datetime-local value back to an ISO timestamp.
 * @param v - The input's value, or ''.
 * @returns The instant in UTC, or null when empty.
 */
export function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

/**
 * The current local moment as a datetime-local input value (the "Now" button).
 * @param now - Injectable clock, for tests.
 */
export function nowLocalInput(now: Date = new Date()): string {
  return isoToLocalInput(now.toISOString())
}

/**
 * The earliest instant a newly proposed session may be dated: the start of the
 * current minute.
 *
 * It must be the MINUTE, not the exact moment. `<input type="datetime-local">`
 * only expresses minutes and `nowLocalInput()` truncates to match, so the "Now"
 * button produces HH:MM:00 — already a second or two in the past by the time
 * anyone clicks Propose. Comparing against the exact moment rejected the app's
 * own shortcut, which is the bug this function exists to prevent.
 *
 * @param now - Injectable clock, for tests.
 * @returns An ISO timestamp at the start of the current minute.
 */
export function startOfCurrentMinute(now: Date = new Date()): string {
  const d = new Date(now.getTime())
  d.setSeconds(0, 0)
  return d.toISOString()
}

/** Human-friendly display of a proposed time (or "Time TBD"). */
export function formatWhen(iso: string | null): string {
  if (!iso) return 'Time TBD'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
