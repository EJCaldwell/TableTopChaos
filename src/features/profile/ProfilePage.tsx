/**
 * ProfilePage — view and edit the signed-in user's own profile.
 *
 * Owns: loading the caller's `profiles` row and letting them edit their display
 * name. Avatar *upload* is intentionally deferred to the shared media pipeline
 * (subphase 1.6) and consumed by the character-portrait work (2.3); this screen
 * only shows the avatar if one is already set.
 *
 * All data access here is governed by the own-profile RLS policies from
 * migration 0002, so a user can only ever read/update their own row.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Button, FormError, FormNotice, TextField } from '../../components/ui'

export function ProfilePage() {
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
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Avatar upload arrives with the media pipeline (phase 1.6).
          </p>
          <FormError message={error} />
          <FormNotice message={notice} />
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      )}
    </main>
  )
}
