/**
 * playspace/useCampaignMaps.ts — the campaign's maps, kept live (9.1.2).
 *
 * Extracted because TWO components need the same list and must never disagree
 * about which map is live: the battlemap view (which draws the active one) and
 * the Maps tab (which is where the DM switches it). Two independent fetches
 * would be two sources of truth, and the moment they diverged the DM would be
 * looking at a switcher that no longer matched the table's screen.
 *
 * Subscribing here rather than in each consumer also means one realtime channel
 * per campaign instead of one per mounted panel.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRealtimeSync, mergeById, type RealtimeEvent } from '../realtime/useRealtimeRefresh'
import { listMaps, type PlayspaceMap } from './api'

/** What {@link useCampaignMaps} returns. */
export interface CampaignMaps {
  /** Every map in the campaign, oldest first, so picker order is stable. */
  maps: PlayspaceMap[]
  /** The one map the table is looking at, or null if there is none yet. */
  active: PlayspaceMap | null
  loading: boolean
  /** Load error, if the initial fetch failed. */
  error: string | null
  /** Apply a local change immediately, ahead of the realtime echo. */
  patch: (next: PlayspaceMap[] | ((prev: PlayspaceMap[]) => PlayspaceMap[])) => void
  /** Re-fetch from scratch. */
  refresh: () => Promise<void>
}

/**
 * Loads a campaign's battlemaps and keeps them in sync with everyone else's.
 * @param campaignId - Campaign scope.
 */
export function useCampaignMaps(campaignId: string): CampaignMaps {
  const [maps, setMaps] = useState<PlayspaceMap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setMaps(await listMaps(campaignId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the battlemaps.')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Per-row merge. Switching the live map is ONE update by the DM, but the 0050
  // trigger also clears is_active on the others, so this receives several events
  // and converges — which is why `active` is derived below rather than stored.
  const onEvent = useCallback((e: RealtimeEvent<PlayspaceMap>) => {
    setMaps((prev) =>
      mergeById(prev, e as RealtimeEvent<{ id: string }>, (raw) => raw as unknown as PlayspaceMap),
    )
  }, [])
  useRealtimeSync<PlayspaceMap>('playspace_maps', onEvent, `campaign_id=eq.${campaignId}`)

  return {
    maps,
    // Derived, never stored: with one flag across N rows, a stored copy is a
    // second place for "which map is live" to be wrong.
    active: maps.find((m) => m.is_active) ?? null,
    loading,
    error,
    patch: setMaps,
    refresh,
  }
}
