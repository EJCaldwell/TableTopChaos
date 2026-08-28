/**
 * ProvisionalUsernameBanner — asks users whose username was generated for them
 * to choose a real one (Phase 7.4.1).
 *
 * WHO SEES THIS. Two groups, both flagged by `profiles.username_is_provisional`:
 *   * accounts that existed before migration 0039, which had no username at all
 *     and were backfilled from their email address;
 *   * accounts whose requested username was already taken at signup — the
 *     trigger hands out a suffixed variant rather than failing the signup, so
 *     the ask has to happen afterwards.
 *
 * WHY IT IS A PERSISTENT BANNER RATHER THAN A ONE-OFF NOTICE. PLANNING's QA
 * criterion is that backfilled users "cannot skip indefinitely". A note on the
 * Profile page satisfies nobody who never opens the Profile page — which is most
 * people. This follows them through the whole signed-in app and only leaves when
 * the name is actually changed.
 *
 * WHY IT IS NOT A HARD BLOCK. Their username is legal, unique and working; the
 * account is not broken, it is just wearing a name it did not pick. Locking
 * someone out of a session they came to play in, over a cosmetic handle, would
 * be a worse product than the problem it solves. It is deliberately not
 * dismissible either — dismissing is how a prompt becomes permanent.
 *
 * Mounted next to LegalAcceptanceBanner in RequireAuth for the same reason: it
 * belongs to the whole signed-in app, not to one page.
 */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

export function ProvisionalUsernameBanner() {
  const { user } = useAuth()
  const location = useLocation()
  const [provisional, setProvisional] = useState(false)
  const [username, setUsername] = useState<string | null>(null)

  // Re-read on every navigation, keyed by pathname: this is what makes the
  // banner disappear the moment the user saves a new name on the Profile page,
  // without the two components needing to know about each other.
  useEffect(() => {
    if (!user) return
    let active = true
    supabase
      .from('profiles')
      .select('username, username_is_provisional')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setProvisional(data?.username_is_provisional ?? false)
        setUsername(data?.username ?? null)
      })
    return () => {
      active = false
    }
  }, [user, location.pathname])

  if (!provisional) return null
  // Suppressed on the page that fixes it — a banner telling you to go where you
  // already are is noise, and it would sit directly above the field it is about.
  if (location.pathname === '/profile') return null

  return (
    <div
      role="status"
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        padding: 'var(--space-2) var(--space-4)',
        fontSize: '0.85rem',
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span>
        You're showing up to other players as{' '}
        <strong style={{ color: 'var(--color-text)' }}>{username}</strong> — a name
        we picked for you.
      </span>
      <Link to="/profile">Choose your own</Link>
    </div>
  )
}
