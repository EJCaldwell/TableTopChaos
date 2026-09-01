/**
 * dev/useDevAccess.ts — may this browser show the dev-only test tooling?
 *
 * TWO INDEPENDENT GATES, and they do different jobs:
 *
 *  1. `import.meta.env.DEV` — the one that matters. It is a compile-time
 *     constant, so a production build evaluates it to `false`, and the bundler
 *     removes everything behind it. The tooling is ABSENT from the shipped
 *     JavaScript, not merely hidden in it; absent code cannot be re-enabled by
 *     editing a variable in a console.
 *  2. `is_dev_account()` — the owner's account only (migration 0051). This keeps
 *     the control out of the way in a dev build signed in as somebody else, e.g.
 *     while reproducing a bug against a real person's account.
 *
 * NEITHER IS A SECURITY BOUNDARY, and it matters that nobody later assumes
 * otherwise. The tooling only ever makes the caller see LESS of their own data —
 * a DM rendering their campaign the way a player sees it. There is nothing to
 * escalate. The gates exist for tidiness and to stop a half-built control being
 * mistaken for a feature.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

/**
 * Whether the dev test tooling should be available to the current session.
 *
 * Returns false during the initial check, so the tooling can never flash into
 * view for an account that turns out not to be allowed.
 *
 * @returns `true` only in a dev build, for an allowlisted account.
 */
export function useDevAccess(): boolean {
  const { user } = useAuth()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    // Short-circuit in production. Written as an early return rather than a
    // condition inside the effect so the RPC call itself is unreachable code in
    // a production build and gets dropped with everything else.
    if (!import.meta.env.DEV) return
    if (!user) {
      setAllowed(false)
      return
    }

    let active = true
    supabase
      .rpc('is_dev_account')
      .then(({ data, error }) => {
        if (!active) return
        // Any failure means "not allowed". A tool that appears when the check
        // errors is a tool that appears at the worst possible moment.
        setAllowed(!error && data === true)
      })

    return () => {
      active = false
    }
  }, [user])

  return allowed
}
