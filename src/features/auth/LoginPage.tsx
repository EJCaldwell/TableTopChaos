/**
 * LoginPage — email/password sign-in.
 *
 * Owns: the login form and its call to Supabase Auth. On success it redirects
 * to wherever the user was originally headed (RequireAuth stashes that in
 * router state) or to the home route.
 */
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authErrorMessage } from './authErrors'
import { AuthCard, Button, FormError, TextField } from '../../components/ui'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Where to go after login: the guarded page the user tried to reach, else "/".
  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'

  /**
   * Handles form submit.
   * Supabase call: `auth.signInWithPassword({ email, password })`.
   *  - On success the session is stored and AuthProvider's listener updates
   *    state; we navigate to `redirectTo`.
   *  - On failure (bad credentials, unconfirmed email) we surface the message.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      // Distinguish "your details are wrong" from "the server is broken":
      // a 5xx arrives as "{}" (see authErrors.ts), and showing that where a
      // wrong-password message belongs sends people to reset a password that
      // was never the problem.
      setError(
        authErrorMessage(
          error,
          'We could not sign you in just now — this looks like a problem on our ' +
            'side rather than your details. Please try again in a moment.',
        ),
      )
      return
    }
    navigate(redirectTo, { replace: true })
  }

  return (
    <AuthCard
      title="Log in"
      footer={
        <>
          <div>
            No account? <Link to="/signup">Sign up</Link>
          </div>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <Link to="/reset-password">Forgot your password?</Link>
          </div>
        </>
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
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Log in
        </Button>
      </form>
    </AuthCard>
  )
}
