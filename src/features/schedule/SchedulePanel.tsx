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

/** Sorts sessions soonest-dated first (undated last) — mirrors listSessions. */
function sortSessions(list: ScheduleSession[]): ScheduleSession[] {
  return [...list].sort((a, b) => {
    if (a.proposed_at == null && b.proposed_at == null) return a.created_at.localeCompare(b.created_at)
    if (a.proposed_at == null) return 1
    if (b.proposed_at == null) return -1
    return a.proposed_at.localeCompare(b.proposed_at)
  })
}

/** Converts a stored ISO timestamp to a value for <input type="datetime-local">. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  // Offset to local time, then trim to "YYYY-MM-DDTHH:mm".
  const tzMs = d.getTime() - d.getTimezoneOffset() * 60000
  return new Date(tzMs).toISOString().slice(0, 16)
}
/** Converts a datetime-local value back to an ISO timestamp (or null if empty). */
function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}
/** The current local moment as a datetime-local input value (for the Today button). */
function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString())
}
/** Human-friendly display of a proposed time (or "Time TBD"). */
function formatWhen(iso: string | null): string {
  if (!iso) return 'Time TBD'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

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
      const { data } = await supabase.from('profiles').select('display_name').eq('id', row.user_id).maybeSingle()
      nameCache.current.set(row.user_id, data?.display_name ?? null)
    }
    const name = nameCache.current.get(row.user_id) ?? null
    setRsvps((prev) => {
      const idx = prev.findIndex((r) => r.session_id === row.session_id && r.user_id === row.user_id)
      const hydrated: RsvpWithName = { ...row, display_name: prev[idx]?.display_name ?? name }
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

  /** DM: create a session from the composer. */
  async function handleAdd() {
    if (!draftTitle.trim() && !draftWhen) {
      setError('Give the session a title or a date first.')
      return
    }
    await runSave(async () => {
      const s = await createSession(
        campaignId,
        { title: draftTitle.trim(), proposed_at: localInputToIso(draftWhen), notes: draftNotes },
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
        created_at: '', updated_at: '', display_name: 'You',
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
            <input type="datetime-local" value={draftWhen} onChange={(e) => setDraftWhen(e.target.value)}
              aria-label="Session date and time" style={fieldStyle} />
            <button type="button" onClick={() => setDraftWhen(nowLocalInput())} style={todayBtnStyle}>Today</button>
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
          {sessions.map((s) => {
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
                        aria-label="Session date and time" style={fieldStyle} />
                      <button type="button" onClick={() => editSession(s.id, { proposed_at: new Date().toISOString() })} style={todayBtnStyle}>Today</button>
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
                    const names = tally(st).map((r) => r.display_name || 'Someone')
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
          })}
        </div>
      )}
    </div>
  )
}
