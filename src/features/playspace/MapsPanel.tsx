/**
 * MapsPanel — the DM's Maps tab (9.1.2b).
 *
 * Owns: the campaign's set of battlemaps — uploading them, naming them, setting
 * each one's grid, choosing which one the table sees, and deleting them. It does
 * NOT draw the map or its tokens; that is <BattlemapView>.
 *
 * WHY IT IS A TAB and not the strip of controls it started as. Map admin is
 * setup work with a picture, a slider and a list of five things, and it was
 * competing for horizontal space with the map it configures. Every other
 * feature in this app is a panel; this one had no reason to be the exception.
 * The canvas gets its full area back as a direct result.
 *
 * DM-ONLY, and not merely hidden: a player has no route to switch the live map,
 * which would let one person pull the shared view out from under the table.
 * RLS refuses their write regardless (0048).
 *
 * ORDER OF OPERATIONS, per the owner's 9.1.1 requirement: upload the picture
 * FIRST, then set the grid against it. A new map is created at the image's own
 * pixel dimensions — measured client-side, because the server never decodes the
 * file (0048 decision 3) — so the slider is aligning a real overlay to a real
 * picture rather than to a guess.
 */
import { useState } from 'react'
import { Button, FormError } from '../../components/ui'
import { ImageUpload } from '../media/ImageUpload'
import { useCampaignMaps } from './useCampaignMaps'
import { MAX_MAPS, createMap, deleteMap, listTokens, resnapTokens, updateMap, type PlayspaceMap } from './api'

/**
 * @param campaignId - The campaign whose maps these are.
 * @param isDm - Guard. The tab is DM-only in tabs.ts; this is the second line.
 */
