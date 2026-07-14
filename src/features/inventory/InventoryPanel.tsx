/**
 * InventoryPanel — the player's "Inventory" workspace body (Phase 2.2.2).
 *
 * Owns the inventory UX for the OWNING player: a flat list of items on their
 * character, each with a name, quantity, free-text notes, and an equipped flag.
 * Supports add / edit / remove, drag-to-reorder, and the same autosave model as
 * the character sheet:
 *   - optimistic local edits, debounced per-item to the server,
 *   - a "Saving… / All changes saved / Save failed" indicator,
 *   - an offline-retry queue flushed on reconnect,
 *   - native HTML5 drag-to-reorder with a visible insertion line.
 *
 * Inventory hangs off the character, so it first resolves the player's character
 * for this campaign (getMyCharacter). If they have none yet, it points them to
 * the "My character" tab rather than inventing a character here. RLS (migration
 * 0012) is the real guard — owner read/write, DM read-only, others none.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { getMyCharacter, type Character } from '../character/api'
import {
  createItem,
  deleteItem,
  listItems,
  reorderItems,
  updateItem,
  type InventoryItem,
} from './api'

/** Autosave debounce window: how long after the last keystroke we persist. */
const SAVE_DEBOUNCE_MS = 600

/** The transient save indicator's state. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** The live drop target during a drag (insertion index; `count` = append). */
type DropIndicator = { index: number } | null

/**
 * @param campaignId - The campaign whose inventory workspace this is.
 * @param currentUserId - The signed-in player's id (owner of the character).
 */
