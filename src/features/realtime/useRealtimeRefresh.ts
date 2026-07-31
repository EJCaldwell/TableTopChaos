/**
 * realtime/useRealtimeRefresh.ts — hooks for reflecting other people's edits
 * live via Supabase Realtime (Phase 4.4), without a manual page refresh.
 *
 * Two hooks:
 *  - useRealtimeSync — the granular one: hands each change event (INSERT /
 *    UPDATE / DELETE with the affected row) to a callback so a panel can MERGE
 *    just that row into local state. Preferred: no flicker, keeps scroll/focus,
 *    and only the changed row re-renders.
 *  - useRealtimeRefresh — the coarse fallback: debounced "something changed,
 *    re-fetch everything" for cases where a merge isn't worth the code.
 *
 * RLS still applies to Realtime, so a client only receives events for rows it
 * may already SELECT — no new exposure. One channel per hook instance (unique
 * name via useId); torn down on unmount.
 */
import { useEffect, useId, useRef } from 'react'
import { supabase } from '../../lib/supabase'

/** A Realtime change event for one row of `T`. */
export interface RealtimeEvent<T> {
  /** What happened to the row. */
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  /** The new row (empty-ish on DELETE). */
  new: T
  /** The prior row (only fully populated with REPLICA IDENTITY FULL; PK on DELETE). */
  old: Partial<T>
}

/**
 * Subscribes to postgres_changes on `table` and hands each event to `onEvent`
 * so the caller can merge that single row into local state.
 *
 * @param table - The public table to watch (must be in the realtime publication).
 * @param onEvent - Called per change with the affected row.
 * @param filter - Optional `column=eq.value` server-side filter.
 * @param enabled - Set false to not subscribe (e.g. before ids are known).
 */
export function useRealtimeSync<T = Record<string, unknown>>(
  table: string,
  onEvent: (e: RealtimeEvent<T>) => void,
  filter?: string,
  enabled = true,
): void {
  const cb = useRef(onEvent)
  cb.current = onEvent
  const uid = useId()

  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel(`rt:${table}:${filter ?? 'all'}:${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload) =>
          cb.current({
            eventType: payload.eventType as RealtimeEvent<T>['eventType'],
            new: payload.new as T,
            old: payload.old as Partial<T>,
          }),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [table, filter, enabled, uid])
}

/**
 * Coarse variant: fires a debounced `onChange` for any change on `table` (for
 * panels where a full re-fetch is simpler than a per-row merge).
 * @param table - The public table to watch.
 * @param onChange - Called after a change settles; typically your refresh().
 * @param filter - Optional `column=eq.value` server-side filter.
 * @param enabled - Set false to not subscribe.
 * @param debounceMs - Collapse window for bursts (default 250ms).
 */
export function useRealtimeRefresh(
  table: string,
  onChange: () => void,
  filter?: string,
  enabled = true,
  debounceMs = 250,
): void {
  const cb = useRef(onChange)
  cb.current = onChange
  const uid = useId()

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const fire = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cb.current(), debounceMs)
    }
    const channel = supabase
      .channel(`rt:${table}:${filter ?? 'all'}:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, fire)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [table, filter, enabled, debounceMs, uid])
}

/**
 * Merges a Realtime event into an array of rows keyed by `id` (INSERT appends,
 * UPDATE replaces in place, DELETE removes). A small shared helper so each panel
 * doesn't re-implement it. For enriched row types (extra display fields), pass a
 * `hydrate` to map the raw DB row onto your richer shape.
 * @param list - Current array.
 * @param e - The change event.
 * @param hydrate - Optional map from the raw new row to the array's element type.
 */
export function mergeById<T extends { id: string }>(
  list: T[],
  e: RealtimeEvent<{ id: string }>,
  hydrate: (raw: Record<string, unknown>, prev: T | undefined) => T = (raw) => raw as unknown as T,
): T[] {
  if (e.eventType === 'DELETE') {
    const oldId = (e.old as { id?: string }).id
    return oldId ? list.filter((x) => x.id !== oldId) : list
  }
  const raw = e.new as Record<string, unknown>
  const id = raw.id as string
  const idx = list.findIndex((x) => x.id === id)
  if (idx === -1) return [...list, hydrate(raw, undefined)]
  const copy = list.slice()
  copy[idx] = hydrate(raw, copy[idx])
  return copy
}
