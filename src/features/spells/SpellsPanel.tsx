/**
 * SpellsPanel — the player's "Spells" tab (Phase 2.4 redesign).
 *
 * Spells grouped by level (Cantrips, Level 1…9). Each spell has a name, a level
 * (0–9, 0 = cantrip), a "prepared" checkbox, and an expandable description.
 * Changing a spell's level moves it between groups. Add buttons per level (and a
 * general one defaulting to cantrip). Same autosave model as the other panels
 * (optimistic, debounced per spell, save indicator, offline retry). Level is the
 * primary ordering (structure); within a level the player can manually drag to
 * reorder, but a spell is LOCKED to its level while dragging — cross-level moves
 * happen only via the level selector, not the drag handle. RLS (0016): owner
 * read/write, DM read-only, others none.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { getMyCharacter, type Character } from '../character/api'
import {
  SPELL_LEVELS,
  createSpell,
  deleteSpell,
  levelLabel,
  listSpells,
  reorderSpells,
  updateSpell,
  type Spell,
} from './api'

const SAVE_DEBOUNCE_MS = 600
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Where a within-level drag will drop. `level` scopes the insertion line to the
 * group being reordered (so it never shows in a different level's list); `index`
 * is the insertion index into THAT level's spells (0..count, count = append).
 */
type DropIndicator = { level: number; index: number } | null

