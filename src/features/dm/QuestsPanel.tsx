/**
 * QuestsPanel — the DM's "Quests" tab (Phase 3.3): a quest / plot tracker shown
 * as a board grouped by status (Active / Completed). Each quest has a title, a
 * status (which column it's in), a description, and private plot notes. Create,
 * edit, drag-reorder within a status group, change status to move between
 * groups, and delete — all autosaved.
 *
 * DM-only: rendered under the DM-only "Quests" tab and gated by RLS (migration
 * 0021 — campaign DM only, every operation). Reuses the shared DM autosave engine
 * + drag hook (dm/autosave.tsx).
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { useAutosave, SaveIndicator, InsertionBar, moveToIndex, useDragReorder } from './autosave'
import {
  QUEST_STATUSES,
  createQuest,
  deleteQuest,
  listQuests,
  reorderQuests,
  updateQuest,
  type Quest,
  type QuestStatus,
} from './questsApi'

/** @param campaignId - The campaign whose quests this is. */
export function QuestsPanel({ campaignId }: { campaignId: string }) {
  const [quests, setQuests] = useState<Quest[]>([])
  const [loading, setLoading] = useState(true)
  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setQuests(await listQuests(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quests.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Adds a quest at the top (highest position), in the Active column. */
  async function handleAdd() {
    const position = quests.reduce((max, q) => Math.max(max, q.position), 0) + 1
    await runSave(async () => {
      const q = await createQuest(campaignId, position)
      setQuests((prev) => [q, ...prev])
    })
  }

  /** Optimistically edits a quest; status is a discrete change (save now). */
  function handleChange(id: string, patch: Partial<Pick<Quest, 'title' | 'status' | 'description' | 'plot_notes'>>) {
    setQuests((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
    if (patch.status !== undefined) {
      void runSave(() => updateQuest(id, patch), `quest-${id}-status`)
    } else {
      scheduleSave(`quest-${id}`, () => updateQuest(id, patch))
    }
  }

  async function handleDelete(id: string) {
    const q = quests.find((x) => x.id === id)
    if (!q) return
    const hasContent = q.title.trim() !== '' || q.description.trim() !== '' || q.plot_notes.trim() !== ''
    if (hasContent && !window.confirm(`Delete "${q.title.trim() || 'this quest'}"? This cannot be undone.`)) return
    const prev = quests
    setQuests((cur) => cur.filter((x) => x.id !== id))
    await runSave(() => deleteQuest(id)).catch(() => setQuests(prev))
  }

  /** Reorders within one status group and persists the group's new order. */
  function reorderWithinStatus(status: QuestStatus, fromId: string, toIndex: number) {
    setQuests((prev) => {
      const group = prev.filter((q) => q.status === status)
      const moved = moveToIndex(group, (q) => q.id === fromId, toIndex)
      if (moved === group) return prev
      void runSave(() => reorderQuests(moved.map((q) => q.id)), `reorder-quests-${status}`)
      // Rebuild the flat list: keep other-status quests as-is, splice the moved
      // group back in its members' original slots order-agnostically. Since the
      // UI groups by status, only within-group order matters — reflect it by
      // reassigning positions and re-sorting like listQuests (position desc).
      const posById = new Map(moved.map((q, i) => [q.id, moved.length - 1 - i]))
      return prev
        .map((q) => (posById.has(q.id) ? { ...q, position: posById.get(q.id)! } : q))
        .slice()
        .sort((a, b) => b.position - a.position)
    })
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Quests</h2>
        <SaveIndicator state={saveState} />
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto', marginLeft: 'auto' }}>
          + New quest
        </Button>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Track quests and plot threads; move a quest to
        <strong> Completed</strong> when it's done.
      </p>

      <FormError message={error} />

      {quests.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No quests yet. Add your first above.
        </p>
      ) : (
        <div style={{ marginTop: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {QUEST_STATUSES.map(({ value, label }) => {
            const group = quests.filter((q) => q.status === value)
            return (
              <QuestGroup
                key={value}
                status={value}
                label={label}
                quests={group}
                onChange={handleChange}
                onDelete={handleDelete}
                onReorder={reorderWithinStatus}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * QuestGroup — one status column (e.g. "Active") with its quests and its own
 * drag-reorder context (each group reorders independently).
 */
function QuestGroup({
  status,
  label,
  quests,
  onChange,
  onDelete,
  onReorder,
}: {
  status: QuestStatus
  label: string
  quests: Quest[]
  onChange: (id: string, patch: Partial<Pick<Quest, 'title' | 'status' | 'description' | 'plot_notes'>>) => void
  onDelete: (id: string) => void
  onReorder: (status: QuestStatus, fromId: string, toIndex: number) => void
}) {
  const drag = useDragReorder((fromId, toIndex) => onReorder(status, fromId, toIndex))
  return (
    <div>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
        {label} ({quests.length})
      </h3>
      {quests.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>None.</p>
      ) : (
        <div {...drag.containerProps} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {quests.map((q, i) => (
            <Fragment key={q.id}>
              {drag.indicator?.index === i && <InsertionBar />}
              <div {...drag.rowProps(i)} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span {...drag.handleProps(q.id)} title="Drag to reorder" aria-label="Drag to reorder quest" style={{ cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' }}>⠿</span>
                  <input
                    value={q.title}
                    onChange={(e) => onChange(q.id, { title: e.target.value })}
                    maxLength={200}
                    aria-label="Quest title"
                    placeholder="Quest title"
                    style={{ flex: 1, font: 'inherit', fontWeight: 600, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                  />
                  <select
                    value={q.status}
                    onChange={(e) => onChange(q.id, { status: e.target.value as QuestStatus })}
                    aria-label="Quest status"
                    title="Status"
                    style={{ font: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)' }}
                  >
                    {QUEST_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <button onClick={() => onDelete(q.id)} aria-label="Delete quest" title="Delete quest" style={{ font: 'inherit', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 'var(--space-1)' }}>✕</button>
                </div>
                <label style={{ display: 'block', marginTop: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Description</label>
                <AutoTextarea
                  value={q.description}
                  onChange={(e) => onChange(q.id, { description: e.target.value })}
                  aria-label="Quest description"
                  placeholder="What the party knows / the quest's goal…"
                  minRows={2}
                  style={box}
                />
                <label style={{ display: 'block', marginTop: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--color-accent)' }}>🔒 Plot notes (DM only)</label>
                <AutoTextarea
                  value={q.plot_notes}
                  onChange={(e) => onChange(q.id, { plot_notes: e.target.value })}
                  aria-label="Plot notes"
                  placeholder="Twists, secrets, the real story behind it…"
                  minRows={2}
                  style={{ ...box, border: '1px dashed var(--color-accent)' }}
                />
              </div>
            </Fragment>
          ))}
          {drag.indicator?.index === quests.length && <InsertionBar />}
        </div>
      )}
    </div>
  )
}

const box = { width: '100%', boxSizing: 'border-box' as const, font: 'inherit', lineHeight: 1.5, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }
