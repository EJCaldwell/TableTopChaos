/**
 * EncountersPanel — the DM's "Encounters" tab (Phase 3.2, migration 0020).
 *
 * Master/detail workspace for prepared encounters:
 *   - LIST (master): the campaign's encounters, newest-first, with create,
 *     select, drag-reorder, delete.
 *   - DETAIL: name, a general **description**, a separate DM-only **"Hidden
 *     nearby"** notes box, the encounter's **images** (upload via the 1.6
 *     pipeline, caption, drag-reorder, remove) with a full-screen **Present**
 *     view, and the **NPCs** linked from the campaign roster (attach/detach; each
 *     linked NPC's stat block is viewable read-only inline).
 *
 * DM-only via RLS (migration 0020). Reuses the shared DM autosave engine + drag
 * hook (dm/autosave.tsx). NPC stat blocks are authored on the NPCs tab; here they
 * are linked and shown read-only.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { ImageUpload } from '../media/ImageUpload'
import {
  useAutosave,
  SaveIndicator,
  InsertionBar,
  moveToIndex,
  useDragReorder,
} from './autosave'
import {
  addEncounterNpc,
  addImage,
  createEncounter,
  deleteEncounter,
  listEncounterNpcs,
  listEncounters,
  listImages,
  removeEncounterNpc,
  removeImage,
  reorderEncounters,
  reorderImages,
  updateEncounter,
  updateImageCaption,
  type Encounter,
  type ResolvedEncounterImage,
} from './encountersApi'
import { getNpcSheet, listNpcs, type Npc, type NpcSectionWithFields } from './npcsApi'

/** @param campaignId - The campaign whose encounters this is. */
export function EncountersPanel({ campaignId }: { campaignId: string }) {
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [images, setImages] = useState<ResolvedEncounterImage[]>([])
  const [linkedNpcIds, setLinkedNpcIds] = useState<{ id: string; npc_id: string }[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [presenting, setPresenting] = useState(false)

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()
  const [loading, setLoading] = useState(true)

  const selected = encounters.find((e) => e.id === selectedId) ?? null

  /** Loads encounters + the roster (roster feeds the NPC-link picker + names). */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [encs, roster] = await Promise.all([listEncounters(campaignId), listNpcs(campaignId)])
      setEncounters(encs)
      setNpcs(roster)
      setSelectedId((cur) => (cur && encs.some((e) => e.id === cur) ? cur : encs[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load encounters.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Loads the selected encounter's images + npc links. */
  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setImages([])
      setLinkedNpcIds([])
      return
    }
    setDetailLoading(true)
    ;(async () => {
      try {
        const [imgs, links] = await Promise.all([listImages(selectedId), listEncounterNpcs(selectedId)])
        if (!cancelled) {
          setImages(imgs)
          setLinkedNpcIds(links.map((l) => ({ id: l.id, npc_id: l.npc_id })))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the encounter.')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, setError])

  // ---- encounter (master) actions ----
  async function handleAdd() {
    const position = encounters.reduce((max, e) => Math.max(max, e.position), 0) + 1
    await runSave(async () => {
      const e = await createEncounter(campaignId, position)
      setEncounters((prev) => [e, ...prev])
      setSelectedId(e.id)
    })
  }
  function handleFieldChange(id: string, patch: Partial<Pick<Encounter, 'name' | 'description' | 'hidden_notes'>>) {
    setEncounters((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    scheduleSave(`encounter-${id}`, () => updateEncounter(id, patch))
  }
  async function handleDelete(id: string) {
    const e = encounters.find((x) => x.id === id)
    if (!e) return
    const hasContent = e.name.trim() !== '' || e.description.trim() !== '' || e.hidden_notes.trim() !== ''
    if (hasContent && !window.confirm(`Delete "${e.name.trim() || 'this encounter'}"? This cannot be undone.`)) return
    const prev = encounters
    setEncounters((cur) => cur.filter((x) => x.id !== id))
    if (selectedId === id) setSelectedId(null)
    await runSave(() => deleteEncounter(id)).catch(() => setEncounters(prev))
  }
  const encDrag = useDragReorder((fromId, toIndex) => {
    setEncounters((prev) => {
      const next = moveToIndex(prev, (e) => e.id === fromId, toIndex)
      if (next === prev) return prev
      void runSave(() => reorderEncounters(next.map((e) => e.id)), 'reorder-encounters')
      return next
    })
  })

  // ---- image actions ----
  async function handleImageUploaded(assetId: string, fullUrl: string | null, thumbUrl: string | null) {
    if (!selectedId) return
    const position = images.length
    await runSave(async () => {
      const row = await addImage(selectedId, assetId, position)
      setImages((prev) => [...prev, { ...row, fullUrl, thumbUrl: thumbUrl ?? fullUrl, moderationStatus: 'approved' }])
    })
  }
  function handleCaptionChange(id: string, caption: string) {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, caption } : img)))
    scheduleSave(`caption-${id}`, () => updateImageCaption(id, caption))
  }
  async function handleRemoveImage(id: string) {
    const img = images.find((x) => x.id === id)
    if (!img) return
    if (img.caption.trim() !== '' && !window.confirm('Remove this image from the encounter?')) return
    const prev = images
    setImages((cur) => cur.filter((x) => x.id !== id))
    await runSave(() => removeImage(id)).catch(() => setImages(prev))
  }
  const imgDrag = useDragReorder((fromId, toIndex) => {
    setImages((prev) => {
      const next = moveToIndex(prev, (img) => img.id === fromId, toIndex)
      if (next === prev) return prev
      void runSave(() => reorderImages(next.map((img) => img.id)), 'reorder-images')
      return next
    })
  })

  // ---- NPC link actions ----
  const linkedSet = new Set(linkedNpcIds.map((l) => l.npc_id))
  const unlinkedNpcs = npcs.filter((n) => !linkedSet.has(n.id))

  async function handleLinkNpc(npcId: string) {
    if (!selectedId || !npcId) return
    const position = linkedNpcIds.length
    await runSave(async () => {
      const link = await addEncounterNpc(selectedId, npcId, position)
      setLinkedNpcIds((prev) => [...prev, { id: link.id, npc_id: link.npc_id }])
    })
  }
  async function handleUnlinkNpc(linkId: string) {
    const prev = linkedNpcIds
    setLinkedNpcIds((cur) => cur.filter((l) => l.id !== linkId))
    await runSave(() => removeEncounterNpc(linkId)).catch(() => setLinkedNpcIds(prev))
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  const presentable = images.filter((img) => img.fullUrl)

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Encounters</h2>
        <SaveIndicator state={saveState} />
        <Button variant="secondary" onClick={handleAdd} style={{ width: 'auto', marginLeft: 'auto' }}>
          + New encounter
        </Button>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Private to you as the DM. Add images, a description, hidden notes, and link
        NPCs from your roster.
      </p>

      <FormError message={error} />

      {encounters.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No encounters yet. Add your first above.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Master list. */}
          <div {...encDrag.containerProps} style={{ flex: '1 1 200px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {encounters.map((e, i) => (
              <Fragment key={e.id}>
                {encDrag.indicator?.index === i && <InsertionBar />}
                <div
                  {...encDrag.rowProps(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    border: '1px solid', borderColor: e.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)',
                    background: e.id === selectedId ? 'var(--color-surface)' : 'var(--color-bg)',
                    borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-3)',
                  }}
                >
                  <span {...encDrag.handleProps(e.id)} title="Drag to reorder" aria-label="Drag to reorder encounter" style={grip}>⠿</span>
                  <button
                    onClick={() => setSelectedId(e.id)}
                    style={{ flex: 1, textAlign: 'left', font: 'inherit', fontWeight: e.id === selectedId ? 600 : 400, background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', padding: 0 }}
                  >
                    {e.name.trim() || <span style={{ color: 'var(--color-text-muted)' }}>Untitled encounter</span>}
                  </button>
                  <button onClick={() => handleDelete(e.id)} aria-label="Delete encounter" title="Delete encounter" style={iconBtn}>✕</button>
                </div>
              </Fragment>
            ))}
            {encDrag.indicator?.index === encounters.length && <InsertionBar />}
          </div>

          {/* Detail. */}
          {selected && (
            <div style={{ flex: '2 1 360px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <input
                value={selected.name}
                onChange={(e) => handleFieldChange(selected.id, { name: e.target.value })}
                maxLength={200}
                aria-label="Encounter name"
                placeholder="Encounter name"
                style={{ font: 'inherit', fontWeight: 600, fontSize: '1.05rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
              />

              <label style={fieldLabel}>Description</label>
              <AutoTextarea
                value={selected.description}
                onChange={(e) => handleFieldChange(selected.id, { description: e.target.value })}
                aria-label="Encounter description"
                placeholder="Setup, terrain, goals, how it plays out…"
                minRows={2}
                style={fieldBox}
              />

              {/* DM-only hidden notes — visually distinct (accent-dashed) secret box. */}
              <label style={{ ...fieldLabel, color: 'var(--color-accent)' }}>🔒 Hidden nearby (DM only)</label>
              <AutoTextarea
                value={selected.hidden_notes}
                onChange={(e) => handleFieldChange(selected.id, { hidden_notes: e.target.value })}
                aria-label="Hidden nearby notes"
                placeholder="Secret doors, traps, ambushers, treasure the party can't see yet…"
                minRows={2}
                style={{ ...fieldBox, border: '1px dashed var(--color-accent)' }}
              />

              {/* Images. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Images</h3>
                {presentable.length > 0 && (
                  <Button variant="secondary" onClick={() => setPresenting(true)} style={{ width: 'auto', marginLeft: 'auto' }}>
                    ▶ Present ({presentable.length})
                  </Button>
                )}
              </div>
              <ImageUpload
                campaignId={campaignId}
                label="Add an image"
                onUploaded={(result) => void handleImageUploaded(result.asset.id, result.originalUrl, result.thumbUrl)}
              />
              {detailLoading ? (
                <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
              ) : images.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No images yet.</p>
              ) : (
                <div {...imgDrag.containerProps} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {images.map((img, i) => (
                    <Fragment key={img.id}>
                      {imgDrag.indicator?.index === i && <InsertionBar />}
                      <div {...imgDrag.rowProps(i)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-2)' }}>
                        <span {...imgDrag.handleProps(img.id)} title="Drag to reorder image" aria-label="Drag to reorder image" style={grip}>⠿</span>
                        {img.thumbUrl ? (
                          <img src={img.thumbUrl} alt={img.caption || 'Encounter image'} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }} />
                        ) : (
                          <div title={`Image unavailable${img.moderationStatus ? ` (${img.moderationStatus})` : ''}`} style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius)', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>n/a</div>
                        )}
                        <input
                          value={img.caption}
                          onChange={(e) => handleCaptionChange(img.id, e.target.value)}
                          maxLength={200}
                          aria-label="Image caption"
                          placeholder="Caption (optional)"
                          style={{ flex: 1, font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                        />
                        <button onClick={() => handleRemoveImage(img.id)} aria-label="Remove image" title="Remove image" style={iconBtn}>✕</button>
                      </div>
                    </Fragment>
                  ))}
                  {imgDrag.indicator?.index === images.length && <InsertionBar />}
                </div>
              )}

              {/* Linked NPCs. */}
              <h3 style={{ margin: 'var(--space-2) 0 0', fontSize: '1rem' }}>NPCs</h3>
              {npcs.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  No NPCs in the roster yet — add some on the <strong>NPCs</strong> tab, then link them here.
                </p>
              ) : (
                <>
                  {unlinkedNpcs.length > 0 && (
                    <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Link an NPC{' '}
                      <select
                        value=""
                        onChange={(e) => {
                          const id = e.target.value
                          e.target.value = ''
                          void handleLinkNpc(id)
                        }}
                        aria-label="Link an NPC to this encounter"
                        style={{ font: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '2px 6px' }}
                      >
                        <option value="" disabled>Choose…</option>
                        {unlinkedNpcs.map((n) => (
                          <option key={n.id} value={n.id}>{n.name.trim() || 'Unnamed NPC'}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {linkedNpcIds.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No NPCs linked to this encounter.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {linkedNpcIds.map((link) => {
                        const npc = npcs.find((n) => n.id === link.npc_id)
                        if (!npc) return null
                        return <LinkedNpc key={link.id} npc={npc} onUnlink={() => handleUnlinkNpc(link.id)} />
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {presenting && selected && (
        <PresentationView title={selected.name.trim() || 'Encounter'} images={presentable} onClose={() => setPresenting(false)} />
      )}
    </div>
  )
}

/**
 * LinkedNpc — one NPC attached to an encounter: name + description, an "unlink"
 * control, and an expandable READ-ONLY view of the NPC's stat block (loaded on
 * demand). The stat block is authored on the NPCs tab; here it's reference only.
 */
function LinkedNpc({ npc, onUnlink }: { npc: Npc; onUnlink: () => void }) {
  const [open, setOpen] = useState(false)
  const [sections, setSections] = useState<NpcSectionWithFields[] | null>(null)
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!open || loadedFor.current === npc.id) return
    loadedFor.current = npc.id
    void getNpcSheet(npc.id).then(setSections).catch(() => setSections([]))
  }, [open, npc.id])

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ font: 'inherit', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}>
          <span aria-hidden style={{ marginRight: 6 }}>{open ? '▾' : '▸'}</span>
        </button>
        <span style={{ flex: 1, fontWeight: 600 }}>{npc.name.trim() || 'Unnamed NPC'}</span>
        <button onClick={onUnlink} aria-label="Unlink NPC" title="Unlink from this encounter" style={iconBtn}>✕</button>
      </div>
      {npc.description.trim() && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-1)', whiteSpace: 'pre-wrap' }}>{npc.description}</div>
      )}
      {open && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          {sections === null ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Loading stats…</p>
          ) : sections.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No stat block yet (add one on the NPCs tab).</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {sections.map((s) => (
                <div key={s.id}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.title || 'Untitled'}</div>
                  {s.fields.map((f) => (
                    <div key={f.id} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: '0.88rem' }}>
                      <span style={{ flex: '0 0 34%', fontWeight: 600 }}>{f.label || '—'}</span>
                      <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * PresentationView — full-screen black image viewer for projector/screen-share.
 * Pages with on-screen arrows or ←/→; Esc closes. Purely presentational.
 */
function PresentationView({ title, images, onClose }: { title: string; images: ResolvedEncounterImage[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const count = images.length
  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const current = images[safeIndex]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(count - 1, i + 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, onClose])

  if (!current) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={`${title} — presentation`} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', padding: '12px 16px', color: '#bbb', fontSize: '0.85rem' }}>
        <span>{title}</span>
        <span style={{ marginLeft: 'auto' }}>{safeIndex + 1} / {count}</span>
        <button onClick={onClose} aria-label="Close presentation" title="Close (Esc)" style={{ marginLeft: 16, font: 'inherit', background: 'none', border: '1px solid #444', color: '#ddd', borderRadius: 4, padding: '2px 10px', cursor: 'pointer' }}>✕ Close</button>
      </div>
      <img src={current.fullUrl ?? undefined} alt={current.caption || `${title} image ${safeIndex + 1}`} style={{ maxWidth: '92vw', maxHeight: '82vh', objectFit: 'contain' }} />
      {current.caption && <div style={{ marginTop: 12, color: '#ddd', fontSize: '1rem', maxWidth: '80vw', textAlign: 'center' }}>{current.caption}</div>}
      {count > 1 && (
        <>
          <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={safeIndex === 0} aria-label="Previous image" style={navBtn('left', safeIndex === 0)}>‹</button>
          <button onClick={() => setIndex((i) => Math.min(count - 1, i + 1))} disabled={safeIndex === count - 1} aria-label="Next image" style={navBtn('right', safeIndex === count - 1)}>›</button>
        </>
      )}
    </div>
  )
}

function navBtn(side: 'left' | 'right', disabled: boolean) {
  return {
    position: 'absolute' as const,
    [side]: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    font: 'inherit',
    fontSize: '2.5rem',
    lineHeight: 1,
    background: 'rgba(255,255,255,0.06)',
    border: 'none',
    color: disabled ? '#555' : '#fff',
    borderRadius: '50%',
    width: 56,
    height: 56,
    cursor: disabled ? 'default' : 'pointer',
  }
}

const grip = { cursor: 'grab', color: 'var(--color-text-muted)', userSelect: 'none' } as const
const iconBtn = { font: 'inherit', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 'var(--space-1)' } as const
const fieldLabel = { fontSize: '0.8rem', color: 'var(--color-text-muted)' } as const
const fieldBox = { width: '100%', boxSizing: 'border-box' as const, font: 'inherit', lineHeight: 1.5, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }
