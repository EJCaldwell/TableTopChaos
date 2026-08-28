/**
 * HpConditionsPanel — the player's live "HP & conditions" tab. Tracks current /
 * max / temporary hit points, death-saving-throw tallies, and active conditions
 * for the player's own character, with quick damage/heal controls for use during
 * a fight. Owner-editable; the DM sees it read-only elsewhere (Party view).
 *
 * State is one `character_status` row (created lazily on first edit). Numeric
 * changes save immediately; there's no free-text here to debounce.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, FormError } from '../../components/ui'
import { useAutosave, SaveIndicator } from '../dm/autosave'
import { getMyCharacter, type Character } from '../character/api'
import { getStatus, saveStatus, type StatusPatch, type CharacterStatus } from './api'
import { useRealtimeSync } from '../realtime/useRealtimeRefresh'
import { applyHpDelta, clampDeathSaves } from './hp'

/** The standard D&D 5e conditions, offered as quick-toggle chips. */
const STANDARD_CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Stunned', 'Unconscious', 'Exhaustion',
]

/** Local mirror of the editable status fields (all default to empty/0). */
interface StatusState {
  current_hp: number | null
  max_hp: number | null
  temp_hp: number
  death_save_successes: number
  death_save_failures: number
  conditions: string[]
}

const EMPTY: StatusState = {
  current_hp: null,
  max_hp: null,
  temp_hp: 0,
  death_save_successes: 0,
  death_save_failures: 0,
  conditions: [],
}

/**
 * @param campaignId - The campaign whose character to track.
 * @param currentUserId - The signed-in player (owner of the character).
 */
