/**
 * CharacterPanel — the player's "My character" workspace body (Phase 2.1.2).
 *
 * Owns the full character-sheet UX for the OWNING player:
 *   - Character creation (name) when the player has none in this campaign yet.
 *   - A free-form sheet: the player adds/renames/reorders their own sections and
 *     label/value fields — there is no fixed schema (the DB doesn't impose one).
 *   - Autosave with optimistic UI: local edits apply instantly and are debounced
 *     to the server; a small status line reflects saving/saved/error.
 *   - Drag-to-reorder for both sections and the fields within a section (native
 *     HTML5 drag-and-drop — no external dnd dependency).
 *   - A portrait via the shared media pipeline, and a one-click "starter layout".
 *
 * Access: rendered only under the player-only "My character" tab. RLS (migration
 * 0010) is the real guard — a DM viewing a player's sheet gets read-only access
 * through a different (later) surface; this panel assumes the caller owns the
 * character and lets the server reject anything it shouldn't allow.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { Button, FormError, TextField } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { ImageUpload } from '../media/ImageUpload'
import { signedUrlFor } from '../media/api'
import {
  applyStarterLayout,
  createCharacter,
  createField,
  createSection,
  deleteCharacter,
  deleteField,
  deleteSection,
  getMyCharacter,
  getSheet,
  reorderFields,
  reorderSections,
  updateCharacter,
  updateField,
  updateSection,
  type Character,
  type SectionWithFields,
  type SheetField,
} from './api'

/** Autosave debounce window: how long after the last keystroke we persist. */
const SAVE_DEBOUNCE_MS = 600

/** The transient save indicator's state. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Where a drag will drop, as an INSERTION INDEX (0..count) rather than a
 * "before this item" target — an index of `count` means "append to the end",
 * which is what lets an item be dragged to the last position (the old
 * before-target model had no slot past the final item). Null = not dragging.
 *  - kind 'section': index into the sections array.
 *  - kind 'field':  index into `sectionId`'s fields array.
 */
type DropIndicator =
  | { kind: 'section'; index: number }
  | { kind: 'field'; sectionId: string; index: number }
  | null

/**
 * @param campaignId - The campaign whose character workspace this is.
 * @param currentUserId - The signed-in player's id (owner of the character).
 */
