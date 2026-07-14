/**
 * LorePanel — the player's "Backstory" workspace body (Phase 2.3.2).
 *
 * Owns the character's long-form lore: three prose fields (backstory, appearance,
 * personality) edited with a lightweight, XSS-safe markdown subset (see
 * safeMarkdown.ts), each with an Edit/Preview toggle. Uses the same autosave
 * model as the sheet/inventory (optimistic, debounced per field, save indicator,
 * offline-retry queue).
 *
 * The portrait lives on the "My character" tab (built in 2.1, stored as
 * characters.portrait_asset_id via the 1.6 media pipeline); this tab focuses on
 * the narrative fields. Lore hangs off the character, so with none it points the
 * player to create one first. RLS (migration 0010, unchanged for 2.3) is the real
 * guard: owner read/write, campaign DM read-only, other players none.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormError } from '../../components/ui'
import { getMyCharacter, updateCharacter, type Character } from '../character/api'
import { renderSafeMarkdown } from './safeMarkdown'

/** Autosave debounce window. */
const SAVE_DEBOUNCE_MS = 600

/** The transient save indicator's state. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** The three editable lore columns on a character. */
type LoreField = 'backstory' | 'appearance' | 'personality'

/** Field definitions: which column, its heading, and a helper placeholder. */
const LORE_FIELDS: { key: LoreField; label: string; placeholder: string }[] = [
  {
    key: 'backstory',
    label: 'Backstory',
    placeholder: "Where does your character come from? What drives them?",
  },
  {
    key: 'appearance',
    label: 'Appearance',
    placeholder: 'What does your character look like?',
  },
  {
    key: 'personality',
    label: 'Personality',
    placeholder: 'Traits, ideals, bonds, and flaws.',
  },
]

/**
 * @param campaignId - The campaign whose lore workspace this is.
 * @param currentUserId - The signed-in player's id (owner of the character).
 */
export function LorePanel({
  campaignId,
  currentUserId,
}: {
  campaignId: string
  currentUserId: string
}) {
  const [character, setCharacter] = useState<Character | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Fields currently in Preview mode (rendered) rather than Edit (textarea).
  const [previewing, setPreviewing] = useState<Set<LoreField>>(new Set())

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inFlight = useRef(0)
  const pending = useRef<Map<string, () => Promise<unknown>>>(new Map())

  /** Runs a persistence fn tracked by the indicator + offline-retry queue. */
  const runSave = useCallback(async (fn: () => Promise<unknown>, key: string) => {
    inFlight.current += 1
    setSaveState('saving')
    try {
      await fn()
      pending.current.delete(key)
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
      pending.current.set(key, fn)
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

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // Flush failed saves when connectivity returns.
  useEffect(() => {
    function flush() {
      if (pending.current.size === 0) return
      for (const [key, fn] of Array.from(pending.current.entries())) void runSave(fn, key)
    }
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [runSave])

  /** Loads the player's character (whose lore columns we edit). */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await getMyCharacter(campaignId, currentUserId)
      setCharacter(c)
      // Start each field that already has saved content in Preview mode, so a
      // returning player sees their rendered lore rather than the raw markdown
      // textarea. Empty fields open in Edit so there's an obvious place to type.
      if (c) {
        setPreviewing(
          new Set(LORE_FIELDS.filter(({ key }) => c[key]?.trim()).map(({ key }) => key)),
        )
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

  /** Optimistically edits a lore field and debounces its save. */
  function handleChange(key: LoreField, value: string) {
    setCharacter((prev) => (prev ? { ...prev, [key]: value } : prev))
    const id = character?.id
    if (!id) return
    scheduleSave(`lore-${key}`, () => updateCharacter(id, { [key]: value }))
  }

  /** Toggles a field between Edit (textarea) and Preview (rendered) mode. */
  function togglePreview(key: LoreField) {
    setPreviewing((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
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
          Create your character on the <strong>My character</strong> tab first — its backstory
          lives here.
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Backstory &amp; lore</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Formatting: <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>; blank line
        for a new paragraph. Use <strong>Preview</strong> to see it rendered.
      </p>

      <FormError message={error} />

      <div style={{ marginTop: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {LORE_FIELDS.map(({ key, label, placeholder }) => {
          const isPreview = previewing.has(key)
          const value = character[key]
          return (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{label}</h3>
                <button
                  onClick={() => togglePreview(key)}
                  aria-pressed={isPreview}
                  style={{
                    marginLeft: 'auto',
                    font: 'inherit',
                    fontSize: '0.8rem',
                    background: 'none',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: '2px 10px',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {isPreview ? 'Edit' : 'Preview'}
                </button>
              </div>

              {isPreview ? (
                <div
                  // Safe: renderSafeMarkdown HTML-escapes all author text before
                  // inserting only its own fixed tags (see safeMarkdown.ts).
                  dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(value) || '<p style="color:var(--color-text-muted)">Nothing yet.</p>' }}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--color-surface)',
                    padding: 'var(--space-3) var(--space-4)',
                    minHeight: 80,
                    lineHeight: 1.5,
                  }}
                />
              ) : (
                <textarea
                  value={value}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  rows={key === 'backstory' ? 10 : 5}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    font: 'inherit',
                    lineHeight: 1.5,
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-3)',
                    color: 'var(--color-text)',
                  }}
                />
              )}
            </div>
          )
        })}
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
