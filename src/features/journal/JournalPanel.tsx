/**
 * JournalPanel — the player's private "Journal" workspace body (2.4.2).
 *
 * A list of personal journal entries (title + body), newest first. Entries are
 * PRIVATE by default; a per-entry "Share with DM" toggle is the only thing that
 * exposes an entry to the DM (enforced by RLS in migration 0015 — this toggle
 * just flips the `shared` column). Same autosave model as the other panels
 * (optimistic, debounced per entry, save indicator, offline retry).
 *
 * Journal hangs off the character; with none it points to the "My character" tab.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { getMyCharacter, type Character } from '../character/api'
import {
  createEntry,
  deleteEntry,
  listEntries,
  reorderEntries,
  updateEntry,
  type JournalEntry,
} from './api'

const SAVE_DEBOUNCE_MS = 600
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
/** Where a drag will drop, as an insertion index (0..count) into `entries`. */
type DropIndicator = { index: number } | null

/**
 * How the entry list is ordered on screen. Only `manual` reflects (and is
 * editable by) the persisted `position`; the others are VIEW-ONLY re-sorts of
 * the same rows that never touch `position`, so switching back to `manual`
 * restores the player's hand-arranged order untouched.
 *  - manual        — the drag-arranged order (position, as stored)
 *  - created-desc  — by creation timestamp, newest first
 *  - created-asc   — by creation timestamp, oldest first
 *  - title-asc     — by title A→Z
 *  - title-desc    — by title Z→A
 */
type SortMode = 'manual' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc'

/** Options for the sort selector, in display order. */
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual', label: 'Manual (drag)' },
  { value: 'created-desc', label: 'Newest first' },
  { value: 'created-asc', label: 'Oldest first' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
]

