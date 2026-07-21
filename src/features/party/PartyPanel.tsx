/**
 * PartyPanel — the DM's read-only "Party" tab (Phase 3.4.2).
 *
 * Lists every player's character in the campaign and lets the DM open any one
 * READ-ONLY: portrait, lore (backstory/appearance/personality), the flexible
 * sheet (sections + fields), inventory, abilities, and spells. There is NO
 * editing here and — by design — NO journal: a player's journal stays private
 * (the DM only ever sees entries a player explicitly shared, and this view
 * surfaces none of them).
 *
 * No new backend: the DM's existing read access (migration 0010 predicates)
 * already spans all of the above. This panel is a pure aggregation/read view;
 * RLS is the real gate, so a non-DM caller would simply get nothing.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FormError } from '../../components/ui'
import { renderSafeMarkdown } from '../lore/safeMarkdown'
import { SPELL_LEVELS, levelLabel } from '../spells/api'
import { listCampaignCharacters, type Character } from '../character/api'
import { listMembers, type Member } from '../campaigns/api'
import { loadPartySheet, type PartySheet } from './api'

/**
 * @param campaignId - The campaign whose party this is.
 */
export function PartyPanel({ campaignId }: { campaignId: string }) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<PartySheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetLoading, setSheetLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // owner_id → display name, for labelling whose character each one is.
  const nameByUser = useMemo(() => {
    const m = new Map<string, string>()
    for (const mem of members) m.set(mem.userId, mem.displayName ?? 'Unnamed player')
    return m
  }, [members])

  const selected = characters.find((c) => c.id === selectedId) ?? null

  /** Loads the party roster (every character + the member display names). */
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [chars, mems] = await Promise.all([
        listCampaignCharacters(campaignId),
        listMembers(campaignId),
      ])
      setCharacters(chars)
      setMembers(mems)
      setSelectedId((cur) => (cur && chars.some((c) => c.id === cur) ? cur : chars[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the party.')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Loads the selected character's read-only sheet bundle. */
  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setSheet(null)
      return
    }
    setSheetLoading(true)
    ;(async () => {
      try {
        const bundle = await loadPartySheet(selected)
        if (!cancelled) setSheet(bundle)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the sheet.')
      } finally {
        if (!cancelled) setSheetLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected])

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-6)' }}>Loading…</p>
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Party</h2>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Read-only view of every player's character. Journals stay private to the
        player and aren't shown here.
      </p>

      <FormError message={error} />

      {characters.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          No player characters yet. They'll appear here once players create them.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Roster (master). */}
          <div style={{ flex: '1 1 200px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {characters.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  textAlign: 'left',
                  font: 'inherit',
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: c.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)',
                  background: c.id === selectedId ? 'var(--color-surface)' : 'var(--color-bg)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-2) var(--space-3)',
                  color: 'var(--color-text)',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {c.name.trim() || 'Unnamed character'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  {nameByUser.get(c.owner_id) ?? 'Unknown player'}
                </div>
              </button>
            ))}
          </div>

          {/* Read-only sheet (detail). */}
          <div style={{ flex: '2 1 360px', minWidth: 300 }}>
            {selected && (
              <ReadOnlySheet
                character={selected}
                ownerName={nameByUser.get(selected.owner_id) ?? 'Unknown player'}
                sheet={sheet}
                loading={sheetLoading}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ReadOnlySheet — renders one character's full sheet for the DM, read-only.
 * @param character - The character (name/lore/portrait id).
 * @param ownerName - The owning player's display name.
 * @param sheet - The loaded bundle (null while loading).
 * @param loading - Whether the bundle is still loading.
 */
function ReadOnlySheet({
  character,
  ownerName,
  sheet,
  loading,
}: {
  character: Character
  ownerName: string
  sheet: PartySheet | null
  loading: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header: portrait + name + owner. */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        {sheet?.portraitUrl ? (
          <img
            src={sheet.portraitUrl}
            alt={`${character.name} portrait`}
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}
          />
        ) : null}
        <div>
          <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{character.name.trim() || 'Unnamed character'}</h3>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Played by {ownerName}</div>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading sheet…</p>
      ) : sheet ? (
        <>
          {/* Lore: backstory / appearance / personality (safe-markdown, read-only). */}
          <LoreBlock label="Backstory" value={character.backstory} />
          <LoreBlock label="Appearance" value={character.appearance} />
          <LoreBlock label="Personality" value={character.personality} />

          {/* Flexible sheet sections. */}
          {sheet.sections.length > 0 && (
            <Section title="Character sheet">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {sheet.sections.map((s) => (
                  <div key={s.id}>
                    <h4 style={{ margin: '0 0 var(--space-2)', fontSize: '1.1rem', fontWeight: 700 }}>{s.title || 'Untitled'}</h4>
                    {s.fields.length === 0 ? (
                      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No fields.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        {s.fields.map((f) => (
                          <div key={f.id} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <span style={{ flex: '0 0 34%', fontWeight: 600, color: 'var(--color-text)' }}>
                              {f.label || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                            </span>
                            <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{f.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Inventory. */}
          {sheet.inventory.length > 0 && (
            <Section title="Inventory">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {sheet.inventory.map((it) => (
                  <div key={it.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--color-text-muted)', minWidth: 34 }}>×{it.qty}</span>
                    <span style={{ fontWeight: 600 }}>
                      {it.name || <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>Unnamed item</span>}
                      {it.equipped && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--color-accent)' }}>equipped</span>}
                    </span>
                    {it.notes && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>— {it.notes}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Abilities & feats. */}
          {sheet.abilities.length > 0 && (
            <Section title="Abilities & Feats">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {sheet.abilities.map((a) => (
                  <div key={a.id}>
                    <span style={{ fontWeight: 600 }}>{a.name || 'Unnamed'}</span>
                    {a.uses != null && <span style={{ marginLeft: 6, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>({a.uses} use{a.uses === 1 ? '' : 's'})</span>}
                    {a.description && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{a.description}</div>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Spells, grouped by level. */}
          {sheet.spells.length > 0 && (
            <Section title="Spells">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {SPELL_LEVELS.filter((lvl) => sheet.spells.some((s) => s.level === lvl)).map((lvl) => (
                  <div key={lvl}>
                    <h4 style={{ margin: '0 0 var(--space-1)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                      {levelLabel(lvl)}
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {sheet.spells.filter((s) => s.level === lvl).map((s) => (
                        <div key={s.id}>
                          <span style={{ fontWeight: 600 }}>{s.name || 'Unnamed spell'}</span>
                          {s.prepared && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--color-accent)' }}>prepared</span>}
                          {s.description && <div style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{s.description}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      ) : null}
    </div>
  )
}

/** A labelled read-only lore block; renders nothing when the field is empty. */
function LoreBlock({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <Section title={label}>
      <div
        // Safe: renderSafeMarkdown HTML-escapes all author text before inserting
        // only its own fixed tags (see lore/safeMarkdown.ts).
        dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(value) }}
        style={{ lineHeight: 1.5 }}
      />
    </Section>
  )
}

/**
 * A titled, COLLAPSIBLE read-only section. The header toggles the body open/
 * closed (starts COLLAPSED) so the DM opens only the sections they want to see.
 * Collapse state is local to each mounted section and resets when a different
 * character is selected (the sheet remounts).
 * @param title - The section heading (also the toggle label).
 * @param children - The section body, shown only while expanded.
 * @param defaultOpen - Whether the section starts expanded (default false).
 */
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-surface)',
        padding: 'var(--space-4)',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          width: '100%',
          font: 'inherit',
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Chevron: ▾ open, ▸ collapsed. */}
        <span aria-hidden style={{ fontSize: '0.7rem' }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 'var(--space-2)' }}>{children}</div>}
    </div>
  )
}
