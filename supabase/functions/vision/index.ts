/**
 * vision — computes what a player may see, where the walls are (Phase 9.3).
 *
 * Contract:
 *   POST { mapId: string, at?: { x: number, y: number } }
 *
 * `at` is a SPECULATIVE viewpoint: "compute as if my token were here". It exists
 * because fog visibly trailed a player's own movement while a DM's client — which
 * computes its sight preview locally from walls it already has — updated
 * instantly. The gap was never computation, it was the round trip, so the client
 * now asks BEFORE the move lands (during a drag, and on each keyboard step)
 * instead of after.
 *
 * IT GRANTS NOTHING. `at` chooses where to sweep FROM, and the sweep is still
 * bounded by the real walls and the token's real sight range, so a crafted
 * position reveals exactly what standing there would reveal — and a player can
 * simply walk there. It cannot see through a wall, cannot exceed sight range,
 * and cannot be used on someone else's token: the query below is filtered to the
 * caller's own tokens and `at` never touches that filter. It is also never
 * PERSISTED — no token moves because of this parameter.
 *   header  Authorization: Bearer <user JWT>
 *   → 200 { visionEnabled: false }                       — no fog on this map
 *   → 200 { visionEnabled: true, isDm: true }            — the DM sees everything
 *   → 200 { visionEnabled: true, polygons: [[[x,y],…]] } — one polygon per token
 *   → 400 { error } — no mapId
 *   → 401 { error } — no/invalid JWT
 *   → 403 { error } — not a member of the campaign
 *   → 405 { error } — not a POST
 *
 * WHY THIS FUNCTION EXISTS AT ALL, since the same maths could run in the
 * browser in a tenth of the code: migration 0061 made walls DM-only, because the
 * owner chose Roll20's model over Foundry's. A player's client never receives
 * wall geometry — so the polygon has to be computed where the walls are, and
 * only the RESULT crosses the wire. What the client never receives, it cannot
 * leak. The whole point of this function is the data it does NOT return.
 *
 * IT RETURNS POLYGONS, NEVER WALLS. Every response shape above is either a flag
 * or a list of visibility polygons. If a future change makes wall geometry part
 * of a response, the 0061 decision has been undone silently — which is why the
 * response type is written out explicitly below rather than being inferred.
 *
 * THE SERVICE CLIENT IS USED ONLY AFTER MEMBERSHIP IS PROVEN. The caller's JWT
 * identifies them; the service client then reads walls (which RLS would refuse
 * them) and their own tokens. Getting that order wrong would let a non-member
 * ask what a campaign's map looks like — so membership is checked first, with
 * the caller's own client, and a failure there returns before anything is read.
 *
 * THE GEOMETRY IS THE TESTED MODULE. `vision.ts` and `walls.ts` are copied here
 * as `_geometry.ts` because Edge Functions cannot import from `src/`. That copy
 * is a real risk — two files that must not drift — and is handled by a test in
 * the app that asserts the two are identical, rather than by hoping.
 */
import { jsonResponse } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/clients.ts'
import { segmentsOf, pointsFromJson, visibilityPolygon, sightRadiusPx } from './_geometry.ts'

