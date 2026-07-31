/**
 * CombatPanel — the DM's private "Combat" tab (Phase 3.5): a persisted
 * initiative tracker plus a client-side dice roller. Both are DM-only tools for
 * the DM's own use during a fight — not synced to players (the initiative list
 * is DM-only via RLS; the dice roller is pure client state).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, FormError } from '../../components/ui'
import {
  useAutosave,
  SaveIndicator,
  InsertionBar,
  moveToIndex,
  useDragReorder,
} from './autosave'
import {
  clearEntries,
  createEntry,
  deleteEntry,
  listEntries,
  reorderEntries,
  updateEntry,
  type InitiativeEntry,
} from './initiativeApi'
import { listNpcs, getNpcSheet, extractNpcHp, type Npc, type NpcSectionWithFields } from './npcsApi'
import { listCampaignCharacters } from '../character/api'
import { useRealtimeSync, mergeById } from '../realtime/useRealtimeRefresh'

/** @param campaignId - The campaign whose combat tools these are. */
export function CombatPanel({ campaignId }: { campaignId: string }) {
  return (
    <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <InitiativeTracker campaignId={campaignId} />
      <DiceRoller />
    </div>
  )
}

// ===========================================================================
// Initiative tracker
// ===========================================================================

/**
 * InitiativeTracker — a persisted list of combatants sorted by initiative value
 * (descending, unset last; ties broken by manual `position`). The DM can add
 * combatants (blank, from the party, or from the NPC roster), edit
 * name/initiative/notes, drag-reorder for ties, "Sort by initiative" to bake the
 * current order into `position`, and step through turns with a round counter.
 * The current-turn pointer + round are CLIENT state (not persisted) — a scratch
 * aid for the live fight.
 */
