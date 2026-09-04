/**
 * BattlemapView — the live battlemap, wherever it is shown (9.1.2).
 *
 * Owns: resolving WHICH map is live, the empty states, and the DM's
 * selected-token tools. The drawing and dragging belong to <BattlemapCanvas>;
 * managing the set of maps belongs to <MapsPanel> in the Maps tab.
 *
 * Fills the workspace area in EVERY game mode (owner decision 2026-08-28).
 * Notetaker campaigns get the same map in the same place — it was briefly a
 * separate tab, which put the same thing in two different shapes depending on a
 * setting most people never look at. What differs is `allowTokens`: a notetaker
 * map is shared reference art, so nobody adds tokens to it. Existing tokens
 * still render and drag, because turning a map read-only should not make pieces
 * already on it disappear.
 *
 * WHO SEES WHAT. Everyone sees the active map (0048 decision 4: one per
 * campaign) and every token on it — you must be able to see the DM's monsters
 * to play. A player has no way to change which map is live; that would let one
 * person yank the table's shared view out from under everyone.
 */
import { useEffect, useState } from 'react'
import { Button, FormError } from '../../components/ui'
import { BattlemapCanvas } from './BattlemapCanvas'
import type { WallTool } from './WallLayer'
import { useCampaignMaps } from './useCampaignMaps'
import { snapToken } from './grid'
import {
  clearWalls,
  TOKEN_RINGS,
  TOKEN_SIZES,
  deleteToken,
  listCreatures,
  updateToken,
  type CreatureChoice,
  type PlayspaceToken,
} from './api'
import { getMyCharacter } from '../character/api'
import type { Member } from '../campaigns/api'

/**
 * @param campaignId - The campaign whose battlemap this is.
 * @param members - Roster, so the DM can hand a token to a specific player
 *        (0050: relinquishing is `owner_user_id`, and the database checks the
 *        recipient is really a member).
 * @param isDm - Gates the token tools. RLS is the real gate.
 * @param currentUserId - Whose tokens this session may drag.
 * @param allowTokens - False in notetaker campaigns; see above.
 */