/** The only shapes this function may return. Deliberately explicit — see above. */
type VisionResponse =
  | { visionEnabled: false }
  | { visionEnabled: true; isDm: true }
  | {
      visionEnabled: true
      isDm: false
      /** What the caller can SEE — sight range and walls both applied. */
      polygons: [number, number][][]
      /**
       * Where the caller may MOVE — walls only, sight range ignored.
       *
       * Separate from `polygons` because sight and movement are different
       * questions: a token with six squares of sight can still WALK across a
       * lit hall, and a blind token can still walk at all. Clamping a drag to
       * the sight polygon would make a blinded creature unable to move, which
       * is not what blind means.
       *
       * A straight line inside this polygon provably crosses no wall — that is
       * what a visibility polygon IS — so the client can stop a drag at a wall
       * without ever being told where the wall is. The server still refuses the
       * write (0063/0064); this only makes the refusal unnecessary.
       *
       * HONEST TRADE: this reveals the shape of the space the token stands in,
       * which is slightly more than a short-sighted token can see. It is
       * bounded by the same walls either way, and a player learns that shape by
       * walking into it regardless — but it is more than zero, and is recorded
       * rather than glossed.
       */
      movePolygons: [number, number][][]
    }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const body = (await req.json().catch(() => ({}))) as {
      mapId?: string
      at?: { x?: unknown; y?: unknown }
    }
    const mapId = body.mapId
    // Optional speculative viewpoint — see `at` in the contract above. Coerced
    // and finiteness-checked here rather than trusted: it reaches the geometry
    // directly, and a NaN would produce a polygon of NaNs and fog the map.
    const at =
      typeof body.at?.x === 'number' &&
      typeof body.at?.y === 'number' &&
      Number.isFinite(body.at.x) &&
      Number.isFinite(body.at.y)
        ? { x: body.at.x, y: body.at.y }
        : null
    if (!mapId) return jsonResponse({ error: 'mapId is required' }, 400)

    const svc = serviceClient()

    // The map and the caller's identity are independent, so they are fetched
    // TOGETHER. They were sequential, and this function is on the critical path
    // for how quickly fog follows a player's own move — every avoidable round
    // trip here is latency the player sees as the app lagging their hand.
    const [{ data: map }, { data: userData, error: userErr }] = await Promise.all([
      svc
        .from('playspace_maps')
        .select('id, campaign_id, width_px, height_px, grid_size, vision_enabled')
        .eq('id', mapId)
        .maybeSingle(),
      userClient(authHeader).auth.getUser(),
    ])
    const user = userData?.user
    if (userErr || !user) return jsonResponse({ error: 'Not signed in' }, 401)
    // Same 403 for "no such map" and "not your map": distinguishing them tells a
    // stranger whether a map id exists, which is a small leak but a free one to
    // avoid.
    if (!map) return jsonResponse({ error: 'Not permitted' }, 403)

    const { data: membership } = await svc
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', map.campaign_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return jsonResponse({ error: 'Not permitted' }, 403)

    // Vision off: no fog for anyone. Returned before any geometry is read, so a
    // map without fog costs one query and no computation.
    if (!map.vision_enabled) {
      return jsonResponse({ visionEnabled: false } satisfies VisionResponse, 200)
    }

    // The DM sees everything. Also returned before reading walls — the DM has
    // their own copy through RLS and does not need this function to describe
    // their own map back to them.
    if (membership.role === 'dm') {
      return jsonResponse({ visionEnabled: true, isDm: true } satisfies VisionResponse, 200)
    }

    // From here the caller is a proven player on a fogged map.
    // Tokens and walls together, for the same reason as above: neither depends
    // on the other, and the pair was two sequential round trips.
    const [{ data: tokens }, { data: walls }] = await Promise.all([
      svc
        .from('playspace_tokens')
        .select('x, y, sight_squares')
        .eq('map_id', mapId)
        .eq('owner_user_id', user.id),
      svc
        .from('playspace_walls')
        .select('points, closed, blocks_movement')
        .eq('map_id', mapId),
    ])

    // A player with no token on this map sees nothing. An empty polygon list is
    // the honest answer, and the client fogs the whole map — better than
    // defaulting to full visibility, which is the failure that would quietly
    // undo the feature.
    if (!tokens || tokens.length === 0) {
      return jsonResponse(
        { visionEnabled: true, isDm: false, polygons: [], movePolygons: [] } satisfies VisionResponse,
        200,
      )
    }

    // EVERY wall blocks sight — that is what a wall is here, including a
    // sight-only one (0067).
    const segments = (walls ?? []).flatMap((w) =>
      segmentsOf(pointsFromJson(w.points), w.closed),
    )
    // Movement is the narrower set. This filter was MISSING, so `movePolygons`
    // was swept against every wall and the client refused to walk through the
    // very curtains 0067 exists to allow — the database permitted the move and
    // the client never sent it, which is why the server-side matrix could not
    // see the bug (owner report 2026-09-02).
    const moveSegments = (walls ?? [])
      .filter((w) => w.blocks_movement)
      .flatMap((w) => segmentsOf(pointsFromJson(w.points), w.closed))
    const bounds = { width: map.width_px, height: map.height_px }

    // One polygon per token the caller owns; the client unions them by drawing
    // them all into the same fog mask. Unioning here would mean implementing
    // polygon boolean operations for no benefit — the renderer can overlap.
    const toWire = (poly: { x: number; y: number }[]) =>
      poly.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number])

    // The speculative position applies to EVERY one of the caller's tokens,
    // because the request does not say which one moved. In practice a player has
    // one token on a map; if they have several, the extra polygons are drawn
    // from a position one of them is not at — which opens slightly MORE fog for
    // an instant and is corrected by the authoritative refresh a moment later.
    // Recorded because it is a real, if small, imprecision.
    const viewpoint = (t: { x: number; y: number }) => (at ? at : { x: t.x, y: t.y })

    const polygons = tokens.map((t) =>
      toWire(
        visibilityPolygon(
          viewpoint(t),
          segments,
          sightRadiusPx(t.sight_squares, map.grid_size),
          bounds,
        ),
      ),
    )

    // The same sweep with no range limit. Computed separately rather than
    // derived, because a sight-limited polygon cannot be widened back out —
    // information the range removed is gone.
    const movePolygons = tokens.map((t) =>
      toWire(visibilityPolygon(viewpoint(t), moveSegments, Infinity, bounds)),
    )

    return jsonResponse(
      { visionEnabled: true, isDm: false, polygons, movePolygons } satisfies VisionResponse,
      200,
    )
  } catch (err) {
    // Deliberately terse: this function's failures are computational, and the
    // detail belongs in logs rather than in a response a player can read.
    console.error('vision: unexpected failure', err)
    return jsonResponse({ error: 'Could not compute vision' }, 500)
  }
})
