/**
 * BattlemapCanvas — the shared battlemap (Phase 9.1.2).
 *
 * Owns: rendering one map (background image + square-grid overlay) and its
 * tokens, dragging tokens with grid snapping, persisting moves, and reflecting
 * everyone else's moves live.
 *
 * WHY THIS IS DIVS AND NOT A <canvas>. Tokens need to be focusable, keyboard-
 * movable and screen-reader-announceable, and there are tens of them, not
 * thousands. A real canvas would mean reimplementing hit-testing and focus for
 * no gain at this scale. The name is the domain's, not the element's.
 *
 * THE COORDINATE CONTRACT, which is the thing to keep straight: stored token
 * positions are in MAP PIXELS (0048 decision 1) and are independent of how big
 * the map is drawn on screen. The element is laid out at the map's aspect ratio
 * and everything inside is positioned in PERCENT, so the same row renders
 * identically on a phone and a 4K monitor. All conversion lives in ./grid.ts,
 * which is unit-tested; this component does no arithmetic of its own.
 *
 * OPTIMISTIC MOVEMENT. A drag updates local state immediately and writes on
 * release. If the write is refused — RLS, or a lapsed campaign — the token
 * springs back to where it was and an error is shown. Silence would leave a
 * player believing they had moved something they had not, which at a table
 * means arguing about a position the DM cannot see.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FormError } from '../../components/ui'
import { useRealtimeSync, mergeById, type RealtimeEvent } from '../realtime/useRealtimeRefresh'
import { signedUrlFor } from '../media/api'
import { supabase } from '../../lib/supabase'
import { dropPosition, gridLines, snapToken } from './grid'
import { WallLayer, type WallTool } from './WallLayer'
import {
  createToken,
  findFreeCellFor,
  listTokens,
  moveToken,
  createWall,
  deleteWall,
  listWalls,
  signedUrlsForAssets,
  type PlayspaceMap,
  type PlayspaceToken,
  type PlayspaceWall,
  type WallKind,
} from './api'

/**
 * @param map - The map to render. The caller decides which one is live.
 * @param currentUserId - Used to decide which tokens this session may drag.
 *        UI gating only; RLS is the real rule and the optimistic revert below is
 *        what handles the case where the two disagree.
 * @param isDm - A DM may drag every token; a player only their own.
 * @param onSelectToken - Optional: told which token was last clicked, so a DM
 *        toolbar above can act on it.
 * @param allowTokens - Whether tokens may be ADDED here at all. False in
 *        notetaker campaigns, which get the map as shared reference art rather
 *        than as a tactical board (owner decision 2026-08-28). Existing tokens
 *        still render and still drag — turning a map read-only should not make
 *        pieces already on it vanish.
 * @param wallTool - The active wall tool (9.2). Anything but 'none' puts the
 *        wall layer in front of the tokens and suspends token dragging — you
 *        cannot draw a wall and move a piece with the same gesture.
 * @param myCharacter - The caller's character in this campaign, if any. Lets a
 *        player put THEMSELVES on the board when the DM has allowed it; the
 *        token takes the character's name and portrait so the table sees who it
 *        is rather than a coloured dot.
 */