export function BattlemapView({
  campaignId,
  members,
  isDm,
  currentUserId,
  allowTokens = true,
}: {
  campaignId: string
  members: Member[]
  isDm: boolean
  currentUserId?: string
  allowTokens?: boolean
}) {
  const { active, loading, error: loadError } = useCampaignMaps(campaignId)
  const [selected, setSelected] = useState<PlayspaceToken | null>(null)
  /**
   * The active wall tool (9.2). DM-only, and reset whenever the live map
   * changes: a tool left armed on a map you are no longer looking at is how you
   * draw a wall across the wrong picture.
   */
  const [wallTool, setWallTool] = useState<WallTool>('none')
  /**
   * Snap Line and Room endpoints to grid intersections. On by default: a DM
   * drawing a dungeon almost always wants walls on the grid, and the ones who do
   * not are drawing freehand anyway, which never snaps.
   */
  const [wallSnap, setWallSnap] = useState(true)
  /**
   * Whether newly drawn walls are visible to players (0066).
   *
   * Applies to walls drawn from now on, not retroactively — a setting that
   * silently restyled every wall already on the map would be a nasty surprise
   * for a DM who had carefully hidden them.
   *
   * ON by default (owner, 2026-09-02), which is the opposite of the COLUMN's
   * default, and both are right for where they sit:
   *
   *   * the column defaults to false, so anything written without an explicit
   *     choice — a script, an import, a future feature — is secret. That is the
   *     safe default for data, and 0066's assertion depends on it.
   *   * this control defaults to true, because most walls a DM draws are the
   *     outline of the room the party is standing in. Making the common case
   *     require a tick meant either ticking it constantly or accidentally
   *     hiding scenery the players can see in the picture anyway.
   *
   * The consequence to be honest about: a DM who does not look at this will
   * draw walls their players can see. That is the right way round — a visible
   * wall is at worst redundant with the map image, whereas an accidentally
   * hidden one is a landmark that silently vanishes for the party.
   */
  const [wallVisible, setWallVisible] = useState(true)
  /**
   * Draw the selected token's line of sight (DM only).
   *
   * ON by default: a DM who selects a monster is usually asking what it can see,
   * and the overlay disappears the moment nothing is selected — so it is not
   * clutter you have to remember to turn off.
   */
  const [showSight, setShowSight] = useState(true)
  /**
   * Whether newly drawn walls stop movement (0067). On by default, matching the
   * column and the overwhelmingly common case — most walls are walls.
   */
  const [wallBlocks, setWallBlocks] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // No `busy` flag here any more: the only remaining actions in this component
  // are the two token controls, which are instantaneous and already guarded by
  // `run()` catching their errors. Adding a map takes time; relinquishing one
  // token does not.

  // The caller's own character, for the player's "put me on the map" button.
  // Only fetched for a player on a map that allows it, so a DM's session and a
  // locked map make no request at all. Failure is swallowed to null: the button
  // simply does not appear, which is the same as having no character.
  const [myCharacter, setMyCharacter] = useState<{
    id: string
    name: string
    portraitAssetId: string | null
  } | null>(null)
  // The campaign's NPCs, for the DM's "which creature is this?" picker (0058).
  // Loaded once per campaign for a DM only; a player's RLS would return an empty
  // list anyway, so not requesting it at all is simply honest about that.
  const [creatures, setCreatures] = useState<CreatureChoice[]>([])
  useEffect(() => {
    if (!isDm || !allowTokens) return
    let live = true
    listCreatures(campaignId)
      .then((c) => live && setCreatures(c))
      .catch(() => live && setCreatures([]))
    return () => {
      live = false
    }
  }, [isDm, allowTokens, campaignId])

  /**
   * Points a token at an NPC, taking that creature's name and portrait.
   *
   * The portrait's asset id is COPIED onto the token rather than followed
   * through npc_id at render time, because players cannot read NPC rows — see
   * migration 0058. Clearing the choice leaves the token a plain marker and
   * keeps whatever label it had.
   */
  async function handleCreature(token: PlayspaceToken, npcId: string) {
    const npc = creatures.find((c) => c.id === npcId)
    await run(async () =>
      setSelected(
        await updateToken(token.id, {
          npc_id: npc?.id ?? null,
          image_asset_id: npc?.portrait_asset_id ?? null,
          ...(npc ? { label: npc.name.slice(0, 60) } : {}),
        }),
      ),
    )
  }

  const mayPlaceOwn = !isDm && allowTokens && !!currentUserId && !!active?.players_can_place
  useEffect(() => {
    if (!mayPlaceOwn || !currentUserId) {
      setMyCharacter(null)
      return
    }
    let live = true
    getMyCharacter(campaignId, currentUserId)
      .then(
        (c) =>
          live &&
          setMyCharacter(
            c ? { id: c.id, name: c.name, portraitAssetId: c.portrait_asset_id } : null,
          ),
      )
      .catch(() => live && setMyCharacter(null))
    return () => {
      live = false
    }
  }, [mayPlaceOwn, campaignId, currentUserId])

  /** Runs a DM action, surfacing trigger messages (0050) verbatim on failure. */
  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  /**
   * Hands a token to a player, or reclaims it (empty selection → NULL owner,
   * which is never blocked). The membership check lives in the database, so an
   * invalid recipient fails loudly rather than being quietly filtered out.
   */
  async function handleRelinquish(tokenId: string, userId: string | null) {
    await run(async () => setSelected(await updateToken(tokenId, { owner_user_id: userId })))
  }

  // Leaving the map disarms the tool. Also covers the DM switching maps from the
  // Maps tab while a tool is held.
  useEffect(() => {
    setWallTool('none')
  }, [active?.id])

  if (loading) return <Centered>Loading the battlemap…</Centered>

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {(error || loadError) && (
        <div style={{ padding: 'var(--space-2) var(--space-4)' }}>
          <FormError message={error ?? loadError} />
        </div>
      )}

      {/* Token tools live HERE, not in the Maps tab, because selection happens
          on the canvas: a control acting on "the selected token" belongs beside
          the thing you select it on. The Maps tab owns the maps; this owns
          what is standing on one. Absent until something is selected, rather
          than present-but-disabled. */}
      {/* Wall tools (9.2). DM-only, and above the token strip because arming a
          tool changes what every subsequent click does — a mode switch belongs
          where you cannot miss that you are in it. */}
      {isDm && active && (
        <div style={strip}>
          <strong>Walls</strong>
          {WALL_TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setWallTool((cur) => (cur === t.value ? 'none' : t.value))}
              // Pressed state on the button itself, not just a colour: the
              // difference between "drawing walls" and "moving tokens" is the
              // most consequential mode in the app, and colour alone is not
              // enough to carry it.
              aria-pressed={wallTool === t.value}
              style={{
                font: 'inherit',
                fontSize: '0.8rem',
                cursor: 'pointer',
                borderRadius: 'var(--radius)',
                padding: '2px 8px',
                border: '1px solid currentColor',
                background: wallTool === t.value ? 'var(--color-accent)' : 'transparent',
                color: wallTool === t.value ? '#fff' : 'inherit',
              }}
            >
              {t.label}
            </button>
          ))}
          {/* Only offered while a drawing tool is armed — a snap setting with
              nothing to snap is clutter. */}
          {(wallTool === 'segment' || wallTool === 'rect') && (
            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={wallSnap}
                onChange={(e) => setWallSnap(e.target.checked)}
              />
              Snap to grid (hold <kbd>Alt</kbd> to override)
            </label>
          )}
          {wallTool !== 'none' && wallTool !== 'erase' && (
            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={wallVisible}
                onChange={(e) => setWallVisible(e.target.checked)}
              />
              Players can see this wall
            </label>
          )}
          {wallTool !== 'none' && wallTool !== 'erase' && (
            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={wallBlocks}
                onChange={(e) => setWallBlocks(e.target.checked)}
              />
              Blocks movement
              {!wallBlocks && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  — blocks sight only (a curtain, a hedge, fog)
                </span>
              )}
            </label>
          )}
          {wallTool !== 'none' && (
            <span style={{ color: 'var(--color-danger)' }}>
              Token dragging is off while a wall tool is active.
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Remove every wall on this map? This cannot be undone.')) return
              void run(() => clearWalls(active.id))
            }}
            style={{
              font: 'inherit',
              fontSize: '0.8rem',
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              padding: '2px 8px',
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'var(--color-danger)',
            }}
          >
            Clear walls
          </button>
        </div>
      )}

      {isDm && active && allowTokens && (
        <div style={strip}>
          {selected ? (
            <>
              <strong>{selected.label ?? 'Token'}</strong>
              {/* Answers the question a DM actually has mid-encounter — "can the
                  goblin see them from there?" — which previously needed signing
                  in as somebody else. */}
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={showSight}
                  onChange={(e) => setShowSight(e.target.checked)}
                />
                Show its line of sight
              </label>
              {/* Size in SQUARES, not pixels (0056), so it survives a re-grid.
                  Offered on the selected token rather than in the Maps tab
                  because it is a property of the creature, not of the map.

                  DM-only, and this whole strip already is: since 0057 a player
                  cannot change size even on a token they own and move. Size is
                  what the creature IS, which is the DM's call; movement is what
                  the player chooses. Enforced by a trigger, not by this being
                  hidden. */}
              {/* Which creature this token IS. Only offered for tokens nobody
                  owns — a player's token shows the portrait they chose for their
                  character, and overwriting it with a monster would be the DM
                  redecorating somebody else's piece. */}
              {!selected.owner_user_id && (
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  Creature:
                  <select
                    value={selected.npc_id ?? ''}
                    onChange={(e) => void handleCreature(selected, e.target.value)}
                    style={{ font: 'inherit', fontSize: '0.8rem' }}
                  >
                    <option value="">(plain marker)</option>
                    {creatures.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.portrait_asset_id ? '' : ' — no portrait'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                Size:
                <select
                  value={String(selected.size_cells)}
                  onChange={(e) =>
                    void run(async () => {
                      // RESIZE MOVES THE TOKEN, and it has to.
                      //
                      // Which lattice a token's centre belongs on depends on its
                      // size (snapToken): odd and half sizes sit on cell
                      // CENTRES, even sizes on cell CORNERS. Writing size_cells
                      // alone left a token on the lattice for its OLD size, so a
                      // 1x1 promoted to 4x4 stayed on a cell centre — half a
                      // cell out — and its 4-square body then straddled parts of
                      // FIVE columns and five rows.
                      //
                      // It presented as occupancy being wrong ("the 4x4 acts as
                      // if it was a 5x5 hitbox", owner 2026-09-02). The
                      // occupancy maths was exact; the token was simply not
                      // where the grid says a 4x4 goes.
                      const size = Number(e.target.value)
                      const p = snapToken({ x: selected.x, y: selected.y }, active, size)
                      setSelected(
                        await updateToken(selected.id, {
                          size_cells: size,
                          x: Math.round(p.x),
                          y: Math.round(p.y),
                        }),
                      )
                    })
                  }
                  style={{ font: 'inherit', fontSize: '0.8rem' }}
                >
                  {TOKEN_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Ring (0059). DM-only like size, and enforced by the same
                  trigger: how a piece looks is the DM's call, where it stands is
                  the player's. */}
              {/* Sight range (0062). In SQUARES, so it survives a re-grid — and
                  shown as squares rather than feet because this app has no
                  feet-per-square setting; every table's answer is already baked
                  into how they drew the grid.

                  Blank means unlimited, which is NOT the same as a large number:
                  it is what an unconfigured token has, and it is bounded by
                  walls alone. */}
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                Sight:
                <input
                  type="number"
                  min={0}
                  max={999}
                  step={1}
                  placeholder="∞"
                  value={selected.sight_squares ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    const next = raw === '' ? null : Math.min(Math.max(Number(raw), 0), 999)
                    if (next !== null && !Number.isFinite(next)) return
                    void run(async () =>
                      setSelected(await updateToken(selected.id, { sight_squares: next })),
                    )
                  }}
                  style={{ font: 'inherit', fontSize: '0.8rem', width: '4.5rem' }}
                  aria-label="Sight range in grid squares; blank for unlimited"
                />
                <span style={{ color: 'var(--color-text-muted)' }}>squares</span>
              </label>
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                Ring:
                <select
                  value={selected.ring}
                  onChange={(e) =>
                    void run(async () =>
                      setSelected(await updateToken(selected.id, { ring: e.target.value })),
                    )
                  }
                  style={{ font: 'inherit', fontSize: '0.8rem' }}
                >
                  {TOKEN_RINGS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                Controlled by:
                <select
                  value={selected.owner_user_id ?? ''}
                  onChange={(e) => void handleRelinquish(selected.id, e.target.value || null)}
                  style={{ font: 'inherit', fontSize: '0.8rem' }}
                >
                  <option value="">the DM</option>
                  {members
                    .filter((m) => m.role !== 'dm')
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.username}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                style={{ width: 'auto', color: 'var(--color-danger)' }}
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    await deleteToken(selected.id)
                    setSelected(null)
                  })
                }
              >
                Remove token
              </Button>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>
              Select a token to hand it to a player or remove it.
            </span>
          )}
        </div>
      )}

      {active ? (
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <BattlemapCanvas
            // Remount on switch: tokens, background and drag state all belong to
            // ONE map, and carrying any of it across would briefly draw the last
            // table's tokens on the new picture.
            key={active.id}
            map={active}
            isDm={isDm}
            currentUserId={currentUserId}
            onSelectToken={setSelected}
            allowTokens={allowTokens}
            wallTool={wallTool}
            wallSnap={wallSnap}
            wallVisible={wallVisible}
            wallBlocks={wallBlocks}
            showSight={showSight}
            myCharacter={myCharacter}
          />
        </div>
      ) : (
        <Centered>
          {isDm
            ? 'No map yet. Open the Maps tab to upload a picture, then line its grid up with the image.'
            : 'The DM has not put a map up yet.'}
        </Centered>
      )}
    </div>
  )
}

/**
 * The wall tools, in the order they are offered.
 *
 * Erase last and separated in the eye by being the only destructive one — the
 * three drawing tools are interchangeable, the eraser is not.
 */
const WALL_TOOLS: { value: WallTool; label: string }[] = [
  { value: 'segment', label: 'Line' },
  { value: 'rect', label: 'Room' },
  { value: 'freehand', label: 'Freehand' },
  { value: 'erase', label: 'Erase' },
]

/** Shared toolbar styling, so the strips in both panels line up identically. */
const strip: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--space-3)',
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: 'var(--space-2) var(--space-4)',
  borderBottom: '1px solid var(--color-border)',
  fontSize: '0.8rem',
  flexShrink: 0,
}

/** Shared empty/loading frame, so every state lines up in the same place. */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: '0.9rem',
      }}
    >
      <p style={{ margin: 0, maxWidth: 420 }}>{children}</p>
    </div>
  )
}
