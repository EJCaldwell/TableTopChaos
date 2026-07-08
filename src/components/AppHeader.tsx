/**
 * AppHeader — the persistent top bar for signed-in pages.
 *
 * Owns: the app title (links home), a link to the profile screen, and a log-out
 * action. Shared by the dashboard and campaign pages so the chrome is
 * consistent. Purely presentational aside from calling signOut() from auth.
 */
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { Button } from './ui'

export function AppHeader() {
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
        justifyContent: 'space-between',
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
        D&amp;D Campaign Manager
      </Link>
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
