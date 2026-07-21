/**
 * NpcsPanel — the DM's "NPCs" tab (Phase 3.2 / 3.3): a campaign-wide roster of
 * NPCs, each with an optional portrait, a description, and a CONFIGURABLE stat
 * block modelled on the player character sheet (add-your-own sections, each with
 * ordered label/value fields; everything drag-reorderable and autosaved).
 *
 * DM-only: rendered under the DM-only "NPCs" tab and gated by RLS (migration
 * 0020 — campaign DM only, every operation). Reuses the shared DM autosave
 * engine + drag hook (dm/autosave.tsx) and the 1.6 media pipeline for portraits.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { ImageUpload } from '../media/ImageUpload'
import { resolvePortraitUrl } from '../party/api'
import {
  useAutosave,
  SaveIndicator,
  InsertionBar,
  moveToIndex,
  useDragReorder,
} from './autosave'
import {
  createNpc,
  createStatField,
  createStatSection,
  deleteNpc,
  duplicateNpc,
  deleteStatField,
  deleteStatSection,
  getNpcSheet,
  listNpcs,
  reorderNpcs,
  reorderStatFields,
  reorderStatSections,
  updateNpc,
  updateStatField,
  updateStatSection,
  type Npc,
  type NpcSectionWithFields,
  type NpcStatField,
} from './npcsApi'

/**
 * @param campaignId - The campaign whose NPC roster this is.
 */
