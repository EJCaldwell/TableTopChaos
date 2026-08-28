/**
 * Tests for the Realtime merge helper.
 *
 * Every live-updating panel routes its events through this one function, so a
 * bug here is a bug in all of them at once — and the symptom (a row that does
 * not appear, or appears twice) is easy to blame on the network instead.
 *
 * Idempotency matters more than it looks: Supabase Realtime can redeliver an
 * event, and a merge that appended on every UPDATE would duplicate rows in a way
 * that only shows up under a flaky connection.
 */
import { describe, expect, it } from 'vitest'
import { mergeById } from './useRealtimeRefresh'

/** The event shape the helper consumes. */
type Evt = Parameters<typeof mergeById>[1]

/** Builds an INSERT/UPDATE event. */
function change(eventType: 'INSERT' | 'UPDATE', row: Record<string, unknown>): Evt {
  return { eventType, new: row, old: {} } as unknown as Evt
}

/** Builds a DELETE event, which carries only the OLD row. */
function remove(id?: string): Evt {
  return { eventType: 'DELETE', new: {}, old: id ? { id } : {} } as unknown as Evt
}

interface Row {
  id: string
  name?: string
}

describe('mergeById', () => {
  const list: Row[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ]

  it('appends an unseen row', () => {
    expect(mergeById(list, change('INSERT', { id: 'c', name: 'Gamma' }))).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
      { id: 'c', name: 'Gamma' },
    ])
  })

  it('replaces a known row in place, preserving order', () => {
    const out = mergeById(list, change('UPDATE', { id: 'a', name: 'Renamed' })) as Row[]
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
    expect(out[0].name).toBe('Renamed')
  })

  it('treats an INSERT for an existing id as a replace, not a duplicate', () => {
    // Realtime can redeliver. Appending here would duplicate the row on screen.
    const out = mergeById(list, change('INSERT', { id: 'a', name: 'Again' })) as Row[]
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Again')
  })

  it('is idempotent: applying the same UPDATE twice equals applying it once', () => {
    const e = change('UPDATE', { id: 'b', name: 'Changed' })
    const once = mergeById(list, e)
    expect(mergeById(once, e)).toEqual(once)
  })

  it('removes on DELETE', () => {
    expect(mergeById(list, remove('a'))).toEqual([{ id: 'b', name: 'Beta' }])
  })

  it('ignores a DELETE with no id rather than clearing the list', () => {
    // Postgres only sends the old row for DELETE when REPLICA IDENTITY is set.
    // Without an id we cannot know what to remove — dropping everything would be
    // the worst possible guess.
    expect(mergeById(list, remove())).toEqual(list)
  })

  it('ignores a DELETE for an unknown id', () => {
    expect(mergeById(list, remove('zzz'))).toEqual(list)
  })

  it('does not mutate the array it was given', () => {
    const original: Row[] = [{ id: 'a' }]
    mergeById(original, change('UPDATE', { id: 'a', name: 'x' }))
    expect(original).toEqual([{ id: 'a' }])
  })

  it('applies hydrate when appending, so enriched rows keep their extra fields', () => {
    const out = mergeById(
      [] as Row[],
      change('INSERT', { id: 'a' }),
      (raw) => ({ ...(raw as unknown as Row), name: 'hydrated' }),
    ) as Row[]
    expect(out[0].name).toBe('hydrated')
  })

  it('passes the PREVIOUS row to hydrate on update, so display fields survive', () => {
    // The realtime payload carries DB columns only. Without the previous row, a
    // panel showing a joined username would blank it on every update.
    const out = mergeById(
      [{ id: 'a', name: 'kept' }] as Row[],
      change('UPDATE', { id: 'a' }),
      (raw, prev) => ({ ...(raw as unknown as Row), name: prev?.name }),
    ) as Row[]
    expect(out[0].name).toBe('kept')
  })

  it('appends to an empty list', () => {
    expect(mergeById([] as Row[], change('INSERT', { id: 'a' }))).toEqual([{ id: 'a' }])
  })
})