export function SpellsPanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  const [character, setCharacter] = useState<Character | null>(null)
  const [spells, setSpells] = useState<Spell[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())
  // Drag-to-reorder (scoped to a single level). `dragId`/`dragLevel` capture the
  // spell being dragged and the level it's locked to; `dropTarget` mirrors the
  // live insertion point into a ref so the drop handler reads the latest value.
  const dragId = useRef<string | null>(null)
  const dragLevel = useRef<number | null>(null)
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
      setSpells(c ? await listSpells(c.id) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your spells.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Adds a spell at the given level, appended after existing spells in it. */
  async function handleAdd(level: number) {
    if (!character) return
    // Append: position = count of spells already at this level, so a new spell
    // lands at the bottom of its group rather than sorting in by name.
    const position = spells.filter((s) => s.level === level).length
    await runSave(async () => {
      const s = await createSpell(character.id, level, '', position)
      setSpells((prev) => [...prev, s])
    })
  }

  function handleChange(
    id: string,
    patch: Partial<Pick<Spell, 'name' | 'level' | 'prepared' | 'description'>>,
  ) {
    setSpells((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    // `prepared` and `level` are discrete toggles/selects — persist immediately;
    // text (name/description) stays debounced.
    if (patch.prepared !== undefined || patch.level !== undefined) {
      void runSave(() => updateSpell(id, patch), `spell-${id}-meta`)
    } else {
      scheduleSave(`spell-${id}`, () => {
        const clean = { ...patch }
        if (clean.name !== undefined) clean.name = clean.name.trim()
        return updateSpell(id, clean)
      })
    }
  }

  async function handleDelete(id: string) {
    const s = spells.find((x) => x.id === id)
    if (!s) return
    const hasContent = s.name.trim() !== '' || s.description.trim() !== '' || s.prepared
    if (hasContent && !window.confirm(`Delete "${s.name.trim() || 'this spell'}"? This cannot be undone.`)) {
      return
    }
    const prev = spells
    setSpells((cur) => cur.filter((x) => x.id !== id))
    await runSave(() => deleteSpell(id)).catch(() => setSpells(prev))
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- drag-to-reorder (locked within a level) ----

  /** Computes an insertion index for a dragged-over row from the pointer's Y. */
  function halfIndex(e: DragEvent, rowIndex: number): number {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? rowIndex + 1 : rowIndex
  }

  /** Records the drag source and the level it is locked to. */
  function startDrag(e: DragEvent, id: string, level: number) {
    dragId.current = id
    dragLevel.current = level
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  /** Sets the live drop target (ref for the drop handler + state for the line). */
  function setDrop(ind: DropIndicator) {
    dropTarget.current = ind
    setDropIndicator(ind)
  }

  /** Clears all drag/drop state once a drag ends (dropped or cancelled). */
  function clearDrag() {
    dragId.current = null
    dragLevel.current = null
    dropTarget.current = null
    setDropIndicator(null)
  }

  /**
   * Applies the pending within-level reorder. Reorders only the dragged spell's
   * level group (leaving every other level untouched), writes the new order to
   * `position`, and re-sorts the flat state so it matches what the DB will
   * return on the next load. A no-op move (same slot / different level) is ignored.
   */
  function applyDrop() {
    const fromId = dragId.current
    const target = dropTarget.current
    clearDrag()
    if (!fromId || !target) return
    setSpells((prev) => {
      const spell = prev.find((s) => s.id === fromId)
      // Guard the level lock: only reorder if the drop target is the dragged
      // spell's own level (the UI already scopes this, but never trust the DOM).
      if (!spell || spell.level !== target.level) return prev
      const group = prev.filter((s) => s.level === target.level)
      const moved = moveToIndex(group, (s) => s.id === fromId, target.index)
      if (moved === group) return prev
      void runSave(() => reorderSpells(moved.map((s) => s.id)), `reorder-spells-${target.level}`)
      // Reassign positions from the new group order, then re-sort the flat array
      // (level asc, position asc, name asc) to mirror listSpells' ordering.
      const posById = new Map(moved.map((s, i) => [s.id, i]))
      return prev
        .map((s) => (posById.has(s.id) ? { ...s, position: posById.get(s.id)! } : s))
        .sort(
          (a, b) =>
            a.level - b.level || a.position - b.position || a.name.localeCompare(b.name),
        )
    })
  }

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

  // Only render level groups that have spells, plus keep empty ones hidden.
  const levelsWithSpells = SPELL_LEVELS.filter((lvl) => spells.some((s) => s.level === lvl))

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Spells</h2>
        <SaveIndicator state={saveState} />
      </div>
      <FormError message={error} />

      {spells.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No spells yet. Add your first below.
        </p>
      ) : (
        <div style={{ marginTop: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {levelsWithSpells.map((lvl) => (
            <div key={lvl}>
              <h3
                style={{
                  margin: '0 0 var(--space-2)',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-text-muted)',
                }}
              >
                {levelLabel(lvl)}
              </h3>
              <div
                // Group-level fallback so a drop in the gap below the last row
                // (the "move to bottom" case) still lands; scoped to THIS level.
                onDragOver={(e: DragEvent) => {
                  if (dragLevel.current !== lvl) return
                  e.preventDefault()
                }}
                onDrop={(e: DragEvent) => {
                  if (dragLevel.current !== lvl) return
                  e.preventDefault()
                  applyDrop()
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
              >
                {spells
                  .filter((s) => s.level === lvl)
                  .map((s, j) => (
                    <Fragment key={s.id}>
                      {dropIndicator?.level === lvl && dropIndicator.index === j && <InsertionBar />}
                    <div
                      onDragOver={(e: DragEvent) => {
                        // Only react while dragging a spell locked to THIS level.
                        if (dragLevel.current !== lvl) return
                        e.preventDefault()
                        setDrop({ level: lvl, index: halfIndex(e, j) })
                      }}
                      onDrop={(e: DragEvent) => {
                        if (dragLevel.current !== lvl) return
                        e.preventDefault()
                        applyDrop()
                      }}
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        background: 'var(--color-surface)',
                        padding: 'var(--space-3)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span
                          draggable
                          onDragStart={(e: DragEvent) => startDrag(e, s.id, lvl)}
                          onDragEnd={clearDrag}
                          title="Drag to reorder within this level"
                          aria-label="Drag to reorder spell"
                          style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                        >
                          ⠿
                        </span>
                        <label
                          title="Prepared"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: s.prepared ? 'var(--color-accent)' : 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
                        >
                          <input
                            type="checkbox"
                            checked={s.prepared}
                            onChange={(e) => handleChange(s.id, { prepared: e.target.checked })}
                            aria-label="Prepared"
                          />
                          Prep
                        </label>
                        <input
                          value={s.name}
                          onChange={(e) => handleChange(s.id, { name: e.target.value })}
                          maxLength={200}
                          aria-label="Spell name"
                          placeholder="Spell name"
                          style={{
                            flex: 1,
                            font: 'inherit',
                            fontWeight: 600,
                            background: 'var(--color-bg)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius)',
                            padding: 'var(--space-1) var(--space-2)',
                            color: 'var(--color-text)',
                          }}
                        />
                        <select
                          value={s.level}
                          onChange={(e) => handleChange(s.id, { level: Number(e.target.value) })}
                          aria-label="Spell level"
                          title="Spell level"
                          style={{
                            font: 'inherit',
                            background: 'var(--color-bg)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius)',
                            padding: 'var(--space-1) var(--space-2)',
                            color: 'var(--color-text)',
                          }}
                        >
                          {SPELL_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {l === 0 ? 'Cantrip' : `Lv ${l}`}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => toggleExpanded(s.id)}
                          aria-expanded={expanded.has(s.id)}
                          aria-label={expanded.has(s.id) ? 'Collapse description' : 'Expand description'}
                          title={expanded.has(s.id) ? 'Collapse description' : 'Expand description'}
                          style={iconBtn}
                        >
                          {expanded.has(s.id) ? '▾' : '▸'}
                        </button>
                        <button onClick={() => handleDelete(s.id)} aria-label="Delete spell" title="Delete spell" style={iconBtn}>
                          ✕
                        </button>
                      </div>
                      {expanded.has(s.id) && (
                        <AutoTextarea
                          value={s.description}
                          onChange={(e) => handleChange(s.id, { description: e.target.value })}
                          aria-label="Spell description"
                          placeholder="Range, components, effect…"
                          minRows={2}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            marginTop: 'var(--space-2)',
                            font: 'inherit',
                            background: 'var(--color-bg)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius)',
                            padding: 'var(--space-2)',
                            color: 'var(--color-text)',
                          }}
                        />
                      )}
                    </div>
                    </Fragment>
                  ))}
                {/* Trailing gap: lets a spell drop at the LAST position in-level. */}
                {dropIndicator?.level === lvl &&
                  dropIndicator.index === spells.filter((s) => s.level === lvl).length && (
                    <InsertionBar />
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add controls: a default add (cantrip) plus a level picker. */}
      <div style={{ marginTop: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => handleAdd(0)} style={{ width: 'auto' }}>
          + Add spell
        </Button>
        <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          at level{' '}
          <select
            aria-label="Level for new spell"
            defaultValue={0}
            onChange={(e) => {
              const lvl = Number(e.target.value)
              e.target.value = '0' // reset the picker after adding
              void handleAdd(lvl)
            }}
            style={{
              font: 'inherit',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '2px 6px',
            }}
          >
            {SPELL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === 0 ? 'Cantrip' : `Level ${l}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

const iconBtn = {
  width: 24,
  font: 'inherit',
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 'var(--space-1)',
} as const

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

/** The thin accent line marking the active drop gap during a drag. */
function InsertionBar() {
  return (
    <div aria-hidden style={{ height: 3, background: 'var(--color-accent)', borderRadius: 2, margin: '2px 0' }} />
  )
}

/**
 * Returns a new array with the item matching `fromPred` moved to `toIndex` (an
 * insertion index in the ORIGINAL array's coordinates, 0..length). Pure. Returns
 * the SAME reference for a no-op move (item absent, or it would land in its
 * current slot), so callers can skip a redundant save via `=== group`.
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