export function JournalPanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  const [character, setCharacter] = useState<Character | null>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Current on-screen ordering. Defaults to the persisted manual order; changing
  // it is a view-only preference (not saved) and disables drag except in manual.
  const [sortMode, setSortMode] = useState<SortMode>('manual')

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())
  // Drag-to-reorder state: the dragged entry id, the live drop target (mirrored
  // into a ref so the drop handler reads the latest value), and the visible line.
  const dragId = useRef<string | null>(null)
  const dropTarget = useRef<DropIndicator>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)

  const runSave = useCallback(async (fn: () => Promise<unknown>, key?: string) => {
    inFlight.current += 1
    setSaveState('saving')
    try {
      await fn()
      if (key) pending.current.delete(key)
      inFlight.current -= 1
      if (inFlight.current === 0) {
        if (pending.current.size > 0) setSaveState('error')
        else {
          setSaveState('saved')
          setError(null)
        }
      }
    } catch (err) {
      if (key) pending.current.set(key, fn)
      inFlight.current = Math.max(0, inFlight.current - 1)
      setSaveState('error')
      setError(err instanceof Error ? err.message : 'Failed to save.')
    }
  }, [])

  const scheduleSave = useCallback(
    (key: string, fn: () => Promise<unknown>) => {
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      const t = setTimeout(() => {
        timers.current.delete(key)
        void runSave(fn, key)
      }, SAVE_DEBOUNCE_MS)
      timers.current.set(key, t)
    },
    [runSave],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  useEffect(() => {
    function flush() {
      if (pending.current.size === 0) return
      for (const [key, fn] of Array.from(pending.current.entries())) void runSave(fn, key)
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [runSave])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await getMyCharacter(campaignId, currentUserId)
      setCharacter(c)
      setEntries(c ? await listEntries(c.id) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your journal.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Adds a new entry at the top (highest position). */
  async function handleAdd() {
    if (!character) return
    // New entries sort first: one above the current max position.
    const position = entries.reduce((max, e) => Math.max(max, e.position), 0) + 1
    await runSave(async () => {
      const entry = await createEntry(character.id, position)
      setEntries((prev) => [entry, ...prev])
    })
  }

  function handleChange(
    id: string,
    patch: Partial<Pick<JournalEntry, 'title' | 'body' | 'shared'>>,
  ) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    // `shared` is a deliberate toggle — persist it immediately (no debounce) so
    // the privacy state is never left pending; text edits stay debounced.
    if (patch.shared !== undefined) {
      void runSave(() => updateEntry(id, patch), `entry-${id}-shared`)
    } else {
      scheduleSave(`entry-${id}`, () => updateEntry(id, patch))
    }
  }

  async function handleDelete(id: string) {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    const hasContent = entry.title.trim() !== '' || entry.body.trim() !== ''
    if (hasContent && !window.confirm('Delete this journal entry? This cannot be undone.')) {
      return
    }
    const prev = entries
    setEntries((cur) => cur.filter((e) => e.id !== id))
    await runSave(() => deleteEntry(id)).catch(() => setEntries(prev))
  }

  // ---- drag-to-reorder ----

  /** Computes an insertion index for a dragged-over row from the pointer's Y. */
  function halfIndex(e: DragEvent, rowIndex: number): number {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? rowIndex + 1 : rowIndex
  }
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
    setEntries((prev) => {
      const next = moveToIndex(prev, (e) => e.id === fromId, target.index)
      if (next === prev) return prev
      void runSave(() => reorderEntries(next.map((e) => e.id)), 'reorder-entries')
      return next
    })
  }

  // The rows as rendered, under the current sort. `manual` is the stored order
  // (entries already arrive position-sorted from listEntries); the rest are
  // pure, view-only re-sorts of a COPY so `entries`/`position` stay intact.
  const displayed = useMemo(() => {
    if (sortMode === 'manual') return entries
    const copy = [...entries]
    switch (sortMode) {
      // created_at is an ISO-8601 string, so lexical compare == chronological.
      case 'created-desc':
        copy.sort((a, b) => b.created_at.localeCompare(a.created_at))
        break
      case 'created-asc':
        copy.sort((a, b) => a.created_at.localeCompare(b.created_at))
        break
      case 'title-asc':
        copy.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'title-desc':
        copy.sort((a, b) => b.title.localeCompare(a.title))
        break
    }
    return copy
  }, [entries, sortMode])

  // Drag-to-reorder only makes sense against the persisted order.
  const canDrag = sortMode === 'manual'

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }
  if (!character) {
    return (
      <div
        style={{
          marginTop: 'var(--space-6)',
          padding: 'var(--space-8)',
          textAlign: 'center',
          background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>No character yet</h2>
        <p style={{ color: 'var(--color-text-muted)', maxWidth: 420, margin: 'var(--space-3) auto 0' }}>
          Create your character on the <strong>My character</strong> tab first.
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Journal</h2>
        <SaveIndicator state={saveState} />
        {/* Sort selector: only "Manual" reflects/edits the saved drag order. */}
        <label style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Sort{' '}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort journal entries"
            style={{
              font: 'inherit',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '2px 6px',
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you. The DM can't see an entry unless you turn on{' '}
        <strong>Share with DM</strong> for it.
      </p>

      <FormError message={error} />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto' }}>
          + New entry
        </Button>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No entries yet.
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
          {displayed.map((entry, i) => (
            <Fragment key={entry.id}>
              {canDrag && dropIndicator?.index === i && <InsertionBar />}
            <div
              onDragOver={(e: DragEvent) => {
                if (!canDrag || !dragId.current) return
                e.preventDefault()
                setDrop({ index: halfIndex(e, i) })
              }}
              onDrop={(e: DragEvent) => {
                if (!canDrag || !dragId.current) return
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
                {/* Drag handle only in Manual sort — the other sorts are view-only
                    and reordering them wouldn't have anywhere to persist to. */}
                {canDrag && (
                  <span
                    draggable
                    onDragStart={(e: DragEvent) => startDrag(e, entry.id)}
                    onDragEnd={clearDrag}
                    title="Drag to reorder entry"
                    aria-label="Drag to reorder entry"
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                  >
                    ⠿
                  </span>
                )}
                <input
                  value={entry.title}
                  onChange={(e) => handleChange(entry.id, { title: e.target.value })}
                  maxLength={200}
                  aria-label="Entry title"
                  placeholder="Title"
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
                {/* Share toggle: the ONLY thing that lets the DM read this entry. */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    fontSize: '0.8rem',
                    color: entry.shared ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                  title="When on, the campaign DM can read this entry"
                >
                  <input
                    type="checkbox"
                    checked={entry.shared}
                    onChange={(e) => handleChange(entry.id, { shared: e.target.checked })}
                  />
                  {entry.shared ? 'Shared with DM' : 'Share with DM'}
                </label>
                <button
                  onClick={() => handleDelete(entry.id)}
                  aria-label="Delete entry"
                  title="Delete entry"
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
              <AutoTextarea
                value={entry.body}
                onChange={(e) => handleChange(entry.id, { body: e.target.value })}
                aria-label="Entry body"
                placeholder="Write your entry…"
                minRows={2}
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
              {/* Subtle "hidden" creation timestamp — always stored (created_at),
                  shown small/muted so it informs the date sort without cluttering. */}
              <div
                style={{
                  marginTop: 'var(--space-2)',
                  fontSize: '0.72rem',
                  color: 'var(--color-text-muted)',
                  textAlign: 'right',
                }}
              >
                Added {formatTimestamp(entry.created_at)}
              </div>
            </div>
            </Fragment>
          ))}
          {/* Trailing gap: lets an entry be dropped at the LAST position (manual only). */}
          {canDrag && dropIndicator?.index === entries.length && <InsertionBar />}
        </div>
      )}
    </div>
  )
}

/**
 * Formats a stored ISO timestamp for the subtle per-entry "Added …" line. Falls
 * back to the raw string if the date can't be parsed, so a bad value never
 * throws in render.
 * @param iso - The entry's `created_at` (ISO-8601 from Postgres).
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The thin accent line marking the active drop gap during a drag. */
function InsertionBar() {
  return (
    <div aria-hidden style={{ height: 3, background: 'var(--color-accent)', borderRadius: 2, margin: '2px 0' }} />
  )
}

/**
 * Returns a new array with the item matching `fromPred` moved to `toIndex` (an
 * insertion index in the ORIGINAL array's coordinates, 0..length). Pure; returns
 * the SAME reference on a no-op move so callers can skip a redundant save.
 */
function moveToIndex<T>(arr: T[], fromPred: (x: T) => boolean, toIndex: number): T[] {
  const fromIdx = arr.findIndex(fromPred)
  if (fromIdx < 0) return arr
  if (toIndex === fromIdx || toIndex === fromIdx + 1) return arr
  const item = arr[fromIdx]
  const without = arr.filter((_, i) => i !== fromIdx)
  const adj = toIndex > fromIdx ? toIndex - 1 : toIndex
  return [...without.slice(0, adj), item, ...without.slice(adj)]
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; color: string } | null> = {
    idle: null,
    saving: { text: 'Saving…', color: 'var(--color-text-muted)' },
    saved: { text: 'All changes saved', color: 'var(--color-success)' },
    error: { text: 'Save failed', color: 'var(--color-danger)' },
  }
  const entry = map[state]
  if (!entry) return null
  return <span style={{ fontSize: '0.8rem', color: entry.color }}>{entry.text}</span>
}
