/**
 * AuthProvider + useAuth — the app's single source of truth for the current
 * Supabase auth session.
 *
 * Owns: subscribing to Supabase auth state once, near the root, and exposing
 * the current session/user plus a sign-out action via React context. Screens
 * read auth state through `useAuth()` instead of each calling
 * `supabase.auth.getSession()`, which would race and duplicate listeners.
 *
 * Session lifecycle:
 *  - On mount we read any persisted session (getSession) and then subscribe to
 *    onAuthStateChange so login/logout/token-refresh/password-recovery events
 *    keep `session` current for the whole tree.
 *  - `loading` is true only until that first getSession resolves, so guards can
 *    avoid flashing the login page before we know whether a session exists.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

/** Shape of the value exposed to consumers of the auth context. */
interface AuthContextValue {
  /** The current session, or null when signed out. */
  session: Session | null
  /** Convenience accessor for `session.user`, or null when signed out. */
  user: User | null
  /** True until the initial session lookup completes. */
  loading: boolean
  /** Signs the user out and clears the local session. */
  signOut: () => Promise<void>
}

// Undefined default lets useAuth detect usage outside the provider and throw.
const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * Wraps the app and keeps auth state in sync with Supabase.
 *
 * @param children - The application tree that needs access to auth state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // 1. Seed from any persisted session (localStorage) on first load.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    // 2. Keep in sync with every later auth event for the app's lifetime.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    // Tear down the subscription on unmount to avoid leaks / double updates.
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      // supabase.auth.signOut() clears the stored session; onAuthStateChange
      // then fires with a null session, updating state via the listener above.
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Reads the auth context.
 * @throws Error if called outside an <AuthProvider>, which is a programming bug.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>')
  }
  return ctx
}
