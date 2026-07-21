/**
 * NotesPanel — the DM's private "Secret notes" workspace body (3.1.2).
 *
 * A drag-orderable list of free-form notes (title + body) with lightweight
 * comma-separated tags for organizing/filtering. A tag filter bar lets the DM
 * narrow the list to a single tag. Everything here is DM-only (RLS, migration
 * 0017) — players never see this tab or its data.
 *
 * Autosave model matches the character panels: optimistic local edits, a
 * per-field debounce, an offline retry queue, and a save-status indicator — all
 * provided by the shared useAutosave hook. Tag/text edits debounce; adds,
 * deletes, and reorders save immediately.
 */
import { Fragment, useCallback, useEffect, useState, useMemo, useRef, type DragEvent } from 'react'
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
  createNote,
  deleteNote,
  listNotes,
  reorderNotes,
  updateNote,
  type DmNote,
} from './notesApi'

export function NotesPanel({ campaignId }: { campaignId: string }) {
  const [notes, setNotes] = useState<DmNote[]>([])
  const [loading, setLoading] = useState(true)
  // The active tag filter, or null for "show all". Cleared automatically if the
  // last note carrying that tag is deleted/retagged (see the effect below).
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  // Raw, in-progress text for each note's tags input, keyed by note id. The
  // input is UNCONTROLLED by the parsed array: if we derived its value from
  // `tags.join(', ')` every keystroke, typing a comma or a trailing space would
  // be stripped back out immediately (the parser drops empties/whitespace), so
  // a multi-tag string could never be built. Instead we show exactly what was
  // typed and only PARSE it into `tags` for saving/filtering. A missing entry
  // falls back to the stored tags (e.g. right after a reload).
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({})

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  // Drag-to-reorder state: the dragged note id, the live drop target (mirrored
  // into a ref so the drop handler reads the latest value), and the visible bar.
  const dragId = useRef<string | null>(null)
  const dropTarget = useRef<DropIndicator>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)

  /** Loads the campaign's notes (RLS returns nothing for non-DMs). */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setNotes(await listNotes(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The full set of tags in use across all notes, sorted, for the filter bar.
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) for (const t of n.tags) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [notes])

  // If the active filter's tag no longer exists on any note, drop the filter so
  // the list can't get stuck showing "nothing matches a tag that's gone".
  useEffect(() => {
    if (tagFilter && !allTags.includes(tagFilter)) setTagFilter(null)
  }, [tagFilter, allTags])

  // The notes actually rendered: all of them, or only those carrying the filter.
  const displayed = useMemo(
    () => (tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes),
    [notes, tagFilter],
  )

  /** Adds a new empty note at the top (highest position). */
  async function handleAdd() {
    const position = notes.reduce((max, n) => Math.max(max, n.position), 0) + 1
    await runSave(async () => {
      const note = await createNote(campaignId, position)
      setNotes((prev) => [note, ...prev])
    })
  }

  /**
   * Applies a local edit and schedules a debounced save. `title`/`body` edits
   * key on the note id; tag edits reuse the same key (still last-write-wins).
   */
  function handleChange(id: string, patch: Partial<Pick<DmNote, 'title' | 'body' | 'tags'>>) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
    scheduleSave(`note-${id}`, () => updateNote(id, patch))
  }

  /**
   * Handles a keystroke in a note's tags input: keep the raw text as-is for
   * display (so commas/spaces survive), and persist the PARSED tag list.
   * @param id - The note id.
   * @param raw - The exact current text of the tags input.
   */
  function handleTagsInput(id: string, raw: string) {
    setTagDrafts((prev) => ({ ...prev, [id]: raw }))
    handleChange(id, { tags: parseTags(raw) })
  }

  async function handleDelete(id: string) {
    const note = notes.find((n) => n.id === id)
    if (!note) return
    const hasContent = note.title.trim() !== '' || note.body.trim() !== '' || note.tags.length > 0
    if (hasContent && !window.confirm('Delete this note? This cannot be undone.')) return
    const prev = notes
    setNotes((cur) => cur.filter((n) => n.id !== id))
    await runSave(() => deleteNote(id)).catch(() => setNotes(prev))
  }

  // ---- drag-to-reorder (only meaningful with no tag filter applied) ----
  const canDrag = tagFilter === null

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
    setNotes((prev) => {
      const next = moveToIndex(prev, (n) => n.id === fromId, target.index)
      if (next === prev) return prev
      void runSave(() => reorderNotes(next.map((n) => n.id)), 'reorder-notes')
      return next
    })
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Secret notes</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Players can never see these notes. Add tags to
        organize and filter.
      </p>

      <FormError message={error} />

      {/* Tag filter bar — shown only when at least one note is tagged. */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
          <TagChip label="All" active={tagFilter === null} onClick={() => setTagFilter(null)} />
          {allTags.map((t) => (
            <TagChip key={t} label={t} active={tagFilter === t} onClick={() => setTagFilter(t)} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto' }}>
          + New note
        </Button>
      </div>

      {displayed.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          {tagFilter ? `No notes tagged "${tagFilter}".` : 'No notes yet.'}
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
          {displayed.map((note, i) => (
            <Fragment key={note.id}>
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
                  {/* Drag handle only when unfiltered — reordering a filtered
                      subset has no unambiguous meaning for the full order. */}
                  {canDrag && (
                    <span
                      draggable
                      onDragStart={(e: DragEvent) => startDrag(e, note.id)}
                      onDragEnd={clearDrag}
                      title="Drag to reorder note"
                      aria-label="Drag to reorder note"
                      style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                    >
                      ⠿
                    </span>
                  )}
                  <input
                    value={note.title}
                    onChange={(e) => handleChange(note.id, { title: e.target.value })}
                    maxLength={200}
                    aria-label="Note title"
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
                  <button
                    onClick={() => handleDelete(note.id)}
                    aria-label="Delete note"
                    title="Delete note"
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
                  value={note.body}
                  onChange={(e) => handleChange(note.id, { body: e.target.value })}
                  aria-label="Note body"
                  placeholder="Write your note…"
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
                {/* Tags editor: a single comma-separated input. Parsed to a
                    trimmed, de-duplicated, non-empty list on every change. */}
                <input
                  value={tagDrafts[note.id] ?? note.tags.join(', ')}
                  onChange={(e) => handleTagsInput(note.id, e.target.value)}
                  aria-label="Tags (comma separated)"
                  placeholder="Tags (comma separated)"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 'var(--space-3)',
                    font: 'inherit',
                    fontSize: '0.85rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-1) var(--space-2)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
            </Fragment>
          ))}
          {/* Trailing gap: lets a note be dropped at the LAST position. */}
          {canDrag && dropIndicator?.index === displayed.length && <InsertionBar />}
        </div>
      )}
    </div>
  )
}

/**
 * Parses the comma-separated tags input into a clean list: trim each, drop
 * empties, and de-duplicate (case-sensitive) while preserving first-seen order.
 * @param raw - The raw text from the tags input.
 */
function parseTags(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * TagChip — a single pill in the tag filter bar. Highlighted when active.
 * @param label - The tag text (or "All").
 * @param active - Whether this chip is the current filter.
 * @param onClick - Selects this chip's filter.
 */
function TagChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        font: 'inherit',
        fontSize: '0.8rem',
        cursor: 'pointer',
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid var(--color-border)',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? '#fff' : 'var(--color-text-muted)',
      }}
    >
      {label}
    </button>
  )
}
