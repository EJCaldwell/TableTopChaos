/**
 * UpdatePasswordPage — step 2 of password reset: set a new password.
 *
 * Owns: the "choose a new password" form reached from the emailed recovery
 * link. By the time this page renders, the Supabase client has already turned
 * the link's token into a (recovery) session via detectSessionInUrl, so we can
 * call updateUser directly. On success the user is fully logged in and sent
 * home.
 */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authErrorMessage } from './authErrors'
import { AuthCard, Button, FormError, TextField } from '../../components/ui'

export function UpdatePasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Supabase call: `auth.updateUser({ password })`.
   *  - Requires an active session; the recovery link supplies one. If the link
   *    is missing/expired there is no session and Supabase returns an auth
   *    error, which we show with a prompt to request a fresh link.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      // If this fails the old password is still live, which is the one thing
      // the user needs to know before they try signing in with the new one.
      setError(
        authErrorMessage(
          error,
          'We could not set your new password. It has NOT been changed — your ' +
            'old password still works, and the reset link may have expired.',
        ),
      )
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <AuthCard
      title="Choose a new password"
      footer={
        <div>
          Link expired? <Link to="/reset-password">Request a new one</Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}
