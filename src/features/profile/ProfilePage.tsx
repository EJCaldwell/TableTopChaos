/**
 * ProfilePage — view and edit the signed-in user's own profile.
 *
 * Organised into three sections, which is the structure to keep as this screen
 * grows — it has already been a flat list once and got confusing:
 *   - **Account** — who you are: email, display name, avatar, credentials, and
 *     eventually account deletion (Phase 7.1).
 *   - **Workspace** — how the app looks and behaves for you, everywhere. These
 *     are browser-local view preferences (see preferences.ts), never synced and
 *     harmless to lose, which is what distinguishes them from Account.
 *   - **Legal** — policy links and your recorded acceptance (Phase 7.2).
 *
 * Several rows in Account and Legal are unbuilt; they are tracked as subphase
 * 7.3 and Phase 7.2 in PLANNING.md rather than left as silent gaps. Where a
 * control is missing, this page says so plainly instead of pretending it is
 * complete.
 *
 * All data access here is governed by the own-profile RLS policies from
 * migration 0002, so a user can only ever read/update their own row.
 */
import { useEffect, useState } from 'react'
import { getRailSide, setRailSide } from './preferences'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Button, FormError, FormNotice, TextField } from '../../components/ui'

export function ProfilePage() {
  // Account-level UI preference; browser-local, applied when a workspace mounts.
  const [railSide, setRailSideState] = useState(getRailSide)

  const { user } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Load the profile row once we know the user id.
  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)

    // Supabase call: select the caller's own profile.
    //  - Table/columns: profiles(display_name) filtered by id = user.id.
    //  - RLS: profiles_select_own restricts this to the caller's row anyway;
    //    the explicit .eq is belt-and-suspenders + lets us use .single().
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setError(error.message)
        } else {
          setDisplayName(data.display_name ?? '')
        }
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  /**
   * Persists the edited display name.
   * Supabase call: `update({ display_name }).eq('id', user.id)`.
   *  - RLS: profiles_update_own permits updating only the caller's row.
   *  - updated_at is stamped server-side by the set_updated_at() trigger.
   */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)
    setNotice(null)
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() || null })
      .eq('id', user.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setNotice('Profile saved.')
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 'var(--space-8)' }}>
      <p style={{ marginTop: 0 }}>
        <Link to="/">← Back</Link>
      </p>
      <h1>Your profile</h1>

      {/* ---- Account: who you are ---- */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Account</h2>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <TextField label="Email" type="email" value={user?.email ?? ''} disabled readOnly />
          <TextField
            label="Display name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          {/* The media pipeline (1.6) shipped, so avatar upload is unblocked —
              it just hasn't been wired to this screen yet. Tracked as 7.3. */}
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Avatar upload isn't wired up yet. Your avatar shows here if one is
            already set.
          </p>
          <FormError message={error} />
          <FormNotice message={notice} />
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      )}

        {/* Named rather than omitted: a missing control is a gap worth seeing,
            and "where do I change my password?" is the first thing people look
            for here. Tracked as 7.3 / 7.1 in PLANNING.md. */}
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-4)' }}>
          Changing your email, changing your password from here, and deleting
          your account aren't available yet.
        </p>
      </section>

      {/* ---- Workspace: how the app behaves for you, in every campaign ---- */}
      <section style={{ marginTop: 'var(--space-8)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Workspace</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Applies to every campaign you're in, and is saved in this browser only.
        </p>

        <strong style={{ fontSize: '0.9rem' }}>Sidebar position</strong>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          {(['left', 'right'] as const).map((side) => {
            const selected = railSide === side
            return (
              <button
                key={side}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setRailSideState(side)
                  setRailSide(side)
                }}
                style={{
                  font: 'inherit',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'var(--color-bg)',
                  color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
                  border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius)',
                  fontWeight: selected ? 600 : 400,
                }}
              >
                {side === 'left' ? 'Left' : 'Right'}
              </button>
            )
          })}
        </div>
        {/* Say so rather than letting it look broken: the side is read when a
            campaign workspace mounts, deliberately, so it does not relayout
            underneath windows you already have open and dragged. */}
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
          Takes effect the next time you open a campaign. Reopen any campaign
          you already have on screen to see the change.
        </p>

        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-4)' }}>
          A light/dark theme setting will live here too (phase 14).
        </p>
      </section>

      {/* ---- Legal: policies and recorded acceptance (Phase 7.2) ---- */}
      <section style={{ marginTop: 'var(--space-8)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Legal</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Terms of Service and Privacy Policy, and the date you accepted them,
          will appear here. Neither document exists yet — they ship with phase 7
          and are required before launch.
        </p>
      </section>
    </main>
  )
}
