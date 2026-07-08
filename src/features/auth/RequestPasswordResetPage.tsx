/**
 * RequestPasswordResetPage — step 1 of password reset: email a reset link.
 *
 * Owns: collecting the email and asking Supabase to send a recovery email whose
 * link returns the user to /update-password (step 2). We always show the same
 * success notice regardless of whether the email exists, to avoid leaking which
 * addresses have accounts.
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuthCard, Button, FormError, FormNotice, TextField } from '../../components/ui'

export function RequestPasswordResetPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Supabase call: `auth.resetPasswordForEmail(email, { redirectTo })`.
   *  - redirectTo points at /update-password; clicking the emailed link opens
   *    that route with a recovery session (detectSessionInUrl handles the hash).
   *  - We surface only transport-level errors; a non-existent email is not
   *    treated as an error (privacy).
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setNotice('If an account exists for that email, a reset link is on its way.')
  }

  return (
    <AuthCard
      title="Reset password"
      footer={
        <div>
          Remembered it? <Link to="/login">Back to log in</Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormError message={error} />
        <FormNotice message={notice} />
        <Button type="submit" busy={busy}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  )
}