export function CharacterPanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  // The player's character in this campaign (null = none created yet).
  const [character, setCharacter] = useState<Character | null>(null)
  // The editable sheet: sections (ordered) each with their ordered fields. This
  // is the optimistic source of truth the UI renders and mutates locally.
  const [sections, setSections] = useState<SectionWithFields[]>([])
  // Resolved signed URL for the portrait thumbnail (private bucket).
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Creation form state (shown only when there's no character yet).
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // Whether a starter-layout apply is in flight (disables the button).
  const [applyingStarter, setApplyingStarter] = useState(false)

  // Per-key debounce timers for autosave. Keyed by e.g. `char-name` or
  // `field-<id>`, so edits to different entities don't cancel each other.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Count of in-flight saves, so the status line shows "Saving…" until the last
  // one settles rather than flickering per request.
  const inFlight = useRef(0)
  // Failed saves awaiting retry, keyed by the same key as their debounce timer.
  // A later successful/failed save for the same key overwrites the entry, so we
  // only ever retry the LATEST intent per entity. Flushed on the `online` event
  // (see the effect below) so an edit made offline isn't lost — it lands as soon
  // as the network returns, rather than only if the user happens to edit again.
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())

  // What is currently being dragged (a section, or a field within a section).
  // A ref (not state) because drag callbacks fire rapidly and we never render
  // off it directly.
  const dragItem = useRef<
    { kind: 'section'; id: string } | { kind: 'field'; sectionId: string; id: string } | null
  >(null)
  // The current drop target, mirrored into a ref so the drop handler reads the
  // LATEST value (reading `dropIndicator` state in a drop closure can be stale).
  const dropTarget = useRef<DropIndicator>(null)
  // The live insertion point shown during a drag (visual only; see DropIndicator).
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)

  /**
   * Runs a persistence function tracked by the save indicator. Increments the
   * in-flight counter and reflects saving/saved/error.
   *
   * When a `key` is given, the call participates in the offline-retry queue: a
   * success clears any queued retry for that key; a failure enqueues `fn` to be
   * retried on reconnect. Keyless calls (e.g. optimistic creates/deletes that
   * roll back their local state on failure) don't queue.
   * @param fn - The async DB call to run.
   * @param key - Optional retry-queue identity (matches the debounce key).
   */
  const runSave = useCallback(async (fn: () => Promise<unknown>, key?: string) => {
    inFlight.current += 1
    setSaveState('saving')
    try {
      await fn()
      if (key) pending.current.delete(key)
      inFlight.current -= 1
      if (inFlight.current === 0) {
        if (pending.current.size > 0) {
          setSaveState('error')
        } else {
          // Everything settled — clear any lingering "Save failed" message.
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

  /**
   * Debounces a save under a key: replaces any pending save for the same key so
   * only the latest edit is written after the user pauses typing.
   * @param key - Stable identity for the thing being edited.
   * @param fn - The DB call to run once the debounce elapses.
   */
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

  // Clear any pending debounce timers on unmount (avoid saving into the void).
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // Flush the offline-retry queue when the browser regains connectivity. Each
  // queued fn re-runs under its own key, so a success clears it and a repeat
  // failure re-queues it (retried again on the next `online`). This is what
  // makes "Save failed" eventually resolve to a real write without the user
  // having to re-type the edit.
  useEffect(() => {
    function flush() {
      if (pending.current.size === 0) return
      // Snapshot so re-queued failures don't cause an infinite loop this tick.
      const entries = Array.from(pending.current.entries())
      for (const [key, fn] of entries) void runSave(fn, key)
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [runSave])

  /** Loads the character and (if any) its sheet + portrait URL. */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await getMyCharacter(campaignId, currentUserId)
      setCharacter(c)
      if (c) {
        const [sheet, url] = await Promise.all([
          getSheet(c.id),
          c.portrait_asset_id
            ? // The character stores the asset id, not its Storage path; the
              // thumbnail path is derived from the asset in the media pipeline.
              // We only have the id here, so resolve the URL lazily below via the
              // upload response. For an already-stored portrait we fetch its path
              // from media_assets through a signed URL keyed on the asset id.
              resolvePortraitUrl(c.portrait_asset_id)
            : Promise.resolve(null),
        ])
        setSections(sheet)
        setPortraitUrl(url)
      } else {
        setSections([])
        setPortraitUrl(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your character.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // -------------------------------------------------------------------------
  // Character-level actions
  // -------------------------------------------------------------------------

  /** Creates the character from the creation form, then loads its (empty) sheet. */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    // Name is required — surface WHY rather than silently doing nothing when the
    // player submits a blank (or whitespace-only) name.
    if (!name) {
      setError('Please enter a character name before creating.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const c = await createCharacter(campaignId, currentUserId, name)
      setCharacter(c)
      setSections([])
      setNewName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create your character.')
    } finally {
      setCreating(false)
    }
  }

  /** Optimistically updates the character name locally and debounces the save. */
  function handleNameChange(name: string) {
    if (!character) return
    setCharacter({ ...character, name })
    scheduleSave('char-name', () => updateCharacter(character.id, { name: name.trim() }))
  }

  /** Deletes the whole character (with confirmation) and returns to creation. */
  async function handleDeleteCharacter() {
    if (!character) return
    if (!window.confirm('Delete this character and its entire sheet? This cannot be undone.')) {
      return
    }
    setError(null)
    try {
      await deleteCharacter(character.id)
      setCharacter(null)
      setSections([])
      setPortraitUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete your character.')
    }
  }

  // -------------------------------------------------------------------------
  // Section actions
  // -------------------------------------------------------------------------

  /** Appends a new, blank section at the end and focuses nothing special. */
  async function handleAddSection() {
    if (!character) return
    const position = sections.length
    await runSave(async () => {
      const s = await createSection(character.id, 'New section', position)
      setSections((prev) => [...prev, { ...s, fields: [] }])
    })
  }

  /** Optimistically renames a section and debounces the save. */
  function handleSectionTitleChange(sectionId: string, title: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title } : s)))
    scheduleSave(`section-${sectionId}`, () =>
      updateSection(sectionId, { title: title.trim() || 'Untitled' }),
    )
  }

  /**
   * Removes a section and its fields, then persists the delete. Confirms first
   * when the section contains ANY fields (regardless of their content), so a
   * misclick can't wipe a populated section; an empty section deletes instantly.
   */
  async function handleDeleteSection(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return
    if (
      section.fields.length > 0 &&
      !window.confirm(
        `Delete the "${section.title || 'Untitled'}" section and its ${section.fields.length} field(s)? This cannot be undone.`,
      )
    ) {
      return
    }
    const prev = sections
    setSections((cur) => cur.filter((s) => s.id !== sectionId))
    await runSave(() => deleteSection(sectionId)).catch(() => setSections(prev))
  }

  /** Applies the convenience starter layout, appended after existing sections. */
  async function handleApplyStarter() {
    if (!character) return
    setApplyingStarter(true)
    setError(null)
    try {
      await applyStarterLayout(character.id, sections.length)
      setSections(await getSheet(character.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply the starter layout.')
    } finally {
      setApplyingStarter(false)
    }
  }

  // -------------------------------------------------------------------------
  // Field actions
  // -------------------------------------------------------------------------

  /** Appends a blank field to a section. */
  async function handleAddField(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return
    const position = section.fields.length
    await runSave(async () => {
      // Empty label → the input shows its "Label" placeholder (ghost text) until
      // the player types one; the DB permits '' since migration 0011.
      const f = await createField(sectionId, '', '', position)
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, fields: [...s.fields, f] } : s)),
      )
    })
  }

  /**
   * Optimistically edits a field's label or value and debounces one save that
   * writes whichever changed.
   * @param sectionId - Owning section id (for local update targeting).
   * @param fieldId - Field id.
   * @param patch - The changed { label?, value? }.
   */
  function handleFieldChange(
    sectionId: string,
    fieldId: string,
    patch: Partial<Pick<SheetField, 'label' | 'value'>>,
  ) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
            }
          : s,
      ),
    )
    scheduleSave(`field-${fieldId}`, () => {
      // A blank label is allowed (migration 0011) — the input falls back to its
      // placeholder — so persist exactly what the player typed, only trimming.
      const clean: Partial<Pick<SheetField, 'label' | 'value'>> = { ...patch }
      if (clean.label !== undefined) clean.label = clean.label.trim()
      return updateField(fieldId, clean)
    })
  }

  /**
   * Removes a field, then persists the delete. Confirms first when the field has
   * a non-empty label or value (i.e. the user typed something), so an accidental
   * ✕ can't silently drop data; a blank/untouched field deletes instantly.
   */
  async function handleDeleteField(sectionId: string, fieldId: string) {
    const field = sections.find((s) => s.id === sectionId)?.fields.find((f) => f.id === fieldId)
    if (!field) return
    // "Content" = something the user actually typed. A just-added field now
    // starts with an empty label + empty value (ghost placeholder), so an
    // untouched field has no content → delete instantly, no prompt.
    const hasContent = field.label.trim() !== '' || field.value.trim() !== ''
    if (hasContent && !window.confirm('Delete this field? This cannot be undone.')) {
      return
    }
    const prev = sections
    setSections((cur) =>
      cur.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s,
      ),
    )
    await runSave(() => deleteField(fieldId)).catch(() => setSections(prev))
  }

  // -------------------------------------------------------------------------
  // Drag-to-reorder (native HTML5 DnD)
  //
  // Insertion-index model: as an item is dragged over a row we compute whether
  // the pointer is in the row's upper or lower half and set a drop index of
  // `i` or `i+1`. An index equal to the item count means "append to end", so an
  // item CAN be moved to the last position (the earlier before-target model had
  // no slot past the final item). `dropIndicator` drives the on-screen insertion
  // line; the drop handlers read it to perform the move.
  // -------------------------------------------------------------------------

  /** Computes an insertion index for a dragged-over row from the pointer's Y. */
  function halfIndex(e: DragEvent, rowIndex: number): number {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? rowIndex + 1 : rowIndex
  }

  /** Records the drag source and marks the operation a "move" for the cursor. */
  function startDrag(
    e: DragEvent,
    item: NonNullable<typeof dragItem.current>,
  ) {
    dragItem.current = item
    e.dataTransfer.effectAllowed = 'move'
    // Some browsers require drag data to be set for drop events to fire at all.
    e.dataTransfer.setData('text/plain', item.id)
  }

  /** Sets the live drop target (ref for the drop handler + state for the line). */
  function setDrop(ind: DropIndicator) {
    dropTarget.current = ind
    setDropIndicator(ind)
  }

  /** Clears all drag/drop state once a drag ends (dropped or cancelled). */
  function clearDrag() {
    dragItem.current = null
    dropTarget.current = null
    setDropIndicator(null)
  }

  /** Applies the pending SECTION reorder (reads the ref, not stale state). */
  function applySectionDrop() {
    const item = dragItem.current
    const target = dropTarget.current
    clearDrag()
    if (!item || item.kind !== 'section' || target?.kind !== 'section') return
    setSections((prev) => {
      const next = moveToIndex(prev, (s) => s.id === item.id, target.index)
      if (next === prev) return prev
      void runSave(() => reorderSections(next.map((s) => s.id)), 'reorder-sections')
      return next
    })
  }

  /** Applies the pending FIELD reorder within its section (reads the ref). */
  function applyFieldDrop() {
    const item = dragItem.current
    const target = dropTarget.current
    clearDrag()
    if (
      !item ||
      item.kind !== 'field' ||
      target?.kind !== 'field' ||
      target.sectionId !== item.sectionId
    ) {
      return
    }
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== item.sectionId) return s
        const fields = moveToIndex(s.fields, (f) => f.id === item.id, target.index)
        if (fields === s.fields) return s
        void runSave(() => reorderFields(fields.map((f) => f.id)), `reorder-fields-${s.id}`)
        return { ...s, fields }
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  // No character yet → creation form.
  if (!character) {
    return (
      <div style={{ marginTop: 'var(--space-6)', maxWidth: 420 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>Create your character</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Give your character a name to start. You can build out the sheet however you like
          afterward.
        </p>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <TextField
            label="Character name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <FormError message={error} />
          <Button type="submit" busy={creating} style={{ width: 'auto' }}>
            Create character
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      {/* Header: portrait, name, save status, delete. */}
      <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 160 }}>
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt={`${character.name} portrait`}
              style={{
                width: 160,
                height: 160,
                objectFit: 'cover',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
              }}
            />
          ) : null}
          <div style={{ marginTop: portraitUrl ? 'var(--space-3)' : 0 }}>
            <ImageUpload
              campaignId={campaignId}
              label={portraitUrl ? 'Change portrait' : 'Portrait'}
              onUploaded={(result) => {
                // Point the character at the new asset and show it immediately.
                setPortraitUrl(result.thumbUrl ?? result.originalUrl)
                void runSave(
                  () => updateCharacter(character.id, { portrait_asset_id: result.asset.id }),
                  'char-portrait',
                )
              }}
            />
          </div>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <TextField
            label="Character name"
            value={character.name}
            onChange={(e) => handleNameChange(e.target.value)}
            maxLength={120}
          />
          <div
            style={{
              marginTop: 'var(--space-3)',
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <SaveIndicator state={saveState} />
            <button
              onClick={handleDeleteCharacter}
              style={{
                marginLeft: 'auto',
                font: 'inherit',
                fontSize: '0.85rem',
                background: 'none',
                border: '1px solid var(--color-border)',
                color: 'var(--color-danger)',
                borderRadius: 'var(--radius)',
                padding: 'var(--space-1) var(--space-3)',
                cursor: 'pointer',
              }}
            >
              Delete character
            </button>
          </div>
        </div>
      </div>

      <FormError message={error} />

      {/* Empty sheet → offer the starter layout. */}
      {sections.length === 0 && (
        <div
          style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-6)',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius)',
          }}
        >
          <p style={{ marginTop: 0, color: 'var(--color-text-muted)' }}>
            Your sheet is empty. Add a section, or start from a common layout you can edit.
          </p>
          <Button
            variant="secondary"
            busy={applyingStarter}
            onClick={handleApplyStarter}
            style={{ width: 'auto', display: 'inline-block' }}
          >
            Use starter layout
          </Button>
        </div>
      )}

      {/* Sections. Each section row handles its own drop; the container repeats
          onDragOver/onDrop as a fallback so a drop in the gap below the last
          section (the "move to bottom" case) still lands. */}
      <div
        onDragOver={(e: DragEvent) => {
          if (dragItem.current?.kind === 'section') e.preventDefault()
        }}
        onDrop={(e: DragEvent) => {
          if (dragItem.current?.kind !== 'section') return
          e.preventDefault()
          applySectionDrop()
        }}
        style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
      >
        {sections.map((section, i) => (
          <Fragment key={section.id}>
            {/* Insertion line before this section when it's the active drop gap. */}
            {dropIndicator?.kind === 'section' && dropIndicator.index === i && <InsertionBar />}
            <div
              onDragOver={(e: DragEvent) => {
                // Only react while dragging a SECTION; ignore field drags.
                if (dragItem.current?.kind !== 'section') return
                e.preventDefault()
                setDrop({ kind: 'section', index: halfIndex(e, i) })
              }}
              onDrop={(e: DragEvent) => {
                if (dragItem.current?.kind !== 'section') return
                e.preventDefault()
                applySectionDrop()
              }}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                background: 'var(--color-surface)',
                padding: 'var(--space-4)',
              }}
            >
            {/* Section header: drag handle, title, delete. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                draggable
                onDragStart={(e: DragEvent) => startDrag(e, { kind: 'section', id: section.id })}
                onDragEnd={clearDrag}
                title="Drag to reorder section"
                style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                aria-label="Drag to reorder section"
              >
                ⠿
              </span>
              <input
                value={section.title}
                onChange={(e) => handleSectionTitleChange(section.id, e.target.value)}
                maxLength={120}
                aria-label="Section title"
                style={{
                  flex: 1,
                  font: 'inherit',
                  fontWeight: 600,
                  fontSize: '1.05rem',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-1) var(--space-2)',
                  color: 'var(--color-text)',
                }}
              />
              <button
                onClick={() => handleDeleteSection(section.id)}
                aria-label="Delete section"
                title="Delete section"
                style={{
                  font: 'inherit',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  padding: 'var(--space-1) var(--space-2)',
                }}
              >
                ✕
              </button>
            </div>

            {/* Fields. Each field row handles its own drop; the fields container
                repeats onDragOver/onDrop (scoped to THIS section, stopping
                propagation) as a fallback so a drop in the gap below the last
                field still lands, and never bubbles to the section reorder. */}
            <div
              onDragOver={(e: DragEvent) => {
                const d = dragItem.current
                if (d?.kind !== 'field' || d.sectionId !== section.id) return
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e: DragEvent) => {
                const d = dragItem.current
                if (d?.kind !== 'field' || d.sectionId !== section.id) return
                e.preventDefault()
                e.stopPropagation()
                applyFieldDrop()
              }}
              style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              {section.fields.map((field, j) => (
                <Fragment key={field.id}>
                  {/* Insertion line before this field when it's the active drop gap. */}
                  {dropIndicator?.kind === 'field' &&
                    dropIndicator.sectionId === section.id &&
                    dropIndicator.index === j && <InsertionBar />}
                  <div
                    onDragOver={(e: DragEvent) => {
                      // Only react while dragging a field within THIS section.
                      const d = dragItem.current
                      if (d?.kind !== 'field' || d.sectionId !== section.id) return
                      e.preventDefault()
                      e.stopPropagation()
                      setDrop({ kind: 'field', sectionId: section.id, index: halfIndex(e, j) })
                    }}
                    onDrop={(e: DragEvent) => {
                      const d = dragItem.current
                      if (d?.kind !== 'field' || d.sectionId !== section.id) return
                      e.preventDefault()
                      e.stopPropagation()
                      applyFieldDrop()
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  >
                  <span
                    draggable
                    onDragStart={(e: DragEvent) =>
                      startDrag(e, { kind: 'field', sectionId: section.id, id: field.id })
                    }
                    onDragEnd={clearDrag}
                    title="Drag to reorder field"
                    aria-label="Drag to reorder field"
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                  >
                    ⠿
                  </span>
                  <input
                    value={field.label}
                    onChange={(e) => handleFieldChange(section.id, field.id, { label: e.target.value })}
                    maxLength={120}
                    aria-label="Field label"
                    placeholder="Label"
                    style={{
                      flex: '0 0 34%',
                      font: 'inherit',
                      fontWeight: 600,
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <input
                    value={field.value}
                    onChange={(e) => handleFieldChange(section.id, field.id, { value: e.target.value })}
                    aria-label="Field value"
                    placeholder="Value"
                    style={{
                      flex: 1,
                      font: 'inherit',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <button
                    onClick={() => handleDeleteField(section.id, field.id)}
                    aria-label="Delete field"
                    title="Delete field"
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
                </Fragment>
              ))}
              {/* Trailing gap: lets a field be dropped at the LAST position. */}
              {dropIndicator?.kind === 'field' &&
                dropIndicator.sectionId === section.id &&
                dropIndicator.index === section.fields.length && <InsertionBar />}

              <button
                onClick={() => handleAddField(section.id)}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 'var(--space-1)',
                  font: 'inherit',
                  fontSize: '0.85rem',
                  background: 'none',
                  border: '1px dashed var(--color-border)',
                  color: 'var(--color-text-muted)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-1) var(--space-3)',
                  cursor: 'pointer',
                }}
              >
                + Add field
              </button>
            </div>
            </div>
          </Fragment>
        ))}
        {/* Trailing gap: lets a section be dropped at the LAST position. */}
        {dropIndicator?.kind === 'section' && dropIndicator.index === sections.length && (
          <InsertionBar />
        )}
      </div>

      {/* Add-section control. */}
      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button variant="secondary" onClick={handleAddSection} style={{ width: 'auto' }}>
          + Add section
        </Button>
      </div>
    </div>
  )
}