export function HpConditionsPanel({ campaignId, currentUserId }: { campaignId: string; currentUserId: string }) {
  const [character, setCharacter] = useState<Character | null>(null)
  const [status, setStatus] = useState<StatusState>(EMPTY)
  const [loading, setLoading] = useState(true)
  // Amount typed into the damage/heal box.
  const [delta, setDelta] = useState('')

  const { saveState, error, setError, runSave } = useAutosave()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await getMyCharacter(campaignId, currentUserId)
      setCharacter(c)
      if (c) {
        const s = await getStatus(c.id)
        if (s) {
          setStatus({
            current_hp: s.current_hp,
            max_hp: s.max_hp,
            temp_hp: s.temp_hp,
            death_save_successes: s.death_save_successes,
            death_save_failures: s.death_save_failures,
            conditions: s.conditions,
          })
        } else {
          setStatus(EMPTY)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, currentUserId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live: if this character's status changes elsewhere (another tab), merge the
  // updated row's fields in place (no full reload).
  useRealtimeSync<CharacterStatus>(
    'character_status',
    (e) => {
      if (e.eventType === 'DELETE') {
        setStatus(EMPTY)
        return
      }
      const s = e.new
      setStatus({
        current_hp: s.current_hp,
        max_hp: s.max_hp,
        temp_hp: s.temp_hp,
        death_save_successes: s.death_save_successes,
        death_save_failures: s.death_save_failures,
        conditions: s.conditions,
      })
    },
    character ? `character_id=eq.${character.id}` : undefined,
    !!character,
  )

  /** Applies a patch locally and persists it (upsert). */
  function apply(patch: StatusPatch) {
    if (!character) return
    setStatus((prev) => ({ ...prev, ...patch }))
    void runSave(() => saveStatus(character.id, patch), 'status')
  }

  /**
   * Applies damage or healing. The arithmetic itself lives in status/hp.ts so it
   * can be unit-tested (Phase 8.1); this only supplies the current snapshot and
   * persists the result.
   */
  function applyDelta(sign: 1 | -1) {
    const patch = applyHpDelta(status, sign, Number(delta))
    if (Object.keys(patch).length === 0) return
    apply(patch)
    setDelta('')
  }

  /** Toggles a condition on/off. */
  function toggleCondition(name: string) {
    const has = status.conditions.includes(name)
    const next = has ? status.conditions.filter((c) => c !== name) : [...status.conditions, name]
    apply({ conditions: next })
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  if (!character) {
    return (
      <div style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>No character yet</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Create your character on the <strong>My character</strong> tab first, then track HP and
          conditions here.
        </p>
      </div>
    )
  }

  const numBox = {
    width: 64, font: 'inherit', fontWeight: 700, textAlign: 'center' as const,
    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)',
  }

  return (
    <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>HP &amp; conditions</h2>
        <SaveIndicator state={saveState} />
      </div>
      <FormError message={error} />

      {/* Hit points. */}
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--space-5)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Current HP
          <input type="number" aria-label="Current HP" value={status.current_hp ?? ''}
            onChange={(e) => apply({ current_hp: e.target.value === '' ? null : Math.trunc(Number(e.target.value) || 0) })}
            style={{ ...numBox, fontSize: '1.3rem' }} />
        </label>
        <span style={{ fontSize: '1.3rem', color: 'var(--color-text-muted)', paddingBottom: 6 }}>/</span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Max HP
          <input type="number" aria-label="Max HP" value={status.max_hp ?? ''}
            onChange={(e) => apply({ max_hp: e.target.value === '' ? null : Math.trunc(Number(e.target.value) || 0) })}
            style={{ ...numBox, fontSize: '1.3rem' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Temp HP
          <input type="number" aria-label="Temporary HP" value={status.temp_hp || ''}
            onChange={(e) => apply({ temp_hp: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
            placeholder="0" style={numBox} />
        </label>
      </section>

      {/* Quick damage / heal. */}
      <section style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <input type="number" aria-label="Damage or heal amount" value={delta}
          onChange={(e) => setDelta(e.target.value)} placeholder="Amount"
          style={{ width: 90, font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }} />
        <Button variant="secondary" style={{ width: 'auto', color: 'var(--color-danger)' }} onClick={() => applyDelta(-1)}>− Damage</Button>
        <Button variant="secondary" style={{ width: 'auto', color: 'var(--color-success)' }} onClick={() => applyDelta(1)}>+ Heal</Button>
      </section>

      {/* Death saves. */}
      <section>
        <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '1rem' }}>Death saves</h3>
        <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
          <DeathSaveRow label="Successes" color="var(--color-success)" value={status.death_save_successes}
            onSet={(n) => apply({ death_save_successes: clampDeathSaves(n) })} />
          <DeathSaveRow label="Failures" color="var(--color-danger)" value={status.death_save_failures}
            onSet={(n) => apply({ death_save_failures: clampDeathSaves(n) })} />
        </div>
      </section>

      {/* Conditions. */}
      <section>
        <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '1rem' }}>Conditions</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {STANDARD_CONDITIONS.map((name) => {
            const active = status.conditions.includes(name)
            return (
              <button key={name} onClick={() => toggleCondition(name)} aria-pressed={active}
                style={{
                  font: 'inherit', fontSize: '0.85rem', cursor: 'pointer',
                  borderRadius: '999px', padding: 'var(--space-1) var(--space-3)',
                  border: '1px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
                  background: active ? 'var(--color-accent)' : 'var(--color-bg)',
                  color: active ? 'var(--color-bg)' : 'var(--color-text)',
                }}>
                {name}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/**
 * DeathSaveRow — three clickable pips for a death-save track. Clicking pip N
 * sets the tally to N; clicking the current highest pip clears it back one.
 * @param label - "Successes" / "Failures".
 * @param color - Filled-pip color.
 * @param value - Current tally (0..3).
 * @param onSet - Called with the new tally.
 */
function DeathSaveRow({ label, color, value, onSet }: {
  label: string; color: string; value: number; onSet: (n: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', minWidth: 72 }}>{label}</span>
      {[1, 2, 3].map((pip) => {
        const filled = value >= pip
        return (
          <button key={pip} aria-label={`${label} ${pip}`}
            onClick={() => onSet(value === pip ? pip - 1 : pip)}
            style={{
              width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
              border: '1px solid ' + color, background: filled ? color : 'transparent',
            }} />
        )
      })}
    </div>
  )
}
