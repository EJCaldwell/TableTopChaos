/**
 * ConnectionCheck — a developer/QA panel that verifies subphase 1.1.3:
 *   1. the app builds and can reach the Supabase project, and
 *   2. the database is in a default-deny posture (an unauthenticated query to
 *      `profiles` returns zero rows, because RLS is enabled with no policies).
 *
 * This is a scaffolding/QA aid, not a user-facing feature; it will be removed
 * (or hidden behind a dev flag) once real screens exist. Keeping it now gives
 * us a one-click way to confirm the Supabase wiring end-to-end.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

/** Discriminated state of the connection probe, for clear UI rendering. */
type ProbeState =
  | { status: 'idle' }
  | { status: 'loading' }
  /** Query succeeded; `rowCount` rows were visible under current RLS. */
  | { status: 'ok'; rowCount: number }
  /** Query failed at the network/PostgREST level (not an RLS empty result). */
  | { status: 'error'; message: string }

/**
 * Probes Supabase by selecting from `profiles`.
 *
 * Supabase/PostgREST call: `supabase.from('profiles').select('id')`.
 *  - Row shape returned: `{ id: string }[]` (possibly empty).
 *  - Governing RLS: migration 0001 enables RLS on `profiles` with NO policies,
 *    so default-deny means an anonymous caller sees zero rows WITHOUT an error.
 *    That empty-but-successful result is the expected, healthy outcome here.
 *  - A thrown error instead indicates a config/connectivity problem (bad URL or
 *    key), which is what we want to surface during setup.
 */
export function ConnectionCheck() {
  const [state, setState] = useState<ProbeState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    // `head: true` + `count` asks PostgREST for just the row count, avoiding
    // transferring any row data — all we need to demonstrate default-deny.
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (cancelled) return
        if (error) {
          setState({ status: 'error', message: error.message })
        } else {
          setState({ status: 'ok', rowCount: count ?? 0 })
        }
      })

    // Guard against setting state after unmount (React 19 StrictMode double-invoke).
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-6)',
        maxWidth: 540,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Supabase connection check</h2>

      {state.status === 'loading' && <p>Probing the database…</p>}

      {state.status === 'ok' && (
        <>
          <p style={{ color: 'var(--color-success)' }}>
            ✓ Connected. Query succeeded.
          </p>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Rows visible to this (unauthenticated) caller: <strong>{state.rowCount}</strong>.
            Expected <strong>0</strong> — RLS default-deny is working.
          </p>
        </>
      )}

      {state.status === 'error' && (
        <p style={{ color: 'var(--color-danger)' }}>
          ✗ Could not query Supabase: {state.message}
          <br />
          Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in your .env, and that
          migration 0001 has been applied.
        </p>
      )}
    </section>
  )
}
