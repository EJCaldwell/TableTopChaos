/**
 * SessionLogPanel — the DM's private "Session log" workspace body (3.1.2).
 *
 * A drag-orderable list of play sessions: each has an optional title, a played
 * date, a free-form list of attendees, and a recap. DM-only (RLS, migration
 * 0017); players never see this tab or its data.
 *
 * Autosave model matches the character panels via the shared useAutosave hook:
 * text/date edits debounce; adds, deletes, and reorders save immediately.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import {
  SaveIndicator,
  InsertionBar,
  useAutosave,
  moveToIndex,
  halfIndex,
  type DropIndicator,
} from './autosave'
import {
  createSession,
  deleteSession,
  listSessions,
  reorderSessions,
  updateSession,
  type Session,
} from './sessionsApi'

export function SessionLogPanel({ campaignId }: { campaignId: string }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  // Raw, in-progress text for each session's attendees input, keyed by session
  // id. Kept UNCONTROLLED by the parsed array so typing a comma or trailing
  // space isn't stripped back out on every keystroke (the parser drops empties
  // and whitespace). We show what was typed and only PARSE for saving. A missing
  // entry falls back to the stored attendees (e.g. right after a reload).
  const [attendeeDrafts, setAttendeeDrafts] = useState<Record<string, string>>({})

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  // Drag-to-reorder state (see NotesPanel for the shared pattern).
  const dragId = useRef<string | null>(null)
  const dropTarget = useRef<DropIndicator>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)

  /** Loads the campaign's sessions (RLS returns nothing for non-DMs). */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listSessions(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the session log.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Adds a new empty session at the top (highest position). */
  async function handleAdd() {
    const position = sessions.reduce((max, s) => Math.max(max, s.position), 0) + 1
    await runSave(async () => {
      const session = await createSession(campaignId, position)
      setSessions((prev) => [session, ...prev])
    })
  }

  /** Applies a local edit and schedules a debounced save, keyed by session id. */
  function handleChange(
    id: string,
    patch: Partial<Pick<Session, 'title' | 'session_date' | 'recap' | 'attendees'>>,
  ) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    scheduleSave(`session-${id}`, () => updateSession(id, patch))
  }

  /**
   * Handles a keystroke in a session's attendees input: keep the raw text as-is
   * for display (commas/spaces survive) and persist the PARSED attendee list.
   * @param id - The session id.
   * @param raw - The exact current text of the attendees input.
   */
  function handleAttendeesInput(id: string, raw: string) {
    setAttendeeDrafts((prev) => ({ ...prev, [id]: raw }))
    handleChange(id, { attendees: parseList(raw) })
  }

  async function handleDelete(id: string) {
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    const hasContent =
      session.title.trim() !== '' ||
      session.recap.trim() !== '' ||
      session.attendees.length > 0 ||
      session.session_date !== null
    if (hasContent && !window.confirm('Delete this session? This cannot be undone.')) return
    const prev = sessions
    setSessions((cur) => cur.filter((s) => s.id !== id))
    await runSave(() => deleteSession(id)).catch(() => setSessions(prev))
  }

  // ---- drag-to-reorder ----
  function startDrag(e: DragEvent, id: string) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function setDrop(ind: DropIndicator) {
    dropTarget.current = ind
    setDropIndicator(ind)
  }
  function clearDrag() {
    dragId.current = null
    dropTarget.current = null
    setDropIndicator(null)
  }
  /** Applies the pending reorder and persists the new top-to-bottom order. */
  function applyDrop() {
    const fromId = dragId.current
    const target = dropTarget.current
    clearDrag()
    if (!fromId || !target) return
    setSessions((prev) => {
      const next = moveToIndex(prev, (s) => s.id === fromId, target.index)
      if (next === prev) return prev
      void runSave(() => reorderSessions(next.map((s) => s.id)), 'reorder-sessions')
      return next
    })
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Session log</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Record what happened each session — date,
        attendees, and a recap.
      </p>

      <FormError message={error} />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto' }}>
          + New session
        </Button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No sessions logged yet.
        </p>
      ) : (
        <div
          onDragOver={(e: DragEvent) => {
            if (dragId.current) e.preventDefault()
          }}
          onDrop={(e: DragEvent) => {
            if (!dragId.current) return
            e.preventDefault()
            applyDrop()
          }}
          style={{ marginTop: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {sessions.map((session, i) => (
            <Fragment key={session.id}>
              {dropIndicator?.index === i && <InsertionBar />}
              <div
                onDragOver={(e: DragEvent) => {
                  if (!dragId.current) return
                  e.preventDefault()
                  setDrop({ index: halfIndex(e, i) })
                }}
                onDrop={(e: DragEvent) => {
                  if (!dragId.current) return
                  e.preventDefault()
                  applyDrop()
                }}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--color-surface)',
                  padding: 'var(--space-4)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    draggable
                    onDragStart={(e: DragEvent) => startDrag(e, session.id)}
                    onDragEnd={clearDrag}
                    title="Drag to reorder session"
                    aria-label="Drag to reorder session"
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                  >
                    ⠿
                  </span>
                  <input
                    value={session.title}
                    onChange={(e) => handleChange(session.id, { title: e.target.value })}
                    maxLength={200}
                    aria-label="Session title"
                    placeholder="Session title"
                    style={{
                      flex: 1,
                      font: 'inherit',
                      fontWeight: 600,
                      fontSize: '1.05rem',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <button
                    onClick={() => handleDelete(session.id)}
                    aria-label="Delete session"
                    title="Delete session"
                    style={{
                      font: 'inherit',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 'var(--space-1)',
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Date + attendees on one row (wraps on narrow screens). */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    Date played
                    <input
                      type="date"
                      // A cleared date input yields '' — store null, not '', so the
                      // column reads as "no date set" rather than an empty string.
                      value={session.session_date ?? ''}
                      onChange={(e) => handleChange(session.id, { session_date: e.target.value || null })}
                      aria-label="Date played"
                      style={{
                        font: 'inherit',
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        padding: 'var(--space-1) var(--space-2)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.8rem', color: 'var(--color-text-muted)', flex: 1, minWidth: 200 }}>
                    Attendees (comma separated)
                    <input
                      value={attendeeDrafts[session.id] ?? session.attendees.join(', ')}
                      onChange={(e) => handleAttendeesInput(session.id, e.target.value)}
                      aria-label="Attendees (comma separated)"
                      placeholder="e.g. Alice, Bob, Guest"
                      style={{
                        font: 'inherit',
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        padding: 'var(--space-1) var(--space-2)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </label>
                </div>

                <AutoTextarea
                  value={session.recap}
                  onChange={(e) => handleChange(session.id, { recap: e.target.value })}
                  aria-label="Session recap"
                  placeholder="What happened this session…"
                  minRows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 'var(--space-3)',
                    font: 'inherit',
                    lineHeight: 1.5,
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-3)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
            </Fragment>
          ))}
          {/* Trailing gap: lets a session be dropped at the LAST position. */}
          {dropIndicator?.index === sessions.length && <InsertionBar />}
        </div>
      )}
    </div>
  )
}

/**
 * Parses a comma-separated input (attendees) into a clean list: trim each, drop
 * empties, de-duplicate (case-sensitive) preserving first-seen order.
 * @param raw - The raw text from the input.
 */
function parseList(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