export function InventoryPanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  const [character, setCharacter] = useState<Character | null>(null)
  // Optimistic source of truth the UI renders and mutates locally.
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Item ids whose notes are expanded to a full multi-line editor. Notes stay a
  // single-line quick view by default; expanding reveals the whole description.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Item ids whose collapsed notes preview overflows its line (so we render the
  // custom "…" dots). Measured from the DOM because CSS can't tell us, and the
  // native text-overflow ellipsis can't be styled bigger/spaced the way we want.
  const [overflowing, setOverflowing] = useState<Set<string>>(new Set())
  // Live refs to each item's notes-preview text span, for the overflow measure.
  const previewRefs = useRef<Map<string, HTMLSpanElement>>(new Map())

  // Per-key debounce timers (keyed by `item-<id>`) so edits to different items
  // don't cancel each other.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  // Failed saves awaiting retry on reconnect, keyed like their debounce timer.
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())

  // Drag state: the id being dragged, and the live drop target (ref for the drop
  // handler so it reads the latest value; state for the visual insertion line).
  const dragId = useRef<string | null>(null)
  const dropTarget = useRef<DropIndicator>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)

  /**
   * Runs a persistence fn tracked by the save indicator. With a `key`, joins the
   * offline-retry queue (success clears it; failure enqueues for reconnect).
   * @param fn - The async DB call.
   * @param key - Optional retry-queue identity.
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

  /** Debounces a keyed save; the latest edit wins after the user pauses. */
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

  // Clear pending debounce timers on unmount.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // Flush the offline-retry queue when connectivity returns.
  useEffect(() => {
    function flush() {
      if (pending.current.size === 0) return
      for (const [key, fn] of Array.from(pending.current.entries())) void runSave(fn, key)
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [runSave])

  // Measure which collapsed notes previews overflow their line, so we can show
  // the custom ellipsis only when there's actually hidden text. Runs after every
  // layout that could change it (items/notes/expanded change) and on resize.
  useLayoutEffect(() => {
    function measure() {
      const next = new Set<string>()
      for (const [id, el] of previewRefs.current) {
        // +1 guards against sub-pixel rounding falsely flagging overflow.
        if (el.scrollWidth > el.clientWidth + 1) next.add(id)
      }
      // Only update state when the set actually changed (avoid a render loop).
      setOverflowing((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev
        return next
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [items, expanded])

  /** Loads the player's character and its inventory. */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await getMyCharacter(campaignId, currentUserId)
      setCharacter(c)
      setItems(c ? await listItems(c.id) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your inventory.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // -------------------------------------------------------------------------
  // Item actions
  // -------------------------------------------------------------------------

  /** Appends a new item (default name) to the end of the list. */
  async function handleAddItem() {
    if (!character) return
    const position = items.length
    await runSave(async () => {
      // Empty name → the input shows its "Item name" placeholder (ghost text)
      // until the player types one; the DB permits '' since migration 0013.
      const item = await createItem(character.id, '', position)
      setItems((prev) => [...prev, item])
    })
  }

  /**
   * Optimistically edits an item field and debounces one save for it.
   * @param id - Item id.
   * @param patch - The changed columns.
   */
  function handleItemChange(
    id: string,
    patch: Partial<Pick<InventoryItem, 'name' | 'qty' | 'notes' | 'equipped'>>,
  ) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    scheduleSave(`item-${id}`, () => {
      const clean = { ...patch }
      // A blank name is allowed (migration 0013) — the input falls back to its
      // placeholder — so persist exactly what the player typed, only trimming.
      if (clean.name !== undefined) clean.name = clean.name.trim()
      // Guard the qty floor (the number input can transiently yield 0/NaN).
      if (clean.qty !== undefined && (!Number.isFinite(clean.qty) || clean.qty < 1)) {
        clean.qty = 1
      }
      return updateItem(id, clean)
    })
  }

  /**
   * Removes an item, confirming first when it carries content the player set
   * (a real name, notes, qty > 1, or equipped). A pristine "New item" row with
   * qty 1 and no notes deletes instantly.
   */
  async function handleDeleteItem(id: string) {
    const item = items.find((it) => it.id === id)
    if (!item) return
    // A pristine, untouched item (empty name, qty 1, no notes, not equipped) has
    // no content → delete instantly; anything the player set prompts to confirm.
    const hasContent =
      item.name.trim() !== '' || item.notes.trim() !== '' || item.qty > 1 || item.equipped
    if (hasContent && !window.confirm(`Delete "${item.name.trim() || 'this item'}"? This cannot be undone.`)) {
      return
    }
    const prev = items
    setItems((cur) => cur.filter((it) => it.id !== id))
    await runSave(() => deleteItem(id)).catch(() => setItems(prev))
  }

  /** Toggles whether an item's notes are shown as a full multi-line editor. */
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // -------------------------------------------------------------------------
  // Drag-to-reorder (ref-based drop target; per-row onDrop)
  // -------------------------------------------------------------------------

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

  /** Applies the pending reorder (reads refs, never stale state). */
  function applyDrop() {
    const fromId = dragId.current
    const target = dropTarget.current
    clearDrag()
    if (!fromId || !target) return
    setItems((prev) => {
      const next = moveToIndex(prev, (it) => it.id === fromId, target.index)
      if (next === prev) return prev
      void runSave(() => reorderItems(next.map((it) => it.id)), 'reorder-items')
      return next
    })
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  // Inventory needs a character; if there isn't one, send them to create it.
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
          Create your character on the <strong>My character</strong> tab first — your inventory
          hangs off it.
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Inventory</h2>
        <SaveIndicator state={saveState} />
      </div>

      <FormError message={error} />

      {items.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          Nothing carried yet. Add your first item below.
        </p>
      ) : (
        <>
          {/* Column headers (aligns with the row layout below). */}
          <div
            style={{
              marginTop: 'var(--space-5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
            }}
          >
            <span style={{ width: 16 }} aria-hidden />
            <span style={{ width: 64, textAlign: 'center' }}>Equip</span>
            <span style={{ flex: '1 1 30%' }}>Item</span>
            <span style={{ width: 64, textAlign: 'center' }}>Qty</span>
            <span style={{ flex: '1 1 40%' }}>Notes</span>
            <span style={{ width: 24 }} aria-hidden />
            <span style={{ width: 24 }} aria-hidden />
          </div>

          <div
            onDragOver={(e: DragEvent) => {
              if (dragId.current) e.preventDefault()
            }}
            onDrop={(e: DragEvent) => {
              if (!dragId.current) return
              e.preventDefault()
              applyDrop()
            }}
            style={{
              marginTop: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            {items.map((item, i) => (
              <Fragment key={item.id}>
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
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                >
                  <span
                    draggable
                    onDragStart={(e: DragEvent) => startDrag(e, item.id)}
                    onDragEnd={clearDrag}
                    title="Drag to reorder item"
                    aria-label="Drag to reorder item"
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none', width: 16 }}
                  >
                    ⠿
                  </span>
                  <span style={{ width: 64, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={item.equipped}
                      onChange={(e) => handleItemChange(item.id, { equipped: e.target.checked })}
                      aria-label="Equipped"
                      title="Equipped"
                    />
                  </span>
                  <input
                    value={item.name}
                    onChange={(e) => handleItemChange(item.id, { name: e.target.value })}
                    maxLength={200}
                    aria-label="Item name"
                    placeholder="Item name"
                    style={{
                      flex: '1 1 30%',
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
                    type="number"
                    min={1}
                    value={item.qty}
                    onChange={(e) =>
                      handleItemChange(item.id, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                    }
                    aria-label="Quantity"
                    style={{
                      width: 64,
                      font: 'inherit',
                      textAlign: 'center',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      color: 'var(--color-text)',
                    }}
                  />
                  {/* Notes preview: a single line whose text clips and, when it
                      overflows, is followed by a custom oversized/spaced ellipsis
                      (the native text-overflow ellipsis can't be styled). Click to
                      expand the full editor below. `minWidth: 0` lets the inner
                      text span clip inside the flex row. */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                    title={item.notes.trim() ? item.notes : 'Add notes'}
                    aria-label={expanded.has(item.id) ? 'Collapse notes' : 'Expand notes'}
                    aria-expanded={expanded.has(item.id)}
                    style={{
                      flex: '1 1 40%',
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      textAlign: 'left',
                      font: 'inherit',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      cursor: 'pointer',
                      color: item.notes.trim() ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    <span
                      ref={(el) => {
                        if (el) previewRefs.current.set(item.id, el)
                        else previewRefs.current.delete(item.id)
                      }}
                      style={{
                        minWidth: 0,
                        flex: '0 1 auto',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'clip',
                      }}
                    >
                      {item.notes.trim() || 'Notes'}
                    </span>
                    {overflowing.has(item.id) && (
                      <span
                        aria-hidden
                        style={{
                          flex: 'none',
                          marginLeft: 6,
                          fontSize: '1.35em',
                          lineHeight: 1,
                          letterSpacing: '0.22em',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        ...
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => toggleExpanded(item.id)}
                    aria-label={expanded.has(item.id) ? 'Collapse notes' : 'Expand notes'}
                    aria-expanded={expanded.has(item.id)}
                    title={expanded.has(item.id) ? 'Collapse notes' : 'Expand notes'}
                    style={{
                      width: 24,
                      font: 'inherit',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 'var(--space-1)',
                    }}
                  >
                    {expanded.has(item.id) ? '▾' : '▸'}
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    aria-label="Delete item"
                    title="Delete item"
                    style={{
                      width: 24,
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
                {/* Expanded editor: full multi-line description for this item. */}
                {expanded.has(item.id) && (
                  <div style={{ paddingLeft: 'calc(16px + var(--space-2))', paddingBottom: 'var(--space-2)' }}>
                    <AutoTextarea
                      value={item.notes}
                      onChange={(e) => handleItemChange(item.id, { notes: e.target.value })}
                      aria-label="Full item notes"
                      placeholder="Full description / notes"
                      minRows={2}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        font: 'inherit',
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        padding: 'var(--space-2)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </div>
                )}
              </Fragment>
            ))}
            {/* Trailing gap: lets an item be dropped at the LAST position. */}
            {dropIndicator?.index === items.length && <InsertionBar />}
          </div>
        </>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button variant="secondary" onClick={handleAddItem} style={{ width: 'auto' }}>
          + Add item
        </Button>
      </div>
    </div>
  )
}

/** SaveIndicator — the subtle autosave status line. */
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

/** InsertionBar — the thin accent line marking the active drop gap. */
function InsertionBar() {
  return (
    <div
      aria-hidden
      style={{ height: 3, background: 'var(--color-accent)', borderRadius: 2, margin: '2px 0' }}
    />
  )
}

/**
 * Returns a new array with the item matching `fromPred` moved to `toIndex` (an
 * insertion index in the ORIGINAL array's coordinates; length = append). Returns
 * the same reference on a no-op so callers can skip a redundant save.
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
