/**
 * dm/autosave.tsx — the shared autosave engine + list helpers used by the DM
 * workspace panels (Notes and Session log, subphase 3.1.2).
 *
 * The character panels (Journal, Inventory, …) each grew their own copy of this
 * optimistic/debounced/offline-retry save machinery. The two Phase 3.1 panels
 * are siblings built at the same time, so they share one implementation here
 * instead of duplicating it twice more. Nothing here talks to Supabase directly
 * — callers pass in `() => Promise<…>` save thunks; this module only sequences,
 * debounces, retries, and surfaces save status.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

/** The user-visible save status shown by <SaveIndicator>. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * useAutosave — sequences save thunks with a per-key debounce, tracks in-flight
 * count, remembers thunks that FAILED (keyed) so they can be retried when the
 * network returns, and exposes a single roll-up SaveState.
 *
 * Returns:
 *  - saveState / error — current status for the indicator and error line.
 *  - runSave(fn, key?) — run a save NOW (no debounce). Used for deletes, adds,
 *    reorders, and deliberate toggles that shouldn't sit pending.
 *  - scheduleSave(key, fn) — debounce a save under `key`; a newer edit to the
 *    same key cancels the previous pending timer (last-write-wins per field).
 *  - clearError — clear the error line (e.g. before a fresh action).
 *
 * A `key` marks a save as retryable: on failure the latest thunk for that key is
 * stashed in `pending` and replayed on the window `online` event. Un-keyed saves
 * (one-shots like adds) surface an error but aren't auto-retried.
 */
export function useAutosave(debounceMs = 600) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Per-key debounce timers, count of saves currently awaiting the server, and
  // the last failed thunk per key (the offline-retry queue). Refs, not state:
  // they're control machinery that must not trigger re-renders on mutation.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())

  /**
   * Runs a save thunk immediately, updating the roll-up state. On success and
   * when nothing else is in flight, reports 'saved' (or 'error' if some keyed
   * thunk is still queued for retry). On failure, stashes a keyed thunk for
   * later replay and reports 'error'.
   */
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

  /** Debounces `fn` under `key`; a newer call to the same key resets the timer. */
  const scheduleSave = useCallback(
    (key: string, fn: () => Promise<unknown>) => {
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      const t = setTimeout(() => {
        timers.current.delete(key)
        void runSave(fn, key)
      }, debounceMs)
      timers.current.set(key, t)
    },
    [runSave, debounceMs],
  )

  // Cancel any outstanding debounce timers on unmount so a late fire can't call
  // setState on a torn-down component.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // When the browser comes back online, replay every queued failed save.
  useEffect(() => {
    function flush() {
      if (pending.current.size === 0) return
      for (const [key, fn] of Array.from(pending.current.entries())) void runSave(fn, key)
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [runSave])

  const clearError = useCallback(() => setError(null), [])

  return { saveState, error, setError, runSave, scheduleSave, clearError }
}

/**
 * SaveIndicator — the small "Saving… / All changes saved / Save failed" line.
 * Renders nothing while idle so callers can mount it unconditionally.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
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

/** The thin accent line marking the active drop gap during a drag-reorder. */
export function InsertionBar() {
  return (
    <div aria-hidden style={{ height: 3, background: 'var(--color-accent)', borderRadius: 2, margin: '2px 0' }} />
  )
}

/** Where a drag will drop, as an insertion index (0..count) into the list. */
export type DropIndicator = { index: number } | null

/**
 * Returns a new array with the item matching `fromPred` moved to `toIndex` (an
 * insertion index in the ORIGINAL array's coordinates, 0..length). Pure; returns
 * the SAME reference on a no-op move so callers can skip a redundant save.
 */
export function moveToIndex<T>(arr: T[], fromPred: (x: T) => boolean, toIndex: number): T[] {
  const fromIdx = arr.findIndex(fromPred)
  if (fromIdx < 0) return arr
  if (toIndex === fromIdx || toIndex === fromIdx + 1) return arr
  const item = arr[fromIdx]
  const without = arr.filter((_, i) => i !== fromIdx)
  const adj = toIndex > fromIdx ? toIndex - 1 : toIndex
  return [...without.slice(0, adj), item, ...without.slice(adj)]
}

/** Computes an insertion index for a dragged-over row from the pointer's Y. */
export function halfIndex(e: DragEvent, rowIndex: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY > r.top + r.height / 2 ? rowIndex + 1 : rowIndex
}

/**
 * useDragReorder — encapsulates one vertical drag-to-reorder context (a single
 * list). Panels with multiple independent lists (e.g. NPC roster + stat sections
 * + fields) call this once per list. It owns the drag/drop refs and the live
 * insertion indicator, and calls `onMove(fromId, toIndex)` on drop so the caller
 * can apply `moveToIndex` to its state and persist.
 *
 * Wiring in the panel:
 *  - Spread `containerProps` on the list wrapper (handles the drop in the gap
 *    below the last row → "move to bottom").
 *  - Render `<InsertionBar/>` before row `i` when `indicator?.index === i`, and
 *    once more after the last row when `indicator?.index === list.length`.
 *  - Spread `rowProps(i)` on each row wrapper (sets the insertion index by Y).
 *  - Spread `handleProps(id)` on the drag handle element (the ⠿ grip).
 *
 * @param onMove - Called on a completed drop with the dragged id and the target
 *   insertion index (0..length). The caller reorders + persists.
 */
export function useDragReorder(onMove: (fromId: string, toIndex: number) => void) {
  const dragId = useRef<string | null>(null)
  const dropTarget = useRef<DropIndicator>(null)
  const [indicator, setIndicator] = useState<DropIndicator>(null)

  function clear() {
    dragId.current = null
    dropTarget.current = null
    setIndicator(null)
  }
  function commit() {
    const fromId = dragId.current
    const target = dropTarget.current
    clear()
    if (fromId && target) onMove(fromId, target.index)
  }

  return {
    /** The live insertion indicator (drives <InsertionBar/> placement). */
    indicator,
    /** Spread onto the list container (fallback drop for the trailing gap). */
    containerProps: {
      onDragOver: (e: DragEvent) => {
        if (dragId.current) e.preventDefault()
      },
      onDrop: (e: DragEvent) => {
        if (!dragId.current) return
        e.preventDefault()
        commit()
      },
    },
    /** Spread onto row `index`'s wrapper (sets the insertion index by pointer Y). */
    rowProps: (index: number) => ({
      onDragOver: (e: DragEvent) => {
        if (!dragId.current) return
        e.preventDefault()
        const ind = { index: halfIndex(e, index) }
        dropTarget.current = ind
        setIndicator(ind)
      },
      onDrop: (e: DragEvent) => {
        if (!dragId.current) return
        e.preventDefault()
        commit()
      },
    }),
    /** Spread onto the drag handle (the grip) for row `id`. */
    handleProps: (id: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        dragId.current = id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
      },
      onDragEnd: clear,
    }),
  }
}
