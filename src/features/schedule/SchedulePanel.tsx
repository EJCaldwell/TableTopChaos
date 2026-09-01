/**
 * SchedulePanel — shared "Scheduling" tab for the whole table. The DM proposes
 * play sessions (title, date/time, notes); every member RSVPs yes/maybe/no and
 * sees the running tally. Visible to all members; only the DM can add/edit/
 * delete sessions (RLS enforces), while each member controls only their own RSVP.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, FormError } from '../../components/ui'
import { useAutosave, SaveIndicator } from '../dm/autosave'
import { useRealtimeSync, mergeById, type RealtimeEvent } from '../realtime/useRealtimeRefresh'
import {
  createSession,
  deleteSession,
  listRsvps,
  listSessions,
  setRsvp,
  updateSession,
  type RsvpStatus,
  type RsvpWithName,
  type ScheduleRsvp,
  type ScheduleSession,
} from './api'
import {
  formatWhen,
  isoToLocalInput,
  localInputToIso,
  nowLocalInput,
  sortSessions,
  startOfCurrentMinute,
} from './when'

// Date handling lives in ./when.ts, extracted 2026-09-01 so the timezone
// conversions can be unit-tested rather than trusted.
const RSVP_LABELS: Record<RsvpStatus, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' }
const RSVP_COLORS: Record<RsvpStatus, string> = {
  yes: 'var(--color-success)', maybe: 'var(--color-text-muted)', no: 'var(--color-danger)',
}

/**
 * @param campaignId - The campaign being scheduled.
 * @param currentUserId - The signed-in member (for their own RSVP).
 * @param isDm - Whether the caller may add/edit/delete sessions.
 */