function InitiativeTracker({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<InitiativeEntry[]>([])
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [loading, setLoading] = useState(true)
  const [turnIndex, setTurnIndex] = useState(0)
  const [round, setRound] = useState(1)
  // NPC-linked rows whose stat block is expanded inline (client-only UI state).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /** Toggles the inline stat-block view for one combatant row. */
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, roster] = await Promise.all([listEntries(campaignId), listNpcs(campaignId)])
      setEntries(list)
      setNpcs(roster)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the initiative list.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live: merge initiative changes from another DM session (co-DM / other tab)
  // row-by-row, so only the changed combatant re-renders (no full reload).
  useRealtimeSync<InitiativeEntry>(
    'initiative_entries',
    (e) => setEntries((prev) => mergeById(prev, e)),
    `campaign_id=eq.${campaignId}`,
  )

  // Display order: initiative desc (nulls last), then the manual `position`.
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const ai = a.initiative,
        bi = b.initiative
      if (ai == null && bi == null) return a.position - b.position
      if (ai == null) return 1
      if (bi == null) return -1
      if (bi !== ai) return bi - ai
      return a.position - b.position
    })
  }, [entries])

  // Keep the turn pointer in range if the list shrinks.
  const safeTurn = sorted.length ? Math.min(turnIndex, sorted.length - 1) : 0

  // ---- add / seed ----
  async function addBlank() {
    await runSave(async () => {
      const e = await createEntry(campaignId, entries.length)
      setEntries((prev) => [...prev, e])
    })
  }

  /** Bulk-adds one combatant per player character (seed from the party). */
  async function addFromParty() {
    await runSave(async () => {
      const chars = await listCampaignCharacters(campaignId)
      let pos = entries.length
      const created: InitiativeEntry[] = []
      for (const c of chars) {
        created.push(await createEntry(campaignId, pos++, c.name.trim() || 'Character'))
      }
      setEntries((prev) => [...prev, ...created])
    })
  }

  /**
   * Adds a single combatant from the NPC roster (by name), links it back to the
   * NPC so its stat block can be viewed inline, and seeds the HP tracker from an
   * HP field in the NPC's stat block if one is present.
   */
  async function addNpc(npcId: string) {
    const npc = npcs.find((n) => n.id === npcId)
    if (!npc) return
    await runSave(async () => {
      const hp = await extractNpcHp(npcId)
      const e = await createEntry(campaignId, entries.length, npc.name.trim() || 'NPC', null, {
        npc_id: npcId,
        hp: hp?.hp ?? null,
        max_hp: hp?.max_hp ?? null,
      })
      setEntries((prev) => [...prev, e])
    })
  }

  // ---- edit / delete ----
  function handleChange(
    id: string,
    patch: Partial<Pick<InitiativeEntry, 'name' | 'initiative' | 'hp' | 'max_hp' | 'notes'>>,
  ) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    // Discrete numeric values (initiative + HP) save immediately; free-text
    // name/notes stay debounced so we don't hit the DB on every keystroke.
    if (patch.initiative !== undefined || patch.hp !== undefined || patch.max_hp !== undefined) {
      void runSave(() => updateEntry(id, patch), `init-${id}-num`)
    } else {
      scheduleSave(`init-${id}`, () => updateEntry(id, patch))
    }
  }

  async function handleDelete(id: string) {
    const prev = entries
    setEntries((cur) => cur.filter((e) => e.id !== id))
    await runSave(() => deleteEntry(id)).catch(() => setEntries(prev))
  }

  async function handleClear() {
    if (entries.length === 0) return
    if (!window.confirm('Clear the entire initiative list?')) return
    const prev = entries
    setEntries([])
    setTurnIndex(0)
    setRound(1)
    await runSave(() => clearEntries(campaignId)).catch(() => setEntries(prev))
  }

  /** Bakes the current initiative-sorted order into `position`. */
  async function handleSortByInitiative() {
    const orderedIds = sorted.map((e) => e.id)
    await runSave(() => reorderEntries(orderedIds), 'reorder-initiative')
    // Reflect locally so `position` matches the displayed order.
    setEntries((prev) => {
      const posById = new Map(orderedIds.map((id, i) => [id, i]))
      return prev.map((e) => ({ ...e, position: posById.get(e.id) ?? e.position }))
    })
  }

  const drag = useDragReorder((fromId, toIndex) => {
    // Drag operates on the displayed (sorted) order; persist the new positions.
    setEntries((prev) => {
      const moved = moveToIndex(sorted, (e) => e.id === fromId, toIndex)
      if (moved === sorted) return prev
      const orderedIds = moved.map((e) => e.id)
      void runSave(() => reorderEntries(orderedIds), 'reorder-initiative')
      const posById = new Map(orderedIds.map((id, i) => [id, i]))
      return prev.map((e) => ({ ...e, position: posById.get(e.id) ?? e.position }))
    })
  })

  // ---- turn stepping ----
  function nextTurn() {
    if (sorted.length === 0) return
    if (safeTurn + 1 >= sorted.length) {
      setTurnIndex(0)
      setRound((r) => r + 1)
    } else {
      setTurnIndex(safeTurn + 1)
    }
  }
  function prevTurn() {
    if (sorted.length === 0) return
    if (safeTurn - 1 < 0) {
      if (round > 1) {
        setTurnIndex(sorted.length - 1)
        setRound((r) => r - 1)
      }
    } else {
      setTurnIndex(safeTurn - 1)
    }
  }
  function resetTurns() {
    setTurnIndex(0)
    setRound(1)
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Initiative</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Add combatants, set initiative, and step through
        turns. The turn pointer and round aren't saved — they're just for the fight.
      </p>

      <FormError message={error} />

      {/* Add / seed controls. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
        <Button variant="secondary" onClick={addBlank} style={{ width: 'auto' }}>+ Add combatant</Button>
        <Button variant="secondary" onClick={addFromParty} style={{ width: 'auto' }}>+ Add party</Button>
        {npcs.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value
              e.target.value = ''
              void addNpc(id)
            }}
            aria-label="Add an NPC to initiative"
            style={{ font: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '2px 8px' }}
          >
            <option value="" disabled>+ Add NPC…</option>
            {npcs.map((n) => (
              <option key={n.id} value={n.id}>{n.name.trim() || 'Unnamed NPC'}</option>
            ))}
          </select>
        )}
        {entries.length > 0 && (
          <>
            <Button variant="secondary" onClick={handleSortByInitiative} style={{ width: 'auto' }}>Sort by initiative</Button>
            <button onClick={handleClear} style={{ marginLeft: 'auto', font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-danger)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer' }}>Clear</button>
          </>
        )}
      </div>

      {/* Turn stepper. */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600 }}>Round {round}</span>
          <Button variant="secondary" onClick={prevTurn} style={{ width: 'auto' }}>‹ Prev</Button>
          <Button onClick={nextTurn} style={{ width: 'auto' }}>Next turn ›</Button>
          <Button variant="secondary" onClick={resetTurns} style={{ width: 'auto' }}>Reset</Button>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No combatants yet. Add some above (or seed from the party / an NPC).
        </p>
      ) : (
        <div {...drag.containerProps} style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {sorted.map((e, i) => {
            const isCurrent = i === safeTurn
            return (
              <Fragment key={e.id}>
                {drag.indicator?.index === i && <InsertionBar />}
                <div
                  {...drag.rowProps(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    border: '1px solid',
                    borderColor: isCurrent ? 'var(--color-accent)' : 'var(--color-border)',
                    background: isCurrent ? 'var(--color-surface)' : 'var(--color-bg)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-2)',
                  }}
                >
                  <span {...drag.handleProps(e.id)} title="Drag to reorder (ties)" aria-label="Drag to reorder" style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}>⠿</span>
                  {/* Current-turn marker. */}
                  <span aria-hidden style={{ width: 16, color: 'var(--color-accent)' }}>{isCurrent ? '▶' : ''}</span>
                  <input
                    type="number"
                    value={e.initiative ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value
                      handleChange(e.id, { initiative: v === '' ? null : Math.trunc(Number(v) || 0) })
                    }}
                    aria-label="Initiative value"
                    placeholder="—"
                    title="Initiative"
                    style={{ width: 56, font: 'inherit', fontWeight: 600, textAlign: 'center', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1)', color: 'var(--color-text)' }}
                  />
                  <input
                    value={e.name}
                    onChange={(ev) => handleChange(e.id, { name: ev.target.value })}
                    maxLength={200}
                    aria-label="Combatant name"
                    placeholder="Combatant name"
                    style={{ flex: '1 1 30%', minWidth: 110, font: 'inherit', fontWeight: 600, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                  />
                  {/* HP tracker: current / max. Numbers save immediately. */}
                  <span title="Hit points (current / max)" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <input
                      type="number"
                      value={e.hp ?? ''}
                      onChange={(ev) => {
                        const v = ev.target.value
                        handleChange(e.id, { hp: v === '' ? null : Math.trunc(Number(v) || 0) })
                      }}
                      aria-label="Current HP"
                      placeholder="HP"
                      style={{ width: 48, font: 'inherit', textAlign: 'center', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1)', color: 'var(--color-text)' }}
                    />
                    <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>/</span>
                    <input
                      type="number"
                      value={e.max_hp ?? ''}
                      onChange={(ev) => {
                        const v = ev.target.value
                        handleChange(e.id, { max_hp: v === '' ? null : Math.trunc(Number(v) || 0) })
                      }}
                      aria-label="Maximum HP"
                      placeholder="max"
                      style={{ width: 48, font: 'inherit', textAlign: 'center', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1)', color: 'var(--color-text-muted)' }}
                    />
                  </span>
                  <input
                    value={e.notes}
                    onChange={(ev) => handleChange(e.id, { notes: ev.target.value })}
                    aria-label="Notes"
                    placeholder="Conditions…"
                    style={{ flex: '1 1 20%', minWidth: 90, font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                  />
                  {/* Stat-block expander — only for combatants linked to an NPC. */}
                  {e.npc_id && (
                    <button
                      onClick={() => toggleExpanded(e.id)}
                      aria-label={expanded.has(e.id) ? 'Hide stats' : 'Show stats'}
                      aria-expanded={expanded.has(e.id)}
                      title="View NPC stat block"
                      style={{ font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {expanded.has(e.id) ? '▾ Stats' : '▸ Stats'}
                    </button>
                  )}
                  <button onClick={() => handleDelete(e.id)} aria-label="Remove combatant" title="Remove" style={{ font: 'inherit', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 'var(--space-1)' }}>✕</button>
                </div>
                {/* Inline read-only stat block for an expanded NPC row. */}
                {e.npc_id && expanded.has(e.id) && (
                  <NpcStatView npcId={e.npc_id} description={npcs.find((n) => n.id === e.npc_id)?.description ?? ''} />
                )}
              </Fragment>
            )
          })}
          {drag.indicator?.index === sorted.length && <InsertionBar />}
        </div>
      )}
    </section>
  )
}

/**
 * NpcStatView — a lazily-loaded, READ-ONLY render of a linked NPC's full stat
 * block (sections + label/value fields), shown inline under a combat row when
 * the DM expands it. Loads on mount via getNpcSheet; the tracker never mutates
 * the NPC here (edits happen on the NPCs tab). Indented + accent-bordered so it
 * reads as a detail panel belonging to the row above.
 *
 * Shows the NPC's free-text description first (attack write-ups often live
 * there) then every stat section/field — so the DM sees the NPC's attacks and
 * abilities without leaving the Combat tab.
 * @param npcId - The roster NPC whose stat block to display.
 * @param description - The NPC's description text (passed from the loaded
 *   roster so we don't re-fetch the row); empty string if none.
 */
function NpcStatView({ npcId, description }: { npcId: string; description: string }) {
  const [sheet, setSheet] = useState<NpcSectionWithFields[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSheet(null)
    setError(null)
    getNpcSheet(npcId)
      .then((s) => alive && setSheet(s))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Failed to load stats.'))
    return () => {
      alive = false
    }
  }, [npcId])

  return (
    <div
      style={{
        margin: '0 0 var(--space-1) var(--space-6)',
        padding: 'var(--space-3)',
        borderLeft: '2px solid var(--color-accent)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius)',
      }}
    >
      {/* Description first — attack write-ups and tactics often live here. */}
      {description.trim() && (
        <p style={{ margin: '0 0 var(--space-3)', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{description}</p>
      )}
      {error ? (
        <FormError message={error} />
      ) : sheet === null ? (
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Loading stats…</p>
      ) : sheet.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          {description.trim() ? 'No stat block sections yet.' : 'This NPC has no stat block yet.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {sheet.map((section) => (
            <div key={section.id}>
              <h4 style={{ margin: '0 0 var(--space-1)', fontSize: '0.95rem' }}>
                {section.title.trim() || 'Section'}
              </h4>
              {section.fields.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</p>
              ) : (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px var(--space-3)' }}>
                  {section.fields.map((f) => (
                    <Fragment key={f.id}>
                      <dt style={{ fontWeight: 600, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        {f.label.trim() || '—'}
                      </dt>
                      <dd style={{ margin: 0, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{f.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Dice roller (client-side)
// ===========================================================================

/** One die term's rolls (for the breakdown display). */
interface RollResult {
  /** The notation that was rolled (e.g. "2d6+3"). */
  notation: string
  /** The final total. */
  total: number
  /** Human-readable breakdown, e.g. "2d6 [4, 2] + 3 = 9". */
  detail: string
}

/** Sane caps so a typo like "999d999" can't lock the tab. */
const MAX_DICE = 100
const MAX_SIDES = 1000

/**
 * Parses and rolls standard dice notation like `2d6+3`, `d20`, `1d8+1d4+2`
 * (whitespace ignored, case-insensitive). Returns the total and a breakdown, or
 * an Error message string if the notation is invalid / out of bounds.
 *
 * Uses Math.random (fine in the browser); each die is a fresh uniform roll.
 * @param input - The raw notation string.
 */
function rollNotation(input: string): RollResult | string {
  const expr = input.replace(/\s+/g, '').toLowerCase()
  if (!expr) return 'Enter dice notation, e.g. 2d6+3.'
  // Whole-string shape: a term, then any number of +/- terms.
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(expr)) {
    return `"${input}" isn't valid notation. Try e.g. 2d6+3.`
  }
  // Split into signed terms (each token keeps its leading sign).
  const tokens = expr.match(/[+-]?[^+-]+/g) ?? []
  let total = 0
  const parts: string[] = []
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1
    const body = token.replace(/^[+-]/, '')
    if (body.includes('d')) {
      const [countStr, sidesStr] = body.split('d')
      const count = countStr === '' ? 1 : parseInt(countStr, 10)
      const sides = parseInt(sidesStr, 10)
      if (count > MAX_DICE || sides > MAX_SIDES || sides < 1) {
        return `Out of range (max ${MAX_DICE} dice, d${MAX_SIDES}).`
      }
      const rolls: number[] = []
      for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides))
      const sum = rolls.reduce((a, b) => a + b, 0)
      total += sign * sum
      parts.push(`${sign < 0 ? '- ' : parts.length ? '+ ' : ''}${count}d${sides} [${rolls.join(', ')}]`)
    } else {
      const n = parseInt(body, 10)
      total += sign * n
      parts.push(`${sign < 0 ? '- ' : parts.length ? '+ ' : ''}${n}`)
    }
  }
  return { notation: input.trim(), total, detail: `${parts.join(' ')} = ${total}` }
}

/** Common single-die quick-roll buttons. */
const QUICK_DICE = ['d20', 'd12', 'd10', 'd8', 'd6', 'd4', 'd100']

/**
 * DiceRoller — a client-side dice roller (no persistence). Type standard
 * notation or tap a quick-die button; results accumulate in an in-session
 * history (newest first, capped). Nothing here touches the DB or players.
 */
function DiceRoller() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<RollResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  /** Rolls `notation` (or the input box), pushing the result onto history. */
  function roll(notation?: string) {
    const result = rollNotation(notation ?? input)
    if (typeof result === 'string') {
      setError(result)
      return
    }
    setError(null)
    setHistory((prev) => [result, ...prev].slice(0, 20))
  }

  return (
    <section>
      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Dice roller</h2>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Standard notation (e.g. <code>2d6+3</code>). Rolls are just for you — not
        shared or saved.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          roll()
        }}
        style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Dice notation"
          placeholder="2d6+3"
          style={{ flex: '1 1 200px', font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
        />
        <Button type="submit" style={{ width: 'auto' }}>Roll</Button>
      </form>

      {/* Quick single-die buttons. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
        {QUICK_DICE.map((d) => (
          <button
            key={d}
            onClick={() => roll(d)}
            style={{ font: 'inherit', fontSize: '0.85rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer' }}
          >
            {d}
          </button>
        ))}
      </div>

      <FormError message={error} />

      {/* Latest result + history. */}
      {history.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius)', background: 'var(--color-surface)' }}>
            <span style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>{history[0].total}</span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{history[0].notation} → {history[0].detail}</span>
          </div>
          {history.length > 1 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-3) 0 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {history.slice(1).map((r, i) => (
                <li key={i} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{r.total}</strong> — {r.notation} ({r.detail})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