/**
 * SaveIndicator — the subtle autosave status line.
 * @param state - Current save state.
 */
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

/**
 * Resolves a signed thumbnail URL for a portrait media asset.
 *
 * The character row stores only the media asset id; the private bucket needs a
 * signed URL keyed on the object's Storage path. We fetch the asset's thumb_path
 * (falling back to storage_path) and sign that. Returns null if the asset is
 * gone or not readable (e.g. moderated away), so a missing portrait degrades to
 * "no image" rather than a broken one.
 * @param assetId - media_assets id from characters.portrait_asset_id.
 */
async function resolvePortraitUrl(assetId: string): Promise<string | null> {
  const { data } = await supabase
    .from('media_assets')
    .select('storage_path, thumb_path')
    .eq('id', assetId)
    .maybeSingle()
  if (!data) return null
  return signedUrlFor(data.thumb_path ?? data.storage_path)
}

/**
 * Returns a new array with the item matching `fromPred` moved to `toIndex`, an
 * insertion index in the ORIGINAL array's coordinates (0..length, where length
 * means "append to end"). Pure — does not mutate the input. Returns the SAME
 * array reference when the move is a no-op (item absent, or it would land back
 * in its current slot), so callers can skip a redundant save via `=== prev`.
 * @param arr - Source array.
 * @param fromPred - Identifies the item being moved.
 * @param toIndex - Target insertion index (0..arr.length).
 */
function moveToIndex<T>(arr: T[], fromPred: (x: T) => boolean, toIndex: number): T[] {
  const fromIdx = arr.findIndex(fromPred)
  if (fromIdx < 0) return arr
  // Moving to its own position (or the gap immediately after it) changes nothing.
  if (toIndex === fromIdx || toIndex === fromIdx + 1) return arr
  const item = arr[fromIdx]
  const without = arr.filter((_, i) => i !== fromIdx)
  // Removing an earlier item shifts later insertion points left by one.
  const adj = toIndex > fromIdx ? toIndex - 1 : toIndex
  return [...without.slice(0, adj), item, ...without.slice(adj)]
}

/**
 * InsertionBar — the thin accent line shown at the active drop gap during a
 * drag, so the user can see exactly where the item will land. Purely visual.
 */
function InsertionBar() {
  return (
    <div
      aria-hidden
      style={{
        height: 3,
        background: 'var(--color-accent)',
        borderRadius: 2,
        margin: '2px 0',
      }}
    />
  )
}
