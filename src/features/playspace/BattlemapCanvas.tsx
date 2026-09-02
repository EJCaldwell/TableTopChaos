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
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FormError } from '../../components/ui'
import { useRealtimeSync, mergeById, type RealtimeEvent } from '../realtime/useRealtimeRefresh'
import { signedUrlFor } from '../media/api'
import { supabase } from '../../lib/supabase'
import { combinedDelta, dropPosition, gridLines, isSpaceFree, movementDelta, snapToken } from './grid'
import { pointInPolygon, tokenTouchesVision } from './vision'
import { tokenBackground } from './tokenStyle'
import { WallLayer, type WallTool } from './WallLayer'
import { FogLayer } from './FogLayer'
import { SightPreview } from './SightPreview'
import {
  createToken,
  findFreeCellFor,
  listTokens,
  moveToken,
  createWall,
  deleteWall,
  fetchVision,
  listWalls,
  signedUrlsForAssets,
  type PlayspaceMap,
  type PlayspaceToken,
  type PlayspaceWall,
  type VisionResult,
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
 * @param wallSnap - Whether Line and Room snap to grid intersections.
 * @param wallVisible - Whether newly drawn walls are visible to players (0066).
 * @param wallBlocks - Whether newly drawn walls stop movement (0067).
 * @param showSight - DM only: draw the selected token's line of sight.
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
  wallSnap = true,
  wallVisible = false,
  wallBlocks = true,
  showSight = false,
  myCharacter,
}: {
  map: PlayspaceMap
  currentUserId?: string
  isDm: boolean
  onSelectToken?: (token: PlayspaceToken | null) => void
  allowTokens?: boolean
  wallTool?: WallTool
  wallSnap?: boolean
  wallVisible?: boolean
  wallBlocks?: boolean
  showSight?: boolean
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
  // Unique per instance: two maps mounted at once would otherwise share a
  // clipPath id, and the second would silently use the first one's shape.
  const tokenClipId = `tokclip-${useId().replace(/:/g, '')}`
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
  /**
   * The drag in progress, if any.
   *
   * `origin` is where the pointer went down, in SCREEN coordinates, and `armed`
   * says whether it has travelled far enough to count as a drag rather than a
   * click (DRAG_THRESHOLD_PX). Until it is armed the token does not move at all,
   * which is what makes clicking the edge of a token select it instead of
   * nudging it.
   */
  const dragRef = useRef<{
    id: string
    from: { x: number; y: number }
    origin: { x: number; y: number }
    armed: boolean
  } | null>(null)

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

  /**
   * Movement keys currently held, so Left+Up walks diagonally.
   *
   * A ref rather than state: it changes on every key event and nothing renders
   * from it, so making it state would re-render the whole map twice per
   * keystroke for no visible difference.
   *
   * Keyed by `code` where there is one and `key` otherwise, so the same physical
   * key cannot be counted twice — and so a keyup can reliably remove what its
   * keydown added, which `key` alone cannot guarantee when a modifier changes
   * mid-press.
   */
  const heldKeysRef = useRef<Map<string, { key: string; code: string }>>(new Map())
  /** Pending first step of a fresh key press — see the grace window below. */
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      const row = await createWall(map.id, kind, points, closed, wallVisible, wallBlocks)
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

  // ----------------------------------------------------------------- fog

  /**
   * What this session may see, as returned by the server.
   *
   * `null` means "not asked yet". Distinguished from "asked, sees nothing"
   * because the two must render differently: the second fogs the map, the first
   * must not — flashing a fully black map for a moment on every load would be
   * both ugly and, on a map with vision OFF, wrong.
   */
  const [vision, setVision] = useState<VisionResult | null>(null)

  /**
   * Recomputes vision.
   *
   * Called on load, when the map changes, and — debounced — whenever a token
   * moves. It is a network round trip per call, so it is deliberately NOT called
   * per drag frame; `commitVision` below is the debounce.
   */
  const refreshVision = useCallback(async (at?: { x: number; y: number }) => {
    const result = await fetchVision(map.id, at)
    setVision(result)
  }, [map.id])

  /**
   * Asks the server what the caller would see FROM a position, before the move
   * that puts them there has been written.
   *
   * WHY THIS EXISTS. Fog visibly trailed a player's own movement while the DM's
   * sight preview updated instantly, and the difference was never the maths —
   * the DM computes locally from walls they already hold, whereas a player must
   * ask the server, because they are deliberately never sent the walls (0061).
   * The old own-move path could not be made faster in principle: it waited for
   * the WRITE, then asked, because the server computes from the stored position.
   * Two sequential round trips, by construction.
   *
   * Sending the intended position removes the first one. It is speculative — the
   * write may still be refused — but a refusal already reverts the token, and the
   * authoritative refresh that follows every commit corrects the fog with it.
   *
   * Throttled rather than debounced: a debounce would deliver nothing until the
   * drag STOPPED, which is exactly the moment this exists to pre-empt.
   */
  const previewTimer = useRef(0)
  const previewVision = useCallback(
    (at: { x: number; y: number }) => {
      const now = performance.now()
      if (now - previewTimer.current < VISION_PREVIEW_MS) return
      previewTimer.current = now
      void refreshVision(at)
    },
    [refreshVision],
  )

  useEffect(() => {
    void refreshVision()
  }, [refreshVision])

  // Any token movement can change what is visible — a player's own token moves
  // their viewpoint, and the DM moving a monster does not, but the client cannot
  // tell which without knowing the walls. Recomputing on any token change is the
  // honest and cheap-to-reason-about rule.
  //
  // Debounced hard: a drag ends in one write, but a held arrow key or another
  // player's drag can produce several in quick succession, and each would
  // otherwise be a round trip.
  const visionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Queues a vision recompute.
   *
   * @param own - True when THIS session caused the change. Own moves use a much
   *        shorter delay: the fog opening is part of the move you just made, and
   *        a quarter-second lag reads as the app being slow. Somebody else's
   *        move has no such expectation, and their moves arrive in bursts, so
   *        those stay collapsed into one round trip.
   */
  const scheduleVision = useCallback(
    (own = false) => {
      const wait = own ? VISION_OWN_MOVE_MS : VISION_DEBOUNCE_MS
      if (visionTimer.current) clearTimeout(visionTimer.current)
      visionTimer.current = setTimeout(() => void refreshVision(), wait)
    },
    [refreshVision],
  )
  useEffect(() => () => {
    if (visionTimer.current) clearTimeout(visionTimer.current)
  }, [])

  /**
   * A slow heartbeat while a player is looking at a fogged map.
   *
   * Two jobs, and the second is the one that shows:
   *
   *  1. A safety net. Vision is recomputed on token changes; if a realtime event
   *     is ever missed — a dropped socket, a tab asleep — the fog would stay
   *     stale indefinitely. A minute is far too slow to be a mechanism and
   *     exactly right as a backstop.
   *  2. It keeps the Edge Function's isolate warm. A cold start measured over a
   *     second, against ~100ms warm, and that cost lands precisely on the first
   *     move after a lull — which at a table is the start of everyone's turn.
   *
   * Only for a player on a fogged map: a DM never calls this function, and a map
   * without vision has nothing to recompute.
   */
  useEffect(() => {
    if (!vision?.visionEnabled) return
    if ('isDm' in vision && vision.isDm) return
    const id = setInterval(() => void refreshVision(), VISION_HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [vision?.visionEnabled, vision && 'isDm' in vision && vision.isDm, refreshVision])

  /**
   * A fast poll so a player sees a wall appear or disappear as the DM draws it.
   *
   * WHY A POLL AND NOT REALTIME, which is what everything else here uses. Walls
   * are DM-only (0061) and realtime enforces RLS, so a player's socket receives
   * NO wall events at all — not the hidden ones, which is correct, and not the
   * visible ones either, which is the problem. Subscribing a player to
   * `playspace_walls` would mean granting them a read over the table, undoing
   * the decision the whole vision Edge Function exists to protect. Polling costs
   * two requests a second per player and leaks nothing; the alternative is
   * cheaper and wrong.
   *
   * Paused while the tab is hidden — a backgrounded player is not watching the
   * DM draw, and a table with six players in six tabs should not spend the whole
   * session polling.
   *
   * Also skipped while this session is MOVING something, hence the ref check:
   * a poll landing mid-drag would overwrite the speculative polygon with one
   * computed from the token's old stored position, and the fog would flicker
   * backwards under the player's hand.
   */
  useEffect(() => {
    if (!vision?.visionEnabled) return
    if ('isDm' in vision && vision.isDm) return
    const id = setInterval(() => {
      if (document.hidden) return
      if (dragRef.current || heldKeysRef.current.size > 0) return
      void refreshVision()
    }, WALL_POLL_MS)
    return () => clearInterval(id)
  }, [vision?.visionEnabled, vision && 'isDm' in vision && vision.isDm, refreshVision])

  // ------------------------------------------------------------- realtime

  // Per-ROW merge rather than a re-fetch: a token being dragged by someone else
  // emits a change on release, and re-fetching the list would drop a drag this
  // session had in flight. Filtered server-side to this map so a campaign with
  // five maps does not push four maps' worth of noise at every client.
  const onRealtime = useCallback((e: RealtimeEvent<PlayspaceToken>) => {
    // Somebody moved something: what this session can see may have changed.
    scheduleVision()
    setTokens((prev) => {
      // Ignore an echo of the token THIS session is dragging: our optimistic
      // position is newer than the row we are being told about, and applying it
      // would make the token jump backwards under the pointer.
      const dragging = dragRef.current
      if (dragging && (e.new as { id?: string })?.id === dragging.id) return prev
      return mergeById(prev, e as RealtimeEvent<{ id: string }>, (raw) => raw as unknown as PlayspaceToken)
    })
  }, [scheduleVision])

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
    dragRef.current = {
      id: token.id,
      from: { x: token.x, y: token.y },
      origin: { x: e.clientX, y: e.clientY },
      armed: false,
    }
  }

  /** Pointer move: optimistic local update only. Nothing is written mid-drag. */
  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    const rect = areaRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    // Below the threshold this is still a click, and a click must not move
    // anything. Once armed it STAYS armed for the rest of the press — otherwise
    // dragging back towards the start would disarm mid-gesture and strand the
    // token.
    if (!drag.armed) {
      const dx = e.clientX - drag.origin.x
      const dy = e.clientY - drag.origin.y
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      drag.armed = true
    }
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
    // Refuse the step rather than taking it and springing back. The token simply
    // stops against the wall and stays under the pointer's last legal square,
    // which is what dragging a piece across a table feels like — the earlier
    // behaviour let it through and yanked it back, which reads as a glitch even
    // though the server was right.
    if (!isMoveAllowed(p, drag.id, size)) return
    setTokens((prev) => prev.map((t) => (t.id === drag.id ? { ...t, x: p.x, y: p.y } : t)))
    // Ask what this square looks like BEFORE the move is written, so the fog
    // opens with the token rather than a round trip behind it.
    previewVision(p)
  }

  /**
   * Pointer up: persist. One write per drag, not one per pixel — a move emits a
   * single realtime event, which is what keeps other clients smooth.
   */
  async function handlePointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    // An unarmed press was a click: it selected the token and moved nothing, so
    // there is nothing to write.
    if (!drag.armed) return
    const moved = tokens.find((t) => t.id === drag.id)
    if (!moved) return
    if (moved.x === drag.from.x && moved.y === drag.from.y) return

    try {
      const row = await moveToken(drag.id, moved.x, moved.y)
      // Our own move: recompute on the short delay rather than waiting for the
      // realtime echo, so the fog opens as the token lands rather than a beat
      // later.
      scheduleVision(true)
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

  /**
   * May this session move a token to this point?
   *
   * True whenever there is no fog, or the caller is the DM (exempt from wall
   * collision by 0063). Otherwise the point must lie in one of the caller's own
   * movement polygons.
   *
   * This is a CONVENIENCE, not the rule. The rule is the database trigger, which
   * also binds a request this client never made. If the two ever disagree, the
   * server wins and the revert path below still exists to handle it.
   *
   * @param p - The candidate centre, in map pixels.
   * @param movingId - The token being moved. Excluded from the occupancy check,
   *        or it would collide with its own current position and nothing could
   *        ever move.
   * @param sizeCells - Its size in squares, so a 4x4 monster is refused a square
   *        that something is standing anywhere inside — not merely one whose
   *        centre is taken.
   */
  function isMoveAllowed(p: { x: number; y: number }, movingId: string, sizeCells: number): boolean {
    // Occupancy applies to EVERYONE, DM included. Vision does not: a DM is
    // exempt from walls (0063) and has no movement polygons at all. The two
    // rules are independent and this is the only place that is obvious.
    //
    // The DM is deliberately NOT exempt from occupancy. Walls are a fiction the
    // DM authors and may cross; two creatures in one square is not a fiction,
    // it is a mistake, and one nobody notices until initiative order stops
    // making sense.
    const others = tokensRef.current.filter((t) => t.id !== movingId)
    if (!isSpaceFree(p, sizeCells, others, map.grid_size)) return false
    if (!movePolys) return true
    return movePolys.some((poly) => pointInPolygon(p, poly))
  }

  /** Puts a token back where a refused drag started. */
  function revert(id: string, from: { x: number; y: number }) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, ...from } : t)))
  }

  /**
   * Keyboard movement: one grid cell per arrow press, so the map is usable
   * without a pointer. Same persistence path as a drag, including the revert.
   */
  /**
   * Takes one step in the direction of everything currently held.
   *
   * Separated from the key handler so the FIRST step of a press can be delayed
   * (see handleKeyDown) while later steps happen immediately.
   *
   * @param token - The token being walked. Its position is re-read live from
   *        tokensRef, since a held key repeats faster than React re-renders.
   */
  function stepHeld(token: PlayspaceToken) {
    const cells = combinedDelta([...heldKeysRef.current.values()])
    if (!cells) return
    // A zero step — numpad 5, or two opposite keys cancelling — moves nothing.
    if (cells.dx === 0 && cells.dy === 0) return
    const delta = { x: cells.dx * map.grid_size, y: cells.dy * map.grid_size }

    const state = keyMoveRef.current
    const now = performance.now()
    if (now - state.lastStepAt < KEY_STEP_MS) return
    state.lastStepAt = now

    // The CURRENT position, not the one from the render this closed over.
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
    // Same rule as a drag: the key press simply does nothing against a wall,
    // rather than moving and rebounding.
    if (!isMoveAllowed(next, token.id, live.size_cells)) return
    setTokens((prev) => prev.map((t) => (t.id === token.id ? { ...t, ...next } : t)))
    // Same speculative refresh as a drag — a keyboard walk should not be the
    // slow way to move.
    previewVision(next)

    // One write when the movement settles. Writing per square would emit a
    // realtime event per square, and everyone else's token would stutter across
    // the map instead of arriving where it stopped.
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void commitKeyMove(token.id), KEY_COMMIT_MS)
  }

  function handleKeyDown(e: React.KeyboardEvent, token: PlayspaceToken) {
    // Arrows, numpad (including the four diagonals) and Home/PageUp/End/PageDown
    // for laptops without a numpad — see movementDelta. A battlemap has eight
    // directions and a keyboard has four arrows, which is why this is a lookup
    // rather than a chain of key comparisons.
    if (!movementDelta(e.key, e.code) || !canDrag(token)) return
    // Always, so the browser never scrolls the map frame out from under the
    // token you are walking — even on a press that takes no step.
    e.preventDefault()

    const wasIdle = heldKeysRef.current.size === 0
    heldKeysRef.current.set(e.code || e.key, { key: e.key, code: e.code })

    // A first step is already pending: this key simply joins it, and the pending
    // step will pick up both. This is what turns two presses into ONE diagonal.
    if (graceRef.current !== null) return

    // THE GRACE WINDOW. Nobody presses two arrows on the same millisecond, so
    // acting on the first press instantly emitted a stray orthogonal step before
    // the diagonal — you meant "up-left" and got "left, then up-left" (owner,
    // 2026-09-02). Waiting a moment before the first step of a fresh press lets
    // the second key arrive and be counted.
    //
    // Only the FIRST step waits. Repeats (`e.repeat`) and keys added to an
    // already-moving token step immediately, so holding a direction still walks
    // at full cadence — the delay is paid once per press, not per square.
    if (wasIdle && !e.repeat) {
      graceRef.current = setTimeout(() => {
        graceRef.current = null
        stepHeld(token)
      }, DIAGONAL_GRACE_MS)
      return
    }

    stepHeld(token)
  }

  /**
   * Releases a key, and makes sure a quick tap still moves.
   *
   * If the grace timer is still pending when the key comes up — a tap shorter
   * than the window — the step is taken NOW, while the key is still in the held
   * map. Letting the timer fire afterwards instead would find the map empty and
   * silently swallow the tap, which is a worse bug than the one the grace window
   * fixed.
   */
  function handleKeyUp(e: React.KeyboardEvent, token: PlayspaceToken) {
    if (graceRef.current !== null) {
      clearTimeout(graceRef.current)
      graceRef.current = null
      stepHeld(token)
    }
    heldKeysRef.current.delete(e.code || e.key)
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
      scheduleVision(true)
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
    const blur = () => {
      setFreePlace(false)
      // Same reasoning as the token's own onBlur: a window that loses focus
      // mid-press never delivers the keyup.
      heldKeysRef.current.clear()
      if (graceRef.current !== null) {
        clearTimeout(graceRef.current)
        graceRef.current = null
      }
    }
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

  /**
   * The tokens this session may actually SEE.
   *
   * Opaque fog hides a token visually, but it is still in the DOM — findable by
   * anyone who looks, and briefly visible during a re-render before the fog
   * paints. So a token outside the visible area is not drawn at all.
   *
   * Your OWN tokens are always drawn, whatever the polygon says. A token with
   * sight 0 has a degenerate polygon that does not contain its own centre, and
   * losing sight of your own piece is disorienting in a way that is never what
   * anyone wanted.
   *
   * HONEST LIMIT, recorded rather than implied: token ROWS remain
   * member-readable, so a determined player can still read positions out of the
   * data layer. Unlike walls (0061), tokens cannot simply be withheld — every
   * client needs them to render anything. Closing that would mean filtering
   * tokens per player server-side, which is a real piece of work and is not this
   * one. What this does is make the FOG honest.
   */
  /** The visible areas as points, or null when there is no fog for this session. */
  const visionPolys = useMemo(() => {
    if (!vision?.visionEnabled) return null
    if ('isDm' in vision && vision.isDm) return null
    const polys = 'polygons' in vision ? vision.polygons : []
    return polys.map((poly) => poly.map(([x, y]) => ({ x, y })))
  }, [vision])

  /**
   * Where this session's own tokens may be dragged to: walls only, no sight
   * limit. Null when there is no fog, i.e. no constraint.
   *
   * A straight line inside a visibility polygon provably crosses no wall — that
   * is what a visibility polygon is — so this lets a drag STOP at a wall without
   * the client ever being told where the wall is. The server still refuses the
   * write (0063/0064); this just means it never has to.
   */
  const movePolys = useMemo(() => {
    if (!vision?.visionEnabled) return null
    if ('isDm' in vision && vision.isDm) return null
    const polys = 'movePolygons' in vision ? vision.movePolygons : []
    if (polys.length === 0) return null
    return polys.map((poly) => poly.map(([x, y]) => ({ x, y })))
  }, [vision])

  const visibleTokens = useMemo(() => {
    if (!visionPolys) return tokens
    const radius = (map.grid_size * 1) / 2
    return tokens.filter(
      (t) =>
        (currentUserId && t.owner_user_id === currentUserId) ||
        // ANY part of the token being lit is enough to draw it — the clip path
        // below then shows only the lit part. Testing the centre alone made a
        // creature standing half-past a corner vanish completely, which both
        // looks broken and hides someone the party can genuinely see.
        tokenTouchesVision({ x: t.x, y: t.y }, (t.size_cells * map.grid_size) / 2 || radius, visionPolys),
    )
  }, [tokens, visionPolys, currentUserId, map.grid_size])

  /**
   * Painting order: biggest first, so the SMALLEST token is on top.
   *
   * A large token is a large hit area, and DOM order decides which element a
   * click lands on when two overlap. With tokens in arbitrary order, a 4x4
   * monster drawn after a 1x1 character sat over it and swallowed every click —
   * "you are unable to select things without selecting something else" (owner
   * report 2026-09-02). Sorting by size puts the small, hard-to-hit token above
   * the big, easy-to-hit one, which is the order that makes both reachable.
   *
   * Sorted on a COPY: `visibleTokens` is a memo other code reads, and sorting in
   * place would mutate it.
   */
  const paintedTokens = useMemo(
    () => [...visibleTokens].sort((a, b) => b.size_cells - a.size_cells),
    [visibleTokens],
  )

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

          {/* The clip path that shows only the LIT part of a token.
              
              objectBoundingBox units, so the coordinates are fractions of the
              map (0..1) and survive zoom without recomputation — user-space
              units would be CSS pixels, which change with every zoom step.
              
              An SVG clipPath UNIONS its children, which is how a player with
              two tokens gets both lit areas for free. That is the second place
              this project gets a union without writing polygon boolean maths;
              the fog mask is the first. */}
          {visionPolys && (
            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
              <defs>
                <clipPath id={tokenClipId} clipPathUnits="objectBoundingBox">
                  {visionPolys.map((poly, i) => (
                    <polygon
                      key={i}
                      points={poly
                        .map((p) => `${p.x / map.width_px},${p.y / map.height_px}`)
                        .join(' ')}
                    />
                  ))}
                </clipPath>
              </defs>
            </svg>
          )}

          <div
            style={{
              position: 'absolute',
              inset: 0,
              // Only clipped when there IS fog for this session — a DM, or a map
              // with vision off, must never have their tokens trimmed.
              clipPath: visionPolys ? `url(#${tokenClipId})` : undefined,
            }}
          >
          {paintedTokens.map((t) => {
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
                onKeyUp={(e) => handleKeyUp(e, t)}
                // A token can lose focus mid-press (tabbing away, a click
                // elsewhere), and its keyup then never arrives — leaving the key
                // "held" forever and every later press diagonal. Clearing on
                // blur is what stops that becoming a permanent, baffling state.
                onBlur={() => heldKeysRef.current.clear()}
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
                  // The hit area must match what is DRAWN. A token is a circle
                  // inside a square button, and the corners of that square are
                  // ~21% of it — empty map that nonetheless answered clicks, and
                  // on a large token those corners reach well into neighbouring
                  // squares. Clipping the element clips its hit-testing too, so
                  // one line fixes both the stray selection and the stray drag.
                  clipPath: 'circle(50%)',
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
                  // Background colour AND image together, from one helper that
                  // never emits the `background` shorthand — setting that after
                  // backgroundImage silently resets the image to none, which is
                  // exactly the bug this replaced. See tokenStyle.ts.
                  ...tokenBackground(art),
                  outline: selectedId === t.id ? '2px solid var(--color-accent)' : 'none',
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

          </div>

          {/* THE STACKING ORDER of this whole area, since it has been got wrong
              twice and each mistake looked like a different bug entirely:
              
                grid → tokens → FOG → walls
              
              Siblings paint in document order, so this list reads bottom-to-top.
              Fog above the tokens, because a monster in the dark must be hidden
              by the same sheet that hides the floor it stands on — under the
              tokens it showed every enemy through the fog, which is worse than
              no fog because it looks like it works. Walls above the fog, because
              a wall a player can see is a landmark they already know about.
              
              Fog is absent entirely when vision is off or the viewer is the DM,
              so for a DM this is just grid → tokens → walls. */}
          {/* The selected token's sight, for the DM. Under the walls so the
              wall that BLOCKS the sight stays legible on top of the shape it is
              cutting — that pairing is the whole point of looking. */}
          {isDm && showSight && selectedId && (() => {
            const t = tokens.find((x) => x.id === selectedId)
            return t ? <SightPreview map={map} walls={walls} token={t} /> : null
          })()}

          {/* Fog, above the tokens, so it covers them too — a monster standing
              in the dark must be hidden by the same sheet that hides the floor
              it is on. Rendering it under the tokens would show every enemy
              through the fog, which is worse than no fog at all because it looks
              like it is working.

              Absent entirely when vision is off or the viewer is the DM. */}
          {vision?.visionEnabled && !('isDm' in vision && vision.isDm) && (
            <FogLayer
              map={map}
              polygons={'polygons' in vision ? vision.polygons : []}
              opacity={map.fog_opacity}
            />
          )}
          {/* ABOVE the fog, and CLIPPED to what the viewer can see.
              
              Two owner decisions that sound contradictory and are not:
              
                "you can see walls constantly"   -> above the fog, not under it;
                "only see walls in line of sight" -> clipped to the lit area.
              
              Together they mean: a wall is not a secret you forget, but you only
              see the stretch of it you can actually look at. Walk along a cliff
              edge and it reveals itself as you go, instead of the whole outline
              appearing the moment one corner of it is lit. Under the fog it
              would vanish behind you, which was the first wrong model; unclipped
              it draws the full extent of a wall from one glimpse, which was the
              second.
              
              The clip is the SAME path the tokens use — one definition, so a
              wall and the creature standing against it can never disagree about
              where the light stops.
              
              A DM has no visionPolys and is never clipped: they are drawing
              these, and half a wall is not much use to draw with. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              // NOT CLIPPED. Visible walls are drawn in full, always (owner,
              // 2026-09-02: "make walls permanently visible").
              //
              // Two earlier models were tried and both were worse. Under the
              // fog, a wall vanished the moment you looked away — known terrain
              // behaving like a secret. Clipped to line of sight, only the
              // stretch you were looking at was drawn, which needed remembering
              // to be usable, and remembering brought its own boundary bugs.
              // Drawing a visible wall in full is the simplest rule that is
              // never wrong: the DM marked it visible, so it is visible.
              //
              // Nothing is leaked by this — RLS sends a player only the walls
              // marked visible (0066), so there is nothing here to clip FOR
              // safety, only for atmosphere.
              //
              // INERT, and it must stay that way. This wrapper covers the whole
              // map and sits ABOVE the tokens, so an interactive one swallows
              // every click meant for a token — which is exactly what it did
              // when first written: the DM could no longer select any token at
              // all (owner, 2026-09-02).
              //
              // `pointer-events: none` here does not disable the layer below it:
              // a CHILD may set `auto` and still be hit-tested, which is what
              // WallLayer does while a drawing tool is armed. So the drawing
              // surface works and nothing else is blocked.
              pointerEvents: 'none',
            }}
          >
              <WallLayer
                map={map}
                walls={walls}
                tool={isDm ? wallTool : 'none'}
                snapToGrid={wallSnap}
                onCreate={(k, p, c) => void handleCreateWall(k, p, c)}
                onErase={(id) => void handleEraseWall(id)}
              />
          </div>
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
          square — hold two arrows together (or use the numpad) to move
          diagonally. Hold <kbd>Alt</kbd> to place off-grid. Pinch or{' '}
          <kbd>Ctrl</kbd>+scroll to zoom; <kbd>Shift</kbd>+scroll to pan sideways.
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
 * How long to wait after the last token change before recomputing vision.
 *
 * Every recompute is a network round trip, and token changes arrive in bursts —
 * a held arrow key, or several people moving at once. Long enough to collapse a
 * burst into one call; short enough that the fog opening still feels like part
 * of the move rather than a separate event.
 */
const VISION_DEBOUNCE_MS = 250

/**
 * The same, for a move THIS session made.
 *
 * ZERO. A `setTimeout(0)` still defers to the next tick, so same-tick bursts
 * collapse, but nothing is waited for.
 *
 * There was no debounce to earn here, which is why it went from 60 to 0: a drag
 * or a held-key walk already produces exactly ONE write — the drag commits on
 * release, keyboard movement is batched 300ms after the last step — and this
 * runs after that write resolves. The delay was being added to a request that
 * was already going to be made once.
 *
 * THE REMAINING FLOOR is two sequential round trips: the move must be WRITTEN
 * before vision is recomputed, because the server computes from the stored
 * position. Sending them in parallel would race, and trusting a client-supplied
 * position would let anyone claim to be anywhere. So the way to make this fast
 * is to make each trip cheap rather than to overlap them — which is what
 * SUPABASE_INTERNAL_URL and the parallelised queries in the vision function do.
 */
const VISION_OWN_MOVE_MS = 0

/**
 * How often a player on a fogged map re-asks the server what they can see.
 *
 * Slow on purpose: this is a backstop and a keep-warm, not the mechanism. Token
 * changes are what actually drive the fog.
 */
const VISION_HEARTBEAT_MS = 60_000

/**
 * Minimum gap between two SPECULATIVE vision requests during a drag, in ms.
 *
 * Throttle, not debounce — see previewVision. Roughly ten a second: fast enough
 * that the fog reads as following the hand, slow enough that a five-second drag
 * is fifty cheap requests rather than one per animation frame.
 */
const VISION_PREVIEW_MS = 100

/**
 * How often a player re-asks the server for walls, in milliseconds.
 *
 * Twice a second, at the owner's request, so a wall the DM draws mid-session
 * appears without anyone having to move. See the effect that uses it for why
 * this is a poll rather than a realtime subscription.
 */
const WALL_POLL_MS = 500

/**
 * How far the pointer must travel before a press becomes a DRAG, in CSS pixels.
 *
 * A click is never perfectly still — a few pixels of travel between down and up
 * is normal, and more so on a trackpad. Without a threshold, clicking a token
 * near its edge nudged it a square: the press snapped to a different cell than
 * the one it started in, and selecting a token to look at it moved it instead
 * (owner report 2026-09-02).
 *
 * Measured in SCREEN pixels deliberately, not map pixels, because it is
 * describing the steadiness of a human hand — which does not change when you
 * zoom in.
 */
const DRAG_THRESHOLD_PX = 5

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

/**
 * How long the first step of a key press waits for a second key, in
 * milliseconds.
 *
 * Nobody presses two arrows on the same millisecond, so without this a diagonal
 * came out as "left, then up-left" — the stray orthogonal step being the first
 * press acted on alone. 70ms is long enough to catch a deliberate two-finger
 * press and short enough that a single tap does not feel delayed; it is also
 * comfortably under the 120ms step cadence, so it costs nothing while walking.
 */
const DIAGONAL_GRACE_MS = 70

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