export function BattlemapCanvas({
  map,
  currentUserId,
  isDm,
  onSelectToken,
  allowTokens = true,
  wallTool = 'none',
  myCharacter,
}: {
  map: PlayspaceMap
  currentUserId?: string
  isDm: boolean
  onSelectToken?: (token: PlayspaceToken | null) => void
  allowTokens?: boolean
  wallTool?: WallTool
  myCharacter?: { id: string; name: string; portraitAssetId: string | null } | null
}) {
  const [tokens, setTokens] = useState<PlayspaceToken[]>([])
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  /**
   * asset id → signed URL for token artwork.
   *
   * Kept separate from the token rows because it is derived and short-lived: a
   * signed URL expires, while the token row does not, and merging them would
   * mean a realtime token update could silently drop the picture.
   */
  const [tokenArt, setTokenArt] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Suppress grid snapping while held, for deliberate off-grid placement. */
  const [freePlace, setFreePlace] = useState(false)
  /**
   * Display scale. Purely a rendering concern: stored coordinates are map
   * pixels and never change with zoom, and clientToMap divides by the element's
   * measured rect, so every drag keeps working at any scale with no extra
   * arithmetic. That is the payoff for storing map pixels rather than screen
   * ones.
   */
  const [zoom, setZoom] = useState(1)
  /**
   * The scale at which the map exactly fits the frame's width, so zoom 1 means
   * "fits" rather than "one map pixel per screen pixel".
   *
   * This has to be measured, and it has to exist. The first version sized the
   * element as `width: '100%'` at zoom 1 and `width_px * zoom` otherwise — which
   * meant that on a frame narrower than the map, zooming OUT to 0.9 produced an
   * element LARGER than the fitted one. Two different sizing rules met at zoom 1
   * and did not agree there. One rule, `fitScale * zoom`, cannot have that seam.
   */
  const [fitScale, setFitScale] = useState(1)
  /**
   * The frame's usable size, kept so the pannable area can always be made
   * bigger than it. See PAN_MARGIN and the wrapper in the render.
   */
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 })

  const areaRef = useRef<HTMLDivElement>(null)
  /** The scrolling frame around the map — what wheel-zoom listens on. */
  const frameRef = useRef<HTMLDivElement>(null)
  /**
   * Where to re-centre after a zoom, as a fraction of the map plus the cursor's
   * position in the frame. Held in a ref, not state: it is written during a
   * wheel event and read in the layout effect after the re-render, and making
   * it state would cause a second render for a value nothing draws.
   */
  const anchorRef = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null)

  // The token currently under the pointer, and where it started. The start is
  // kept so a refused write can put it back exactly, rather than approximately.
  const dragRef = useRef<{ id: string; from: { x: number; y: number } } | null>(null)

  /**
   * Held-key movement state.
   *
   * `tokens` is read from a ref rather than from the render closure because the
   * OS repeats a held key far faster than React re-renders: several repeats
   * would each compute their step from the SAME stale position, and the writes
   * would land in whatever order they finished. That is the "jumps several tiles
   * at once" behaviour — it was never one keypress moving several squares, it
   * was several keypresses all moving from the same square and the last one
   * winning.
   *
   * `lastStepAt` paces the repeats evenly, so holding a key walks the token at a
   * steady rate instead of accelerating with the keyboard's own repeat curve.
   * `timer` batches the write: one save when the key is released, not one per
   * square crossed.
   */
  const tokensRef = useRef<PlayspaceToken[]>([])
  tokensRef.current = tokens
  const keyMoveRef = useRef<{
    lastStepAt: number
    timer: ReturnType<typeof setTimeout> | null
    id: string | null
    from: { x: number; y: number } | null
  }>({ lastStepAt: 0, timer: null, id: null, from: null })

  // ------------------------------------------------------------------ zoom

  /**
   * Tracks the frame's width so `fitScale` stays right when the window resizes
   * or a side panel opens. Capped at 1: a small map is shown at its own
   * resolution rather than upscaled into a blur.
   */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => {
      // clientWidth excludes the scrollbar, which is what the map must fit
      // inside; offsetWidth would leave the map permanently a scrollbar too wide
      // and produce a horizontal scrollbar at "fit".
      const usableW = frame.clientWidth - 2 * FRAME_PADDING
      const usableH = frame.clientHeight - 2 * FRAME_PADDING
      if (usableW > 0) setFitScale(Math.min(1, usableW / map.width_px))
      if (usableW > 0 && usableH > 0) setFrameSize({ w: usableW, h: usableH })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [map.width_px])

  /**
   * Wheel zoom: ctrl/cmd + wheel on a mouse, and pinch on a trackpad — which
   * browsers report as a wheel event with `ctrlKey` set, so the two are the
   * same code path.
   *
   * Registered by hand rather than with an onWheel prop because it must be
   * NON-PASSIVE: React attaches wheel listeners passively, and a passive
   * listener cannot preventDefault, so the browser would zoom the whole page
   * instead of the map. A plain wheel with no modifier is left alone and scrolls
   * the frame as usual.
   */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const onWheel = (e: WheelEvent) => {
      // Shift+wheel scrolls sideways. A trackpad and a tilt-wheel mouse do this
      // already; a plain wheel mouse has no other way to reach the sides of a
      // zoomed-in map, and reaching them by dragging is impossible because
      // dragging on the map moves tokens.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        frame.scrollLeft += e.deltaY || e.deltaX
        return
      }
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      // Remember what the cursor is over BEFORE the scale changes, so the same
      // point can be put back under it afterwards. Without this the map drifts
      // away from wherever you were looking, which is the difference between
      // zoom that feels broken and zoom that feels like a map.
      const mapRect = areaRef.current?.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      if (mapRect && mapRect.width > 0 && mapRect.height > 0) {
        anchorRef.current = {
          fx: (e.clientX - mapRect.left) / mapRect.width,
          fy: (e.clientY - mapRect.top) / mapRect.height,
          px: e.clientX - frameRect.left,
          py: e.clientY - frameRect.top,
        }
      }

      // Exponential, so each notch is the same PROPORTIONAL step whatever the
      // current scale — a linear delta crawls when zoomed out and lurches when
      // zoomed in. deltaY is negative when zooming in.
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)))
    }

    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * Puts the anchored point back under the cursor after the zoom has been laid
   * out. useLayoutEffect, not useEffect: this must run before the browser
   * paints, or the map visibly jumps to the new scale and then corrects itself.
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const frame = frameRef.current
    const mapEl = areaRef.current
    if (!anchor || !frame || !mapEl) return
    anchorRef.current = null
    // Measured rects, not offsetLeft/offsetTop. The map now sits inside a
    // centring wrapper, so its offsetParent is not necessarily the frame, and
    // offset* would be measured against the wrong box. Rects are absolute, so
    // this works however the boxes are nested: find where the anchored point
    // has ended up on screen, and move the scroll by the difference.
    const mapRect = mapEl.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const nowX = mapRect.left + anchor.fx * mapRect.width
    const nowY = mapRect.top + anchor.fy * mapRect.height
    frame.scrollLeft += nowX - (frameRect.left + anchor.px)
    frame.scrollTop += nowY - (frameRect.top + anchor.py)
  }, [zoom])

  /**
   * Scrolls the pan margin out of the way on first layout, so the map opens
   * centred rather than tucked into the top-left corner of its own padding.
   * Runs once per map, keyed on the fit measurement finishing.
   */
  const centredRef = useRef(false)
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || centredRef.current || frameSize.w === 0) return
    centredRef.current = true
    frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2
    frame.scrollTop = (frame.scrollHeight - frame.clientHeight) / 2
  }, [frameSize.w])

  // ---------------------------------------------------------------- loading

  useEffect(() => {
    let active = true
    setLoading(true)
    listTokens(map.id)
      .then((t) => {
        if (active) setTokens(t)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load tokens.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [map.id])

  // Background image. media_assets rows hold a storage PATH in a private bucket,
  // so it must be exchanged for a short-lived signed URL. Re-run when the asset
  // changes; the URL's own expiry is an hour, far longer than a session's view
  // of one map.
  useEffect(() => {
    let active = true
    if (!map.background_asset_id) {
      setBgUrl(null)
      return
    }
    void (async () => {
      const { data } = await supabase
        .from('media_assets')
        .select('storage_path')
        .eq('id', map.background_asset_id!)
        .maybeSingle()
      if (!active) return
      if (!data?.storage_path) {
        setBgUrl(null)
        return
      }
      const url = await signedUrlFor(data.storage_path)
      if (active) setBgUrl(url)
    })()
    return () => {
      active = false
    }
  }, [map.background_asset_id])

  // Resolve artwork whenever the SET of images on the map changes — not on
  // every token update, or dragging one token would re-sign every URL. The key
  // is the sorted id list, so a move (which changes no image) does no work.
  const artKey = [...new Set(tokens.map((t) => t.image_asset_id).filter(Boolean))].sort().join(',')
  useEffect(() => {
    let live = true
    const ids = artKey ? artKey.split(',') : []
    if (ids.length === 0) {
      setTokenArt(new Map())
      return
    }
    signedUrlsForAssets(ids)
      .then((m) => live && setTokenArt(m))
      // A failure leaves plain coloured circles, which is a degraded token, not
      // a lost one. The map must not fail to draw because art would not load.
      .catch(() => live && setTokenArt(new Map()))
    return () => {
      live = false
    }
  }, [artKey])

  // --------------------------------------------------------------- walls

  // DM-only by RLS (0061): for anyone else this resolves to an empty array, so
  // the layer renders nothing without needing its own role check.
  const [walls, setWalls] = useState<PlayspaceWall[]>([])
  useEffect(() => {
    let live = true
    listWalls(map.id)
      .then((w) => live && setWalls(w))
      .catch(() => live && setWalls([]))
    return () => {
      live = false
    }
  }, [map.id])

  // Live, so a wall drawn mid-session appears on the DM's second window too.
  // Players receive no events for this table at all — RLS gates realtime as
  // well as reads, which is what makes 0061 hold end to end.
  const onWallEvent = useCallback((e: RealtimeEvent<PlayspaceWall>) => {
    setWalls((prev) =>
      mergeById(prev, e as RealtimeEvent<{ id: string }>, (raw) => raw as unknown as PlayspaceWall),
    )
  }, [])
  useRealtimeSync<PlayspaceWall>('playspace_walls', onWallEvent, `map_id=eq.${map.id}`)

  /** Persists a finished wall, optimistically. */
  async function handleCreateWall(kind: WallKind, points: [number, number][], closed: boolean) {
    try {
      const row = await createWall(map.id, kind, points, closed)
      setWalls((prev) => (prev.some((w) => w.id === row.id) ? prev : [...prev, row]))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that wall.')
    }
  }

  /** Removes a wall the eraser touched. */
  async function handleEraseWall(wallId: string) {
    const previous = walls
    // Optimistic: the wall vanishes under the cursor, which is what an eraser
    // should feel like. Restored wholesale if the delete is refused.
    setWalls((prev) => prev.filter((w) => w.id !== wallId))
    try {
      await deleteWall(wallId)
    } catch (e) {
      setWalls(previous)
      setError(e instanceof Error ? e.message : 'Could not remove that wall.')
    }
  }

  // ------------------------------------------------------------- realtime

  // Per-ROW merge rather than a re-fetch: a token being dragged by someone else
  // emits a change on release, and re-fetching the list would drop a drag this
  // session had in flight. Filtered server-side to this map so a campaign with
  // five maps does not push four maps' worth of noise at every client.
  const onRealtime = useCallback((e: RealtimeEvent<PlayspaceToken>) => {
    setTokens((prev) => {
      // Ignore an echo of the token THIS session is dragging: our optimistic
      // position is newer than the row we are being told about, and applying it
      // would make the token jump backwards under the pointer.
      const dragging = dragRef.current
      if (dragging && (e.new as { id?: string })?.id === dragging.id) return prev
      return mergeById(prev, e as RealtimeEvent<{ id: string }>, (raw) => raw as unknown as PlayspaceToken)
    })
  }, [])

  useRealtimeSync<PlayspaceToken>('playspace_tokens', onRealtime, `map_id=eq.${map.id}`)

  // The map row itself can change under us — the DM adjusting the grid, or
  // swapping the background. The parent owns which map is live, so this only
  // needs to refresh what is drawn, which it does by re-reading the prop.
  // (No hook here: the parent subscribes to playspace_maps and passes a new row.)

  // ----------------------------------------------------------------- drag

  /** May this session drag this token? UI gating; RLS is the real gate. */
  const canDrag = useCallback(
    (t: PlayspaceToken) =>
      // A wall tool takes over the pointer entirely. Without this, starting a
      // wall on top of a token would drag the token instead — and the DM would
      // discover it only after letting go somewhere else.
      wallTool === 'none' && (isDm || (!!currentUserId && t.owner_user_id === currentUserId)),
    [isDm, currentUserId, wallTool],
  )

  /**
   * Pointer down on a token: capture the pointer so the drag survives the
   * cursor leaving the token (which it always does — the token moves under it),
   * and remember where it started for a possible revert.
   */
  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, token: PlayspaceToken) {
    setSelectedId(token.id)
    onSelectToken?.(token)
    if (!canDrag(token)) return
    // preventDefault stops the browser starting a text selection or image drag
    // — but it ALSO suppresses the focus a click would normally give the
    // button, which is why arrow-key movement did nothing after clicking a
    // token (QA 2026-08-28, step 18). Focus is therefore set explicitly.
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: token.id, from: { x: token.x, y: token.y } }
  }

  /** Pointer move: optimistic local update only. Nothing is written mid-drag. */
  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    const rect = areaRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    // The token's own half-width, so it stops fully on the map instead of
    // hanging half over the edge and staying there (reported 2026-09-01).
    const size = tokens.find((t) => t.id === drag.id)?.size_cells ?? 1
    const p = dropPosition(
      e.clientX,
      e.clientY,
      rect,
      map,
      !freePlace,
      (size * map.grid_size) / 2,
      size,
    )
    setTokens((prev) => prev.map((t) => (t.id === drag.id ? { ...t, x: p.x, y: p.y } : t)))
  }

  /**
   * Pointer up: persist. One write per drag, not one per pixel — a move emits a
   * single realtime event, which is what keeps other clients smooth.
   */
  async function handlePointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    const moved = tokens.find((t) => t.id === drag.id)
    if (!moved) return
    if (moved.x === drag.from.x && moved.y === drag.from.y) return

    try {
      const row = await moveToken(drag.id, moved.x, moved.y)
      if (!row) {
        // Zero rows matched: RLS refused, or the campaign has lapsed to
        // read-only. Both are silent at the API level, so say so here.
        revert(drag.id, drag.from)
        setError(
          'That move was not saved — you may not move this token, or the campaign is read-only.',
        )
      } else {
        setError(null)
      }
    } catch (err) {
      revert(drag.id, drag.from)
      setError(err instanceof Error ? err.message : 'Could not save that move.')
    }
  }

  /** Puts a token back where a refused drag started. */
  function revert(id: string, from: { x: number; y: number }) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, ...from } : t)))
  }

  /**
   * Keyboard movement: one grid cell per arrow press, so the map is usable
   * without a pointer. Same persistence path as a drag, including the revert.
   */
  function handleKeyDown(e: React.KeyboardEvent, token: PlayspaceToken) {
    const step = map.grid_size
    const delta =
      e.key === 'ArrowLeft' ? { x: -step, y: 0 } :
      e.key === 'ArrowRight' ? { x: step, y: 0 } :
      e.key === 'ArrowUp' ? { x: 0, y: -step } :
      e.key === 'ArrowDown' ? { x: 0, y: step } : null
    if (!delta || !canDrag(token)) return
    // Always, even when the step is skipped below, or the browser scrolls the
    // map frame underneath the token you are trying to walk.
    e.preventDefault()

    const state = keyMoveRef.current
    const now = performance.now()
    if (now - state.lastStepAt < KEY_STEP_MS) return
    state.lastStepAt = now

    // The CURRENT position, not the one from the render this handler closed
    // over. See the comment on tokensRef.
    const live = tokensRef.current.find((t) => t.id === token.id) ?? token
    // Remember where this run of movement began, so a refused write puts the
    // token back where it started rather than one square short of it.
    if (state.id !== token.id || state.from === null) {
      state.id = token.id
      state.from = { x: live.x, y: live.y }
    }

    const bounded = snapToken({ x: live.x + delta.x, y: live.y + delta.y }, map, live.size_cells)
    const next = { x: Math.round(bounded.x), y: Math.round(bounded.y) }
    if (next.x === live.x && next.y === live.y) return
    setTokens((prev) => prev.map((t) => (t.id === token.id ? { ...t, ...next } : t)))

    // One write when the movement settles. Writing per square would emit a
    // realtime event per square, and everyone else's token would stutter across
    // the map instead of arriving where it stopped.
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void commitKeyMove(token.id), KEY_COMMIT_MS)
  }

  /**
   * Saves the position a held key walked the token to.
   * @param id - The token that moved.
   */
  async function commitKeyMove(id: string) {
    const state = keyMoveRef.current
    const from = state.from
    state.timer = null
    state.id = null
    state.from = null
    const moved = tokensRef.current.find((t) => t.id === id)
    if (!moved || !from) return
    if (moved.x === from.x && moved.y === from.y) return
    try {
      const row = await moveToken(id, moved.x, moved.y)
      if (!row) {
        revert(id, from)
        setError('That move was not saved — you may not move this token, or the campaign is read-only.')
      } else {
        setError(null)
      }
    } catch {
      revert(id, from)
      setError('Could not save that move.')
    }
  }

  // Holding Alt places off-grid. Bound to the window rather than the map so
  // releasing the key outside the map still turns snapping back on.
  // Flush a pending keyboard move if the component goes away mid-walk, so a
  // move is never lost to a tab switch.
  useEffect(() => {
    const state = keyMoveRef.current
    return () => {
      if (state.timer) {
        clearTimeout(state.timer)
        if (state.id) void commitKeyMove(state.id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setFreePlace(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setFreePlace(false) }
    const blur = () => setFreePlace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // ----------------------------------------------------------- adding

  /**
   * Places a new token on the nearest FREE square to the centre.
   *
   * Lives here rather than in a toolbar above because this is where the token
   * list is: choosing a free cell needs to know what is already on the board,
   * and passing the list upward purely to compute a position would put the same
   * data in two places.
   *
   * @param fields - Owner/character/label for the new token.
   */
  async function addToken(fields: {
    owner_user_id?: string | null
    character_id?: string | null
    npc_id?: string | null
    image_asset_id?: string | null
    label: string
  }) {
    try {
      const at = findFreeCellFor(map, tokens)
      const row = await createToken(map.id, { ...fields, x: at.x, y: at.y, size_px: map.grid_size })
      // Merged immediately rather than waiting for the realtime echo, so two
      // quick clicks do not both compute the same "free" square.
      setTokens((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that token.')
    }
  }

  /** Has this player already put their character on the board? */
  const myTokenPlaced = !!myCharacter && tokens.some((t) => t.character_id === myCharacter.id)

  // ---------------------------------------------------------------- render

  // Recomputed only when the geometry changes, not on every drag frame.
  const lines = useMemo(() => gridLines(map), [map])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {error && (
        <div style={{ padding: 'var(--space-2) var(--space-4)' }}>
          <FormError message={error} />
        </div>
      )}

      {/* The map sits in a scrollable frame and is sized by aspect-ratio, so it
          fills the space without ever distorting the picture — a stretched
          battlemap would put every token in the wrong place relative to the
          grid printed on the image. */}
      <div
        ref={frameRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: FRAME_PADDING,
          // NOT `display: grid` + `place-items: center`, which is what this was.
          // Centring a grid/flex child that OVERFLOWS its scroll container makes
          // the overflow on the start side unreachable: the browser clips it and
          // scrollLeft cannot go below 0, so the left edge of a zoomed-in map
          // could not be scrolled to at all. Centring with `margin: auto` on the
          // child (below) centres it while it fits and produces normal,
          // fully-scrollable overflow once it does not.
          display: 'block',
        }}
      >
        {/* The pannable surface.

            It is always LARGER than the frame — max(map, frame) plus a margin on
            every side — so there is somewhere to scroll to at any zoom. Without
            it, zooming out until the map fits leaves the frame with nothing to
            scroll and the map nailed to the centre, which is what the owner hit
            on 2026-09-01: "unable to scroll while zoomed out further than the
            size of the map".

            Centring happens HERE, on a wrapper that does not scroll, rather than
            on the frame. That distinction is the whole fix: centring the child of
            a scroll container clips the start-side overflow, centring inside a
            non-scrolling wrapper does not. */}
        <div
          style={{
            width: Math.max(map.width_px * fitScale * zoom, frameSize.w) + 2 * PAN_MARGIN,
            height: Math.max(map.height_px * fitScale * zoom, frameSize.h) + 2 * PAN_MARGIN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
        <div
          ref={areaRef}
          onPointerMove={handlePointerMove}
          onPointerUp={() => void handlePointerUp()}
          onPointerCancel={() => void handlePointerUp()}
          style={{
            position: 'relative',
            // ONE sizing rule at every scale: fitted size × zoom. The aspect
            // ratio does the rest — a stretched battlemap would put every token
            // in the wrong place relative to the grid printed on the picture.
            width: map.width_px * fitScale * zoom,
            flexShrink: 0,
            aspectRatio: `${map.width_px} / ${map.height_px}`,
            background: bgUrl ? `url(${bgUrl}) center/100% 100% no-repeat` : 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            // Stops the browser panning/zooming the page mid-drag on touch.
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {/* No background yet — say which state this is rather than showing an
              empty rectangle that could equally be a failed image load. */}
          {!bgUrl && !loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', pointerEvents: 'none' }}>
              {map.background_asset_id ? 'Background image unavailable.' : 'No background image yet.'}
            </div>
          )}

          {/* Grid overlay. Percent offsets so it tracks the map at any display
              size. Rendered as elements rather than a repeating gradient so the
              lines land on exact cell boundaries instead of accumulating
              rounding error across a wide map. `lines` is null when the grid
              would be too dense to be useful — see gridLines(). */}
          {lines && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
              {lines.vertical.map((x) => (
                <div key={`v${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(x / map.width_px) * 100}%`, borderLeft: '1px solid rgba(255,255,255,0.18)' }} />
              ))}
              {lines.horizontal.map((y) => (
                <div key={`h${y}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(y / map.height_px) * 100}%`, borderTop: '1px solid rgba(255,255,255,0.18)' }} />
              ))}
            </div>
          )}

          {tokens.map((t) => {
            const draggable = canDrag(t)
            // Resolved once per token per render: it decides the ring, the
            // background and whether the initials are drawn, and those three
            // must never disagree.
            const art = t.image_asset_id ? tokenArt.get(t.image_asset_id) : undefined
            // 'auto' keeps the 0058 rule — ring only when there is nothing else
            // identifying the token. 'on'/'off' are the DM's deliberate override
            // (0059), e.g. ringing an illustrated token to mark a side.
            const ring = t.ring === 'on' || (t.ring !== 'off' && !art)
            return (
              <button
                key={t.id}
                type="button"
                onPointerDown={(e) => handlePointerDown(e, t)}
                onKeyDown={(e) => handleKeyDown(e, t)}
                // Names the token AND says whether this session may move it, so
                // the distinction is not carried by the cursor alone.
                aria-label={`${t.label ?? 'Token'}${draggable ? '' : ' (not yours)'}`}
                title={t.label ?? undefined}
                style={{
                  position: 'absolute',
                  // Percent of the map, so a token stays on the same square
                  // whatever size the map is drawn at.
                  left: `${(t.x / map.width_px) * 100}%`,
                  top: `${(t.y / map.height_px) * 100}%`,
                  // Size in SQUARES × the map's CURRENT grid (0056), never the
                  // stored size_px. Changing the grid therefore resizes every
                  // token instantly, for everyone, with no writes at all — and a
                  // token can never be a size that no longer matches the squares
                  // it is standing on.
                  width: `${((map.grid_size * t.size_cells) / map.width_px) * 100}%`,
                  aspectRatio: '1',
                  // Centred on its coordinate — the same convention snapToGrid
                  // assumes when it snaps to cell centres.
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  // The colour ring identifies a token that has no picture. Art
                  // identifies itself, so ringing it just puts a coloured band
                  // over the edges of the face.
                  //
                  // A soft shadow takes over the ring's OTHER job — separating
                  // the token from the map underneath — which a light portrait
                  // on a light battlemap otherwise loses.
                  border: ring ? `2px solid ${t.color}` : 'none',
                  // The shadow does the ring's OTHER job — lifting the token off
                  // the map — so it is applied whenever the ring is absent, not
                  // only when there is art. A ringless plain marker on a busy
                  // battlemap needs it just as much.
                  ...(ring ? null : { boxShadow: '0 1px 4px rgba(0,0,0,0.55)' }),
                  ...(art
                    ? {
                        // `cover` on a circular button crops a rectangular
                        // portrait to the middle, which is where a face is;
                        // `contain` would letterbox it.
                        backgroundImage: `url(${art})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : null),
                  outline: selectedId === t.id ? '2px solid var(--color-accent)' : 'none',
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  overflow: 'hidden',
                  padding: 0,
                  cursor: draggable ? 'grab' : 'default',
                  // A token you cannot move is still readable and clickable —
                  // dimming it would hide the DM's monsters from the players who
                  // most need to see them.
                  touchAction: 'none',
                }}
              >
                {/* The initials are the FALLBACK, not a caption: printed over
                    artwork they would obscure the face this feature exists to
                    show. The full name is in the title/aria-label either way. */}
                {!art && t.label?.slice(0, 3)}
              </button>
            )
          })}

          {/* LAST in the DOM, deliberately: siblings paint in document order, so
              rendering this before the tokens would put walls underneath them —
              which is exactly the wrong way round on a crowded map, where the
              wall you are checking is the one behind a monster. It is
              click-through unless a tool is active, so sitting on top costs
              nothing. */}
          <WallLayer
            map={map}
            walls={walls}
            tool={wallTool}
            onCreate={(k, p, c) => void handleCreateWall(k, p, c)}
            onErase={(id) => void handleEraseWall(id)}
          />
        </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          flexShrink: 0,
        }}
      >
        {/* Zoom. Buttons rather than only a wheel gesture: a trackpad pinch is
            not discoverable, and ctrl+wheel is the browser's own zoom on some
            platforms. The percentage is shown because "am I zoomed in?" is
            otherwise guessable only by comparing to memory. */}
        <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <ZoomButton label="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>−</ZoomButton>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Reset zoom to fit"
            style={{ ...zoomBtn, minWidth: '3.5rem' }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <ZoomButton label="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>+</ZoomButton>
        </span>
        {allowTokens && isDm && (
          <button type="button" style={zoomBtn} onClick={() => void addToken({ label: 'New' })}>
            Add token
          </button>
        )}

        {/* A player's own character, only where the DM has allowed it (0055).
            Hidden once placed rather than disabled: a second token for the same
            character is a mistake, not a feature, and the board is the only
            place it would show up. */}
        {allowTokens && !isDm && myCharacter && !myTokenPlaced && (
          <button
            type="button"
            style={zoomBtn}
            onClick={() =>
              void addToken({
                owner_user_id: currentUserId,
                character_id: myCharacter.id,
                // The portrait the player chose for their character, COPIED onto
                // the token (0058) so every member can see it — they cannot read
                // each other's character rows, but they can read the campaign's
                // media.
                image_asset_id: myCharacter.portraitAssetId,
                label: myCharacter.name.slice(0, 60),
              })
            }
          >
            Put {myCharacter.name} on the map
          </button>
        )}

        <span>
          Drag a token to move it{isDm ? '' : ' — you can move only your own'}. Arrow keys move one
          square. Hold <kbd>Alt</kbd> to place off-grid. Pinch or <kbd>Ctrl</kbd>+scroll to zoom;{' '}
          <kbd>Shift</kbd>+scroll to pan sideways.
        </span>
      </div>
    </div>
  )
}

/**
 * Keeps zoom inside a useful range.
 *
 * The lower bound stops the map shrinking to something no token can be hit on;
 * the upper bound stops a 20000px map (the schema's maximum) being blown up to
 * a canvas the browser will not composite.
 * @param z - Proposed scale.
 */
function clampZoom(z: number): number {
  return Math.min(Math.max(z, 0.25), 4)
}

/**
 * Padding around the map inside its scrolling frame, in pixels.
 *
 * A plain number rather than the usual CSS variable because `fitScale` has to
 * subtract it from the measured width, and reading a var at runtime to do
 * arithmetic with it is more machinery than this is worth. Kept as one constant
 * so the measurement and the style can never disagree — if they did, "fit"
 * would be a scrollbar's width out.
 */
const FRAME_PADDING = 12

/**
 * Extra scrollable space around the map, in pixels.
 *
 * Exists so the map can be panned at ANY zoom, including when it is smaller than
 * the frame and would otherwise sit immovably in the middle with nothing to
 * scroll. It also lets a zoomed-in map be dragged past its own edge, so a token
 * near the border is not stuck against the side of the screen.
 */
const PAN_MARGIN = 160

/**
 * Minimum time between two steps of a HELD arrow key, in milliseconds.
 *
 * The operating system's own repeat rate is fast and accelerates, which made a
 * held key skip several squares in a blink. Pacing the steps ourselves makes
 * holding a key walk the token at a readable, even rate — about eight squares a
 * second, which is quick without being impossible to stop on the square you
 * wanted.
 */
const KEY_STEP_MS = 120

/**
 * How long to wait after the last step before saving, in milliseconds.
 *
 * Long enough to batch a whole held-key walk into one write — a write per square
 * would emit a realtime event per square, and everyone else's copy of the token
 * would stutter across the map rather than arriving where it stopped.
 */
const KEY_COMMIT_MS = 300

const zoomBtn: React.CSSProperties = {
  font: 'inherit',
  fontSize: '0.75rem',
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid currentColor',
  borderRadius: 'var(--radius)',
  padding: '1px 8px',
  lineHeight: 1.6,
}

/** One zoom control, so the two buttons cannot drift apart in styling. */
function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={zoomBtn}>
      {children}
    </button>
  )
}
