/**
 * AppHeader — the persistent top bar for signed-in pages.
 *
 * Owns: the app title (links home), an optional action beside it, an optional
 * centred page title, a link to the profile screen, and a log-out action. Shared by the dashboard and campaign
 * pages so the chrome is consistent. Purely presentational aside from calling
 * signOut() from auth.
 *
 * The centred slot exists because the campaign workspace (Phase 5.2) is
 * full-bleed and has no room to spare: it used to carry its own title bar under
 * this one, which cost a whole row of vertical space for a single line of text.
 * The campaign name now rides here instead.
 */
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { Button } from './ui'

/**
 * @param center - Optional content for the middle of the bar (the campaign name
 *                 and role badge, on the campaign page). Omitted elsewhere, in
 *                 which case the bar keeps its original two-item layout.
 * @param leading - Optional control rendered immediately after the home link.
 *                  Used for "Campaign overview", which sits here rather than in
 *                  the tab rail because it is campaign-level reference material
 *                  — the same altitude as the home link beside it — while the
 *                  rail lists the places you actually work.
 */
export function AppHeader({ center, leading }: { center?: ReactNode; leading?: ReactNode } = {}) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  /** Sign out then send the user to the login screen. */
  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-6)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <Link
        to="/"
        style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--color-text)' }}
      >
        TableTopChaos
      </Link>
      {leading}

      {/* Centred slot. The flex:1 + centered content keeps the title visually
          centred in the bar regardless of how wide the two side groups are —
          close enough to true centre without a 3-column grid, and it degrades
          gracefully when the email on the right is long. */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          minWidth: 0,
        }}
      >
        {center}
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          {user?.email}
        </span>
        <Link to="/profile" style={{ fontSize: '0.9rem' }}>
          Profile
        </Link>
        <Button variant="secondary" style={{ width: 'auto' }} onClick={handleSignOut}>
          Log out
        </Button>
      </nav>
    </header>
  )
}
