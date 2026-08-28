/**
 * RequireAuth — route guard for authenticated-only areas.
 *
 * Owns: gating nested routes behind a valid session. Used as a layout route
 * (`<Route element={<RequireAuth />}>`), it renders the matched child via
 * <Outlet> when signed in, or redirects to /login otherwise. It preserves the
 * attempted location in router state so the login page can send the user back
 * after a successful sign-in.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { LegalAcceptanceBanner } from '../legal/LegalAcceptanceBanner'
import { ProvisionalUsernameBanner } from '../profile/ProvisionalUsernameBanner'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  // Wait for the initial session lookup so we don't flash /login for a user who
  // actually has a persisted session.
  if (loading) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100%' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      </main>
    )
  }

  if (!session) {
    // `replace` so the guarded URL doesn't linger in history; `state.from`
    // lets LoginPage redirect back to where the user was headed.
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Mounted here rather than per-page so the prompt follows the user through
  // the whole signed-in app instead of only appearing on the dashboard. It
  // renders nothing when the current policy version is already accepted, and
  // nothing at all while the policies are still drafts.
  return (
    <>
      <LegalAcceptanceBanner />
      {/* Asks users whose username was generated for them (backfilled by 0039,
          or assigned at signup because their choice was taken) to pick their
          own. Renders nothing for everyone else. */}
      <ProvisionalUsernameBanner />
      <Outlet />
    </>
  )
}
