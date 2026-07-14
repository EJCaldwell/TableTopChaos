/**
 * AbilitiesPanel — the player's "Abilities & Feats" tab (Phase 2.4 redesign).
 *
 * A flat, manually-ordered list of a character's class/racial features and feats.
 * Each entry has a name, an optional `uses` count (e.g. 1/rest — blank = at-will),
 * and an expandable description. Same autosave model as the other panels
 * (optimistic, debounced per item, save indicator, offline retry) and native
 * drag-to-reorder with an insertion line. Hangs off the character; with none it
 * points to "My character". RLS (0016): owner read/write, DM read-only, others none.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { getMyCharacter, type Character } from '../character/api'
import {
  createAbility,
  deleteAbility,
  listAbilities,
  reorderAbilities,
  updateAbility,
  type Ability,
} from './api'

const SAVE_DEBOUNCE_MS = 600
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type DropIndicator = { index: number } | null

export function AbilitiesPanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  const [character, setCharacter] = useState<Character | null>(null)
  const [abilities, setAbilities] = useState<Ability[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())
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
      setAbilities(c ? await listAbilities(c.id) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your abilities.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleAdd() {
    if (!character) return
    const position = abilities.length
    await runSave(async () => {
      const a = await createAbility(character.id, '', position)
      setAbilities((prev) => [...prev, a])
    })
  }

  function handleChange(id: string, patch: Partial<Pick<Ability, 'name' | 'description' | 'uses'>>) {
    setAbilities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    scheduleSave(`ability-${id}`, () => {
      const clean = { ...patch }
      if (clean.name !== undefined) clean.name = clean.name.trim()
      return updateAbility(id, clean)
    })
  }

  async function handleDelete(id: string) {
    const a = abilities.find((x) => x.id === id)
    if (!a) return
    const hasContent = a.name.trim() !== '' || a.description.trim() !== '' || a.uses != null
    if (hasContent && !window.confirm(`Delete "${a.name.trim() || 'this ability'}"? This cannot be undone.`)) {
      return
    }
    const prev = abilities
    setAbilities((cur) => cur.filter((x) => x.id !== id))
    await runSave(() => deleteAbility(id)).catch(() => setAbilities(prev))
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- drag-to-reorder ----
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
  function applyDrop() {
    const fromId = dragId.current
    const target = dropTarget.current
    clearDrag()
    if (!fromId || !target) return
    setAbilities((prev) => {
      const next = moveToIndex(prev, (a) => a.id === fromId, target.index)
      if (next === prev) return prev
      void runSave(() => reorderAbilities(next.map((a) => a.id)), 'reorder-abilities')
      return next
    })
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }
  if (!character) {
    return <NoCharacter />
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Abilities &amp; Feats</h2>
        <SaveIndicator state={saveState} />
      </div>
      <FormError message={error} />

      {abilities.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No abilities or feats yet. Add your first below.
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
          style={{ marginTop: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
        >
          {abilities.map((a, i) => (
            <Fragment key={a.id}>
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
                  padding: 'var(--space-3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    draggable
                    onDragStart={(e: DragEvent) => startDrag(e, a.id)}
                    onDragEnd={clearDrag}
                    title="Drag to reorder"
                    aria-label="Drag to reorder ability"
                    style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}
                  >
                    ⠿
                  </span>
                  <input
                    value={a.name}
                    onChange={(e) => handleChange(a.id, { name: e.target.value })}
                    maxLength={200}
                    aria-label="Ability name"
                    placeholder="Ability or feat name"
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
                  <input
                    type="number"
                    min={0}
                    value={a.uses ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      handleChange(a.id, {
                        uses: v === '' ? null : Math.max(0, Math.floor(Number(v) || 0)),
                      })
                    }}
                    aria-label="Uses (optional)"
                    placeholder="Uses"
                    title="Optional uses — leave blank for at-will"
                    style={{
                      width: 72,
                      font: 'inherit',
                      textAlign: 'center',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-1) var(--space-2)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <button
                    onClick={() => toggleExpanded(a.id)}
                    aria-expanded={expanded.has(a.id)}
                    aria-label={expanded.has(a.id) ? 'Collapse description' : 'Expand description'}
                    title={expanded.has(a.id) ? 'Collapse description' : 'Expand description'}
                    style={iconBtn}
                  >
                    {expanded.has(a.id) ? '▾' : '▸'}
                  </button>
                  <button onClick={() => handleDelete(a.id)} aria-label="Delete ability" title="Delete ability" style={iconBtn}>
                    ✕
                  </button>
                </div>
                {expanded.has(a.id) && (
                  <AutoTextarea
                    value={a.description}
                    onChange={(e) => handleChange(a.id, { description: e.target.value })}
                    aria-label="Ability description"
                    placeholder="Description / effect"
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
          {dropIndicator?.index === abilities.length && <InsertionBar />}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto' }}>
          + Add ability / feat
        </Button>
      </div>
    </div>
  )
}

/** Small icon-button style shared by the expand/delete controls. */
const iconBtn = {
  width: 24,
  font: 'inherit',
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 'var(--space-1)',
} as const

/** Shared "no character yet" empty state. */
function NoCharacter() {
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

function InsertionBar() {
  return (
    <div aria-hidden style={{ height: 3, background: 'var(--color-accent)', borderRadius: 2, margin: '2px 0' }} />
  )
}

function moveToIndex<T>(arr: T[], fromPred: (x: T) => boolean, toIndex: number): T[] {
  const fromIdx = arr.findIndex(fromPred)
  if (fromIdx < 0) return arr
  if (toIndex === fromIdx || toIndex === fromIdx + 1) return arr
  const item = arr[fromIdx]
  const without = arr.filter((_, i) => i !== fromIdx)
  const adj = toIndex > fromIdx ? toIndex - 1 : toIndex
  return [...without.slice(0, adj), item, ...without.slice(adj)]
}