export function MapsPanel({ campaignId, isDm }: { campaignId: string; isDm: boolean }) {
  const { maps, loading, error: loadError, patch } = useCampaignMaps(campaignId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isDm) {
    return <p style={muted}>Only the DM can manage this campaign's battlemaps.</p>
  }

  /** Runs an action, surfacing 0050's trigger messages verbatim — they are
   *  written to be read by a person (the five-map cap, the membership check). */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * A newly uploaded image becomes a map at its own dimensions and goes live at
   * once — a DM who just uploaded a battlemap wants to see it, and the 0050
   * trigger clears is_active on the others, so this is one write, not two.
   */
  async function handleUploaded(assetId: string, width: number | null, height: number | null) {
    await run(async () => {
      const created = await createMap(campaignId, {
        name: `Map ${maps.length + 1}`,
        background_asset_id: assetId,
        // Fall back to the column defaults when the browser could not report an
        // intrinsic size, rather than storing a value the CHECK would reject.
        width_px: width && width >= 100 ? Math.min(width, 20000) : 1400,
        height_px: height && height >= 100 ? Math.min(height, 20000) : 900,
        is_active: true,
      })
      patch((prev) => [...prev.map((m) => ({ ...m, is_active: false })), created])
    })
  }

  /** Switch which map the table is looking at. ONE update — see api.ts. */
  async function handleActivate(mapId: string) {
    await run(async () => {
      await updateMap(mapId, { is_active: true })
      patch((prev) => prev.map((m) => ({ ...m, is_active: m.id === mapId })))
    })
  }

  /**
   * Any of the three grid controls: size, and the two offsets.
   *
   * Optimistic so the slider tracks the pointer without lag. One function for
   * all three because they are the same operation on the same row — and because
   * the DM adjusts them together, nudging the offset after every size change
   * until the overlay sits on the printed grid.
   *
   * @param mapId - Map to adjust.
   * @param patchFields - The column(s) to set.
   */
  async function handleGrid(
    mapId: string,
    patchFields: { grid_size?: number; grid_offset_x?: number; grid_offset_y?: number },
  ) {
    patch((prev) => prev.map((m) => (m.id === mapId ? { ...m, ...patchFields } : m)))
    await run(() => updateMap(mapId, patchFields))
  }

  /**
   * Re-snaps the map's tokens after a grid adjustment is FINISHED.
   *
   * Fired on pointer-up / blur rather than on every slider event: tokens keep
   * their size through a re-grid for free (size is stored in squares, 0056) but
   * their positions are absolute (0048 decision 1), so they need moving — and
   * doing that per slider pixel would be one write per token per pixel, with
   * everyone else's map stuttering as the events arrived.
   */
  async function handleGridCommitted(mapId: string) {
    const m = maps.find((x) => x.id === mapId)
    if (!m) return
    await run(async () => {
      const tokens = await listTokens(mapId)
      await resnapTokens(m, tokens)
    })
  }

  /**
   * The vision toggle (9.2.2). The column has existed since 0048 doing nothing;
   * this is what turns it on.
   *
   * OFF means no fog at all — the whole map is visible to everyone, which is the
   * default and the behaviour every campaign has had until now. ON hands the map
   * to the vision system (9.3/9.4). Walls can be drawn either way, so a DM can
   * prepare a map's obstructions before ever switching fog on.
   */
  async function handleVision(mapId: string, next: boolean) {
    patch((prev) => prev.map((m) => (m.id === mapId ? { ...m, vision_enabled: next } : m)))
    await run(() => updateMap(mapId, { vision_enabled: next }))
  }

  /**
   * Fog density (0065). Optimistic, like the grid controls, so the slider
   * tracks the pointer.
   */
  async function handleFogOpacity(mapId: string, next: number) {
    const clamped = Math.min(Math.max(next, 0.3), 1)
    patch((prev) => prev.map((m) => (m.id === mapId ? { ...m, fog_opacity: clamped } : m)))
    await run(() => updateMap(mapId, { fog_opacity: clamped }))
  }

  /**
   * The DM's switch for player-placed tokens (0055).
   *
   * Per map, not per campaign, so a DM can allow it on the town square and not
   * in the dungeon. Enforced by RLS, not by hiding the button: the matrix
   * asserts both halves.
   */
  async function handlePlayersCanPlace(mapId: string, next: boolean) {
    patch((prev) => prev.map((m) => (m.id === mapId ? { ...m, players_can_place: next } : m)))
    await run(() => updateMap(mapId, { players_can_place: next }))
  }

  async function handleRename(map: PlayspaceMap, name: string) {
    const trimmed = name.trim()
    // The column requires 1..120 chars; refusing here keeps a blank rename from
    // becoming an error the DM has to read to understand.
    if (!trimmed || trimmed === map.name) return
    patch((prev) => prev.map((m) => (m.id === map.id ? { ...m, name: trimmed } : m)))
    await run(() => updateMap(map.id, { name: trimmed.slice(0, 120) }))
  }

  async function handleDelete(map: PlayspaceMap) {
    if (!window.confirm(`Delete "${map.name}" and every token on it? This cannot be undone.`)) return
    await run(async () => {
      await deleteMap(map.id)
      patch((prev) => prev.filter((m) => m.id !== map.id))
    })
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      {(error || loadError) && <FormError message={error ?? loadError} />}

      {/* Upload is offered until the cap; past it the DM is told to delete one,
          rather than being allowed to try and meet the trigger's error. */}
      {maps.length < MAX_MAPS ? (
        <section>
          <h3 style={heading}>Add a battlemap</h3>
          <p style={muted}>
            Upload the picture first, then set its grid below to line up with the map. Up to{' '}
            {MAX_MAPS} maps; you can swap between them at any time.
          </p>
          <ImageUpload
            campaignId={campaignId}
            label="Upload a battlemap"
            disabled={busy}
            onUploaded={(r) => void handleUploaded(r.asset.id, r.asset.width, r.asset.height)}
          />
        </section>
      ) : (
        <p style={muted}>
          You have the maximum of {MAX_MAPS} maps. Delete one below to add another.
        </p>
      )}

      <section>
        <h3 style={heading}>
          Maps ({maps.length}/{MAX_MAPS})
        </h3>
        {loading ? (
          <p style={muted}>Loading…</p>
        ) : maps.length === 0 ? (
          <p style={muted}>No maps yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
            {maps.map((m) => (
              <li
                key={m.id}
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-surface)',
                  // The live map is called out by its border rather than by a
                  // badge alone: which map the table is seeing is the single
                  // most important fact on this screen.
                  border: `1px solid ${m.is_active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius)',
                  display: 'grid',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Rename in place on blur — a name is not worth a dialog. */}
                  <input
                    defaultValue={m.name}
                    maxLength={120}
                    onBlur={(e) => void handleRename(m, e.target.value)}
                    style={{ font: 'inherit', fontWeight: 600, flex: '1 1 12rem', minWidth: 0 }}
                    aria-label={`Name of ${m.name}`}
                  />
                  {m.is_active ? (
                    <span style={{ color: 'var(--color-accent)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Live
                    </span>
                  ) : (
                    <Button style={{ width: 'auto' }} variant="secondary" busy={busy} onClick={() => void handleActivate(m.id)}>
                      Make live
                    </Button>
                  )}
                  <Button
                    style={{ width: 'auto', color: 'var(--color-danger)' }}
                    variant="secondary"
                    onClick={() => void handleDelete(m)}
                  >
                    Delete
                  </Button>
                </div>

                {/* Three controls, because size alone cannot align an overlay
                    to a grid printed on a scanned map: the spacing can be exactly
                    right and still be half a square out everywhere. Bounds mirror
                    the CHECKs in 0048/0055, so no control can offer a value the
                    database will reject. */}
                <GridControl
                  label="Grid"
                  min={10}
                  max={500}
                  value={m.grid_size}
                  onChange={(v) => void handleGrid(m.id, { grid_size: v })}
                  onCommit={() => void handleGridCommitted(m.id)}
                />
                <GridControl
                  label="Shift →"
                  min={-500}
                  max={500}
                  value={m.grid_offset_x}
                  onChange={(v) => void handleGrid(m.id, { grid_offset_x: v })}
                  onCommit={() => void handleGridCommitted(m.id)}
                />
                <GridControl
                  label="Shift ↓"
                  min={-500}
                  max={500}
                  value={m.grid_offset_y}
                  onChange={(v) => void handleGrid(m.id, { grid_offset_y: v })}
                  onCommit={() => void handleGridCommitted(m.id)}
                />

                {/* The player-placement switch (0055). Default off: a permission
                    that turns itself on without the DM asking is the wrong
                    default for a table they are running. */}
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={m.players_can_place}
                    onChange={(e) => void handlePlayersCanPlace(m.id, e.target.checked)}
                  />
                  Let players put their own character on this map
                </label>

                {/* Vision (9.2). Says what OFF means as well as what ON does:
                    "vision" alone reads as a feature you are enabling, when the
                    consequential half is that turning it on HIDES things from
                    your players. */}
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={m.vision_enabled}
                    onChange={(e) => void handleVision(m.id, e.target.checked)}
                  />
                  Limit what players can see (fog &amp; walls)
                </label>
                {m.vision_enabled && (
                  <>
                    {/* Fog density (0065). Safe to lower ONLY because tokens
                        outside the lit area are not drawn at all — the label
                        says what it does and does not reveal, because "how dark
                        is the fog" sounds cosmetic and is not. */}
                    <GridControl
                      label="Fog"
                      min={30}
                      max={100}
                      value={Math.round(m.fog_opacity * 100)}
                      onChange={(v) => void handleFogOpacity(m.id, v / 100)}
                    />
                    <p style={{ ...muted, margin: 0, fontSize: '0.75rem' }}>
                      Draw walls on the map itself. Players never receive the wall
                      geometry — only what their token can see. Lowering the fog
                      lets them make out the <em>terrain</em> they cannot see;
                      tokens and walls stay hidden either way.
                    </p>
                  </>
                )}

                <p style={{ ...muted, margin: 0, fontSize: '0.75rem' }}>
                  {m.width_px}×{m.height_px}px
                  {/* 0048 decision 1, said out loud where it would otherwise look
                      like a bug: positions are map pixels, not cells. */}
                  {' · '}tokens re-snap to the grid when you finish adjusting it
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const heading: React.CSSProperties = { fontSize: '1rem', margin: '0 0 var(--space-2)' }
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.85rem' }

/**
 * One grid control: a slider AND a typed number, sharing a value.
 *
 * Both, not either. The slider is how you FIND an alignment — you drag until the
 * overlay sits on the printed grid, watching the map, which no amount of typing
 * replaces. The number is how you SET one you already know, and how you nudge by
 * exactly one pixel, which a slider on a 1000-unit range cannot do reliably.
 *
 * The typed value is committed on change but CLAMPED, never rejected: a number
 * input lets someone type "9000", and silently doing nothing would look broken.
 * An empty field is ignored rather than treated as zero — you have to clear the
 * box to retype it, and snapping the grid to 0 mid-edit would be alarming.
 *
 * @param label - Short name, shown before the controls.
 * @param min / max - Bounds, mirroring the database CHECK for that column.
 * @param value - Current value.
 * @param onChange - Called with the new number, already clamped to [min, max].
 * @param onCommit - Called once the adjustment is FINISHED (pointer released, or
 *        the typed field left). Separate from onChange because the expensive
 *        follow-up work — re-snapping every token on the map — must happen once,
 *        not on every pixel of slider travel.
 */
function GridControl({
  label,
  min,
  max,
  value,
  onChange,
  onCommit,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  onCommit?: () => void
}) {
  /**
   * What the box is SHOWING, which is not always the committed value.
   *
   * A fully controlled `value={value}` box cannot be cleared: deleting the last
   * character fires onChange with "", the parent ignores it as not-a-number, and
   * the re-render immediately puts the old digits back — so the field appears to
   * refuse the Backspace key (reported 2026-09-01). Holding the draft locally
   * lets the box be empty, or hold a half-typed "-", while the map keeps using
   * the last good number. null means "not being edited: show the real value".
   */
  const [draft, setDraft] = useState<string | null>(null)

  /** Clamps and commits, ignoring an empty or half-typed field. */
  function commit(raw: string) {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return
    onChange(Math.min(Math.max(Math.round(n), min), max))
  }

  return (
    <label style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', fontSize: '0.8rem' }}>
      <span style={{ minWidth: '4.5rem' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // Both, because a slider can be finished with either device, and a
        // keyboard user never fires pointerup at all.
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        style={{ flex: 1, minWidth: 0 }}
      />
      <input
        type="number"
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        // Dropping the draft on blur re-syncs the box to the value actually in
        // use, so a field left holding "" or "9000" snaps back to the truth
        // rather than lying about what the map is doing.
        onBlur={() => {
          setDraft(null)
          onCommit?.()
        }}
        aria-label={`${label} in pixels`}
        style={{ font: 'inherit', fontSize: '0.8rem', width: '4.5rem', flexShrink: 0 }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>px</span>
    </label>
  )
}