export function SchedulePanel({ campaignId, currentUserId, isDm }: {
  campaignId: string; currentUserId: string; isDm: boolean
}) {
  const [sessions, setSessions] = useState<ScheduleSession[]>([])
  const [rsvps, setRsvps] = useState<RsvpWithName[]>([])
  const [loading, setLoading] = useState(true)
  // New-session composer (DM).
  const [draftTitle, setDraftTitle] = useState('')
  const [draftWhen, setDraftWhen] = useState('')
  const [draftNotes, setDraftNotes] = useState('')

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listSessions(campaignId)
      setSessions(list)
      setRsvps(await listRsvps(list.map((s) => s.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the schedule.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Cache of user_id → display name, so an rsvp event from another member can be
  // labelled without re-fetching every profile.
  const nameCache = useRef(new Map<string, string | null>())

  /** Merges one rsvp change into state, keyed by (session, user); looks up the
   *  responder's name once if we don't already know it. */
  async function applyRsvpEvent(e: RealtimeEvent<ScheduleRsvp>) {
    if (e.eventType === 'DELETE') {
      const o = e.old as Partial<ScheduleRsvp>
      setRsvps((prev) => prev.filter((r) => !(r.session_id === o.session_id && r.user_id === o.user_id)))
      return
    }
    const row = e.new
    if (!nameCache.current.has(row.user_id)) {
      const { data } = await supabase.from('profiles').select('username').eq('id', row.user_id).maybeSingle()
      nameCache.current.set(row.user_id, data?.username ?? null)
    }
    const name = nameCache.current.get(row.user_id) ?? null
    setRsvps((prev) => {
      const idx = prev.findIndex((r) => r.session_id === row.session_id && r.user_id === row.user_id)
      const hydrated: RsvpWithName = { ...row, username: prev[idx]?.username ?? name }
      if (idx === -1) return [...prev, hydrated]
      const copy = prev.slice()
      copy[idx] = hydrated
      return copy
    })
  }

  // Live merges (row-by-row; no full reload). Sessions are re-sorted after merge;
  // rsvps have no campaign_id to filter on, so RLS scopes which we receive.
  useRealtimeSync<ScheduleSession>(
    'schedule_sessions',
    (e) => setSessions((prev) => sortSessions(mergeById(prev, e))),
    `campaign_id=eq.${campaignId}`,
  )
  useRealtimeSync<ScheduleRsvp>('schedule_rsvps', (e) => void applyRsvpEvent(e))

  // Group rsvps by session for quick lookup.
  const rsvpsBySession = useMemo(() => {
    const m = new Map<string, RsvpWithName[]>()
    for (const r of rsvps) {
      const arr = m.get(r.session_id) ?? []
      arr.push(r)
      m.set(r.session_id, arr)
    }
    return m
  }, [rsvps])

  /**
   * DM: create a session from the composer.
   *
   * A new session may not be dated in the past. Proposing one is always a
   * mistake — the whole point is an RSVP for something that hasn't happened —
   * and it would land straight in the collapsed "past sessions" dropdown, where
   * the DM would reasonably conclude the save had failed. Editing an EXISTING
   * session to a past date is still allowed: that is how you correct a date, or
   * record when a session actually took place.
   */
  async function handleAdd() {
    if (!draftTitle.trim() && !draftWhen) {
      setError('Give the session a title or a date first.')
      return
    }
    const whenIso = localInputToIso(draftWhen)
    if (whenIso && whenIso < startOfCurrentMinute()) {
      setError("That date has already passed — pick a future date to propose a session.")
      return
    }
    await runSave(async () => {
      const s = await createSession(
        campaignId,
        { title: draftTitle.trim(), proposed_at: whenIso, notes: draftNotes },
        sessions.length,
      )
      setSessions((prev) => [...prev, s])
      setDraftTitle('')
      setDraftWhen('')
      setDraftNotes('')
    })
  }

  /** DM: edit a session field (debounced). */
  function editSession(id: string, patch: Partial<Pick<ScheduleSession, 'title' | 'proposed_at' | 'notes'>>) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    scheduleSave(`session-${id}`, () => updateSession(id, patch))
  }

  /** DM: delete a session. */
  async function handleDelete(id: string) {
    if (!window.confirm('Delete this session for everyone?')) return
    const prev = sessions
    setSessions((cur) => cur.filter((s) => s.id !== id))
    await runSave(() => deleteSession(id)).catch(() => setSessions(prev))
  }

  /** Any member: set my rsvp for a session. */
  async function handleRsvp(sessionId: string, status: RsvpStatus) {
    // Optimistically update my row in the local list.
    setRsvps((prev) => {
      const mine = prev.find((r) => r.session_id === sessionId && r.user_id === currentUserId)
      if (mine) return prev.map((r) => (r === mine ? { ...r, status } : r))
      return [...prev, {
        id: `temp-${sessionId}`, session_id: sessionId, user_id: currentUserId, status,
        created_at: '', updated_at: '', username: 'You',
      } as RsvpWithName]
    })
    await runSave(() => setRsvp(sessionId, currentUserId, status), `rsvp-${sessionId}`).catch(() => void refresh())
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  const fieldStyle = {
    font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)',
  }
  // Small "Today" quick-fill button beside each date input.
  const todayBtnStyle = {
    font: 'inherit', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' as const,
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    color: 'var(--color-text)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-3)',
  }

  /**
   * One session card. Extracted from the list so upcoming and past sessions can
   * render identically in two places without duplicating ~60 lines of JSX.
   *
   * @param s - The session to render.
   * @param isPast - Whether the session has already happened. A past session's
   *        TIME is locked: rescheduling something that already occurred is
   *        always a mistake, and it would silently move the card out of the
   *        history list. Title, notes and RSVPs stay editable — notes in
   *        particular are how a DM records what actually happened afterwards.
   */
  function renderSession(s: ScheduleSession, isPast = false) {
            const rows = rsvpsBySession.get(s.id) ?? []
      const mine = rows.find((r) => r.user_id === currentUserId)?.status
      const tally = (st: RsvpStatus) => rows.filter((r) => r.status === st)
      return (
        <div key={s.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {isDm ? (
            <>
              <input value={s.title} onChange={(e) => editSession(s.id, { title: e.target.value })}
                maxLength={200} placeholder="Title" aria-label="Session title" style={{ ...fieldStyle, fontWeight: 700 }} />
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="datetime-local" value={isoToLocalInput(s.proposed_at)}
                  onChange={(e) => editSession(s.id, { proposed_at: localInputToIso(e.target.value) })}
                  disabled={isPast}
                  title={isPast ? 'This session has already happened, so its time is locked.' : undefined}
                  aria-label="Session date and time"
                  style={{ ...fieldStyle, ...(isPast ? { opacity: 0.6, cursor: 'not-allowed' } : null) }} />
                {!isPast && (
                  <button type="button" onClick={() => editSession(s.id, { proposed_at: new Date().toISOString() })} style={todayBtnStyle}>Now</button>
                )}
                <button onClick={() => handleDelete(s.id)} style={{ marginLeft: 'auto', font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-danger)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer' }}>Delete</button>
              </div>
              <textarea value={s.notes} onChange={(e) => editSession(s.id, { notes: e.target.value })}
                rows={2} placeholder="Notes" aria-label="Session notes" style={fieldStyle} />
            </>
          ) : (
            <>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{s.title.trim() || 'Untitled session'}</h3>
              <p style={{ margin: 0, color: 'var(--color-accent)', fontSize: '0.9rem' }}>{formatWhen(s.proposed_at)}</p>
              {s.notes.trim() && <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{s.notes}</p>}
            </>
          )}
          {isDm && <p style={{ margin: 0, color: 'var(--color-accent)', fontSize: '0.85rem' }}>{formatWhen(s.proposed_at)}</p>}

          {/* Tally. */}
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            {(['yes', 'maybe', 'no'] as RsvpStatus[]).map((st) => {
              const names = tally(st).map((r) => r.username || 'Someone')
        return (
                <span key={st} title={names.join(', ')}>
                  <strong style={{ color: RSVP_COLORS[st] }}>{RSVP_LABELS[st]}: {names.length}</strong>
                  {names.length > 0 && <span> — {names.join(', ')}</span>}
                </span>
              )
            })}
          </div>

          {/* My RSVP. */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Your response:</span>
            {(['yes', 'maybe', 'no'] as RsvpStatus[]).map((st) => {
              const active = mine === st
        return (
                <button key={st} onClick={() => handleRsvp(s.id, st)} aria-pressed={active}
                  style={{
                    font: 'inherit', fontSize: '0.85rem', cursor: 'pointer', borderRadius: 'var(--radius)',
                    padding: 'var(--space-1) var(--space-3)',
                    border: '1px solid ' + (active ? RSVP_COLORS[st] : 'var(--color-border)'),
                    background: active ? RSVP_COLORS[st] : 'var(--color-bg)',
                    color: active ? 'var(--color-bg)' : 'var(--color-text)',
                  }}>
                  {RSVP_LABELS[st]}
                </button>
              )
            })}
          </div>
        </div>
      )
  }

  // Split on the session's proposed time. A session with no date yet is treated
  // as upcoming — it is a proposal awaiting a date, not history.
  const nowIso = new Date().toISOString()
  const upcoming = sessions.filter((s) => !s.proposed_at || s.proposed_at >= nowIso)
  // Reversed relative to `upcoming`: for things still to come you want the
  // soonest first, but for history you want the most recent first — nobody
  // scrolls to the bottom looking for last week.
  const past = sessions
    .filter((s) => s.proposed_at && s.proposed_at < nowIso)
    .slice()
    .reverse()

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Scheduling</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        {isDm ? 'Propose session dates; the party responds below.' : 'Let your DM know if you can make each session.'}
      </p>

      <FormError message={error} />

      {/* DM composer. */}
      {isDm && (
        <div style={{ marginTop: 'var(--space-4)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Propose a session</h3>
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={200}
            placeholder="Title (e.g. Session 12)" aria-label="Session title" style={{ ...fieldStyle, fontWeight: 600 }} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Deliberately NO `min` here. It made the field hostile to typing:
                entering a date digit by digit produces intermediate values below
                the minimum ("2026-0…"), which browsers mark invalid and can
                clear mid-keystroke. The rule is enforced on submit in handleAdd
                instead — one clear message beats a field that fights you. */}
            <input type="datetime-local" value={draftWhen} onChange={(e) => setDraftWhen(e.target.value)}
              aria-label="Session date and time" style={fieldStyle} />
            <button type="button" onClick={() => setDraftWhen(nowLocalInput())} style={todayBtnStyle}>Now</button>
          </div>
          <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} rows={2}
            placeholder="Notes (optional)" aria-label="Session notes" style={fieldStyle} />
          <Button onClick={handleAdd} style={{ width: 'auto', alignSelf: 'flex-start' }}>Propose session</Button>
        </div>
      )}

      {/* Session list. */}
      {sessions.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No sessions proposed yet.
        </p>
      ) : (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {upcoming.map((s) => (
            <div key={s.id}>{renderSession(s)}</div>
          ))}

          {/* Past sessions collapse into a disclosure: they are still worth
              keeping (attendance, what was agreed) but they should not push the
              next session off the screen, which is the only one anyone is
              acting on. Closed by default; the count is on the summary so you
              can see there is history without opening it. */}
          {past.length > 0 && (
            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  fontSize: '0.9rem',
                  padding: 'var(--space-2) 0',
                }}
              >
                Past sessions ({past.length})
              </summary>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  marginTop: 'var(--space-3)',
                  opacity: 0.75,
                }}
              >
                {/* Each past session is its own disclosure, collapsed to a
                    one-line summary. Once there are a dozen of them, a flat
                    list of full cards is a wall to scroll — the thing you came
                    for is a specific date, so that is what the summary shows.
                    Newest first: recent sessions are the ones anyone looks up. */}
                {past.map((s) => (
                  <details
                    key={s.id}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <summary
                      style={{
                        cursor: 'pointer',
                        padding: 'var(--space-3) var(--space-4)',
                        display: 'flex',
                        gap: 'var(--space-3)',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: '0.95rem' }}>{s.title?.trim() || 'Untitled session'}</strong>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        {formatWhen(s.proposed_at)}
                      </span>
                    </summary>
                    <div style={{ padding: '0 var(--space-2) var(--space-2)' }}>{renderSession(s, true)}</div>
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