export function NpcsPanel({ campaignId }: { campaignId: string }) {
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sections, setSections] = useState<NpcSectionWithFields[]>([])
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetLoading, setSheetLoading] = useState(false)

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  const selected = npcs.find((n) => n.id === selectedId) ?? null

  /** Loads the roster; keeps the current selection if still present. */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listNpcs(campaignId)
      setNpcs(list)
      setSelectedId((cur) => (cur && list.some((n) => n.id === cur) ? cur : list[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load NPCs.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Loads the selected NPC's stat block + portrait whenever the selection changes. */
  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setSections([])
      setPortraitUrl(null)
      return
    }
    setSheetLoading(true)
    ;(async () => {
      try {
        const [sheet, url] = await Promise.all([
          getNpcSheet(selected.id),
          selected.portrait_asset_id ? resolvePortraitUrl(selected.portrait_asset_id) : Promise.resolve(null),
        ])
        if (!cancelled) {
          setSections(sheet)
          setPortraitUrl(url)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the NPC.')
      } finally {
        if (!cancelled) setSheetLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // selected.portrait_asset_id so an uploaded portrait re-resolves.
  }, [selected, setError])

  // ---- roster actions ----

  async function handleAdd() {
    const position = npcs.reduce((max, n) => Math.max(max, n.position), 0) + 1
    await runSave(async () => {
      const n = await createNpc(campaignId, position)
      setNpcs((prev) => [n, ...prev])
      setSelectedId(n.id)
    })
  }

  function handleNpcChange(id: string, patch: Partial<Pick<Npc, 'name' | 'description'>>) {
    setNpcs((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
    scheduleSave(`npc-${id}`, () => updateNpc(id, patch))
  }

  /** Deep-copies an NPC (incl. its stat block) into a new one at the top. */
  async function handleDuplicate(id: string) {
    const source = npcs.find((n) => n.id === id)
    if (!source) return
    const position = npcs.reduce((max, n) => Math.max(max, n.position), 0) + 1
    await runSave(async () => {
      const copy = await duplicateNpc(source, position)
      setNpcs((prev) => [copy, ...prev])
      setSelectedId(copy.id)
    })
  }

  async function handleDeleteNpc(id: string) {
    const n = npcs.find((x) => x.id === id)
    if (!n) return
    if (
      (n.name.trim() !== '' || n.description.trim() !== '') &&
      !window.confirm(`Delete "${n.name.trim() || 'this NPC'}" and its stat block? This cannot be undone.`)
    ) {
      return
    }
    const prev = npcs
    setNpcs((cur) => cur.filter((x) => x.id !== id))
    if (selectedId === id) setSelectedId(null)
    await runSave(() => deleteNpc(id)).catch(() => setNpcs(prev))
  }

  const rosterDrag = useDragReorder((fromId, toIndex) => {
    setNpcs((prev) => {
      const next = moveToIndex(prev, (n) => n.id === fromId, toIndex)
      if (next === prev) return prev
      void runSave(() => reorderNpcs(next.map((n) => n.id)), 'reorder-npcs')
      return next
    })
  })

  // ---- stat-block actions (operate on the selected NPC) ----

  async function handleAddSection() {
    if (!selected) return
    const position = sections.length
    await runSave(async () => {
      // Start blank so the title input shows its ghost placeholder until the DM
      // types one (rather than a literal "New section" they'd have to clear).
      const s = await createStatSection(selected.id, '', position)
      setSections((prev) => [...prev, { ...s, fields: [] }])
    })
  }

  function handleSectionTitle(sectionId: string, title: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title } : s)))
    // Allow an empty title (the input shows its placeholder) — don't force
    // "Untitled" so the ghost text stays until the DM actually names it.
    scheduleSave(`npc-section-${sectionId}`, () => updateStatSection(sectionId, { title: title.trim() }))
  }

  async function handleDeleteSection(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return
    if (
      section.fields.length > 0 &&
      !window.confirm(`Delete the "${section.title || 'Untitled'}" section and its ${section.fields.length} field(s)?`)
    ) {
      return
    }
    const prev = sections
    setSections((cur) => cur.filter((s) => s.id !== sectionId))
    await runSave(() => deleteStatSection(sectionId)).catch(() => setSections(prev))
  }

  function reorderSectionsLocal(fromId: string, toIndex: number) {
    setSections((prev) => {
      const next = moveToIndex(prev, (s) => s.id === fromId, toIndex)
      if (next === prev) return prev
      void runSave(() => reorderStatSections(next.map((s) => s.id)), 'reorder-npc-sections')
      return next
    })
  }

  async function handleAddField(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return
    const position = section.fields.length
    await runSave(async () => {
      const f = await createStatField(sectionId, '', '', position)
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, fields: [...s.fields, f] } : s)))
    })
  }

  function handleFieldChange(
    sectionId: string,
    fieldId: string,
    patch: Partial<Pick<NpcStatField, 'label' | 'value'>>,
  ) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) } : s,
      ),
    )
    scheduleSave(`npc-field-${fieldId}`, () => {
      const clean: Partial<Pick<NpcStatField, 'label' | 'value'>> = { ...patch }
      if (clean.label !== undefined) clean.label = clean.label.trim()
      return updateStatField(fieldId, clean)
    })
  }

  async function handleDeleteField(sectionId: string, fieldId: string) {
    const field = sections.find((s) => s.id === sectionId)?.fields.find((f) => f.id === fieldId)
    if (!field) return
    const hasContent = field.label.trim() !== '' || field.value.trim() !== ''
    if (hasContent && !window.confirm('Delete this field?')) return
    const prev = sections
    setSections((cur) =>
      cur.map((s) => (s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s)),
    )
    await runSave(() => deleteStatField(fieldId)).catch(() => setSections(prev))
  }

  function reorderFieldsLocal(sectionId: string, fromId: string, toIndex: number) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const fields = moveToIndex(s.fields, (f) => f.id === fromId, toIndex)
        if (fields === s.fields) return s
        void runSave(() => reorderStatFields(fields.map((f) => f.id)), `reorder-npc-fields-${sectionId}`)
        return { ...s, fields }
      }),
    )
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>NPCs</h2>
        <SaveIndicator state={saveState} />
        {selected && (
          <Button
            variant="secondary"
            onClick={() => handleDuplicate(selected.id)}
            style={{ width: 'auto', marginLeft: 'auto' }}
          >
            ⧉ Duplicate NPC
          </Button>
        )}
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto', marginLeft: selected ? undefined : 'auto' }}>
          + New NPC
        </Button>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Each NPC has a configurable stat block — add your
        own sections and fields.
      </p>

      <FormError message={error} />

      {npcs.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No NPCs yet. Add your first above.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Roster (master). */}
          <div {...rosterDrag.containerProps} style={{ flex: '1 1 200px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {npcs.map((n, i) => (
              <Fragment key={n.id}>
                {rosterDrag.indicator?.index === i && <InsertionBar />}
                <div
                  {...rosterDrag.rowProps(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    border: '1px solid',
                    borderColor: n.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)',
                    background: n.id === selectedId ? 'var(--color-surface)' : 'var(--color-bg)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-2) var(--space-3)',
                  }}
                >
                  <span {...rosterDrag.handleProps(n.id)} title="Drag to reorder" aria-label="Drag to reorder NPC" style={grip}>⠿</span>
                  <button
                    onClick={() => setSelectedId(n.id)}
                    style={{ flex: 1, textAlign: 'left', font: 'inherit', fontWeight: n.id === selectedId ? 600 : 400, background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', padding: 0 }}
                  >
                    {n.name.trim() || <span style={{ color: 'var(--color-text-muted)' }}>Unnamed NPC</span>}
                  </button>
                  <button onClick={() => handleDeleteNpc(n.id)} aria-label="Delete NPC" title="Delete NPC" style={iconBtn}>✕</button>
                </div>
              </Fragment>
            ))}
            {rosterDrag.indicator?.index === npcs.length && <InsertionBar />}
          </div>

          {/* Detail (selected NPC). */}
          {selected && (
            <div style={{ flex: '2 1 340px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Portrait + name. */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                <div style={{ width: 96 }}>
                  {portraitUrl && (
                    <img src={portraitUrl} alt={`${selected.name} portrait`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }} />
                  )}
                  <div style={{ marginTop: portraitUrl ? 'var(--space-2)' : 0 }}>
                    <ImageUpload
                      campaignId={campaignId}
                      label={portraitUrl ? 'Change portrait' : 'Portrait'}
                      onUploaded={(result) => {
                        setPortraitUrl(result.thumbUrl ?? result.originalUrl)
                        void runSave(() => updateNpc(selected.id, { portrait_asset_id: result.asset.id }), 'npc-portrait')
                      }}
                    />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    value={selected.name}
                    onChange={(e) => handleNpcChange(selected.id, { name: e.target.value })}
                    maxLength={200}
                    aria-label="NPC name"
                    placeholder="NPC name"
                    style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontWeight: 600, fontSize: '1.05rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
                  />
                  <label style={{ display: 'block', marginTop: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Description</label>
                  <AutoTextarea
                    value={selected.description}
                    onChange={(e) => handleNpcChange(selected.id, { description: e.target.value })}
                    aria-label="NPC description"
                    placeholder="Who is this NPC? Role, demeanor, hooks…"
                    minRows={2}
                    style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
                  />
                </div>
              </div>

              {/* Stat block. */}
              <h3 style={{ margin: 'var(--space-2) 0 0', fontSize: '1rem' }}>Stat block</h3>
              {sheetLoading ? (
                <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
              ) : (
                <NpcStatBlock
                  sections={sections}
                  onAddSection={handleAddSection}
                  onSectionTitle={handleSectionTitle}
                  onDeleteSection={handleDeleteSection}
                  onReorderSections={reorderSectionsLocal}
                  onAddField={handleAddField}
                  onFieldChange={handleFieldChange}
                  onDeleteField={handleDeleteField}
                  onReorderFields={reorderFieldsLocal}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * NpcStatBlock — the editable stat block for one NPC: a drag-reorderable list of
 * sections, each rendered by <StatSectionRow>. Presentational glue that wires the
 * section-level drag context to the callbacks the panel provides.
 */
function NpcStatBlock({
  sections,
  onAddSection,
  onSectionTitle,
  onDeleteSection,
  onReorderSections,
  onAddField,
  onFieldChange,
  onDeleteField,
  onReorderFields,
}: {
  sections: NpcSectionWithFields[]
  onAddSection: () => void
  onSectionTitle: (sectionId: string, title: string) => void
  onDeleteSection: (sectionId: string) => void
  onReorderSections: (fromId: string, toIndex: number) => void
  onAddField: (sectionId: string) => void
  onFieldChange: (sectionId: string, fieldId: string, patch: Partial<Pick<NpcStatField, 'label' | 'value'>>) => void
  onDeleteField: (sectionId: string, fieldId: string) => void
  onReorderFields: (sectionId: string, fromId: string, toIndex: number) => void
}) {
  const drag = useDragReorder(onReorderSections)
  return (
    <div>
      <div {...drag.containerProps} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {sections.map((s, i) => (
          <Fragment key={s.id}>
            {drag.indicator?.index === i && <InsertionBar />}
            <div {...drag.rowProps(i)} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span {...drag.handleProps(s.id)} title="Drag to reorder section" aria-label="Drag to reorder section" style={grip}>⠿</span>
                <input
                  value={s.title}
                  onChange={(e) => onSectionTitle(s.id, e.target.value)}
                  maxLength={120}
                  aria-label="Section title"
                  placeholder="Section title"
                  style={{ flex: 1, font: 'inherit', fontWeight: 600, background: 'transparent', border: '1px solid transparent', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                />
                <button onClick={() => onDeleteSection(s.id)} aria-label="Delete section" title="Delete section" style={iconBtn}>✕</button>
              </div>
              <StatSectionFields
                section={s}
                onAddField={onAddField}
                onFieldChange={onFieldChange}
                onDeleteField={onDeleteField}
                onReorderFields={onReorderFields}
              />
            </div>
          </Fragment>
        ))}
        {drag.indicator?.index === sections.length && <InsertionBar />}
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Button variant="secondary" onClick={onAddSection} style={{ width: 'auto' }}>+ Add section</Button>
      </div>
    </div>
  )
}

/**
 * StatSectionFields — the fields inside one stat section, with their own
 * drag-reorder context (each section reorders independently of the others).
 */
function StatSectionFields({
  section,
  onAddField,
  onFieldChange,
  onDeleteField,
  onReorderFields,
}: {
  section: NpcSectionWithFields
  onAddField: (sectionId: string) => void
  onFieldChange: (sectionId: string, fieldId: string, patch: Partial<Pick<NpcStatField, 'label' | 'value'>>) => void
  onDeleteField: (sectionId: string, fieldId: string) => void
  onReorderFields: (sectionId: string, fromId: string, toIndex: number) => void
}) {
  const drag = useDragReorder((fromId, toIndex) => onReorderFields(section.id, fromId, toIndex))
  return (
    <div {...drag.containerProps} style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {section.fields.map((f, j) => (
        <Fragment key={f.id}>
          {drag.indicator?.index === j && <InsertionBar />}
          <div {...drag.rowProps(j)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span {...drag.handleProps(f.id)} title="Drag to reorder field" aria-label="Drag to reorder field" style={grip}>⠿</span>
            <input
              value={f.label}
              onChange={(e) => onFieldChange(section.id, f.id, { label: e.target.value })}
              maxLength={120}
              aria-label="Field label"
              placeholder="Label"
              style={{ flex: '0 0 34%', font: 'inherit', fontWeight: 600, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
            />
            {/* Value grows to fit long content (auto-height); label stays single-line. */}
            <AutoTextarea
              value={f.value}
              onChange={(e) => onFieldChange(section.id, f.id, { value: e.target.value })}
              aria-label="Field value"
              placeholder="Value"
              minRows={2}
              maxRows={6}
              style={{ flex: 1, boxSizing: 'border-box', font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
            />
            <button onClick={() => onDeleteField(section.id, f.id)} aria-label="Delete field" title="Delete field" style={iconBtn}>✕</button>
          </div>
        </Fragment>
      ))}
      {drag.indicator?.index === section.fields.length && <InsertionBar />}
      <button
        onClick={() => onAddField(section.id)}
        style={{ alignSelf: 'flex-start', marginTop: 'var(--space-1)', font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer' }}
      >
        + Add field
      </button>
    </div>
  )
}

const grip = { cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' } as const
const iconBtn = { font: 'inherit', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 'var(--space-1)' } as const
