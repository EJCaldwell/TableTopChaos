/**
 * SignUpPage — create a new account with email/password + display name.
 *
 * Owns: the signup form and its call to Supabase Auth. The display name is
 * passed as user metadata so the `handle_new_user()` trigger (migration 0002)
 * seeds it into the profiles row on the server.
 *
 * Two outcomes are handled:
 *  - Email confirmation OFF (our dev setting): signUp returns a session, the
 *    user is logged in immediately, and we go to home.
 *  - Email confirmation ON: no session is returned; we show a "check your
 *    email" notice instead. This keeps the page correct if the setting is
 *    flipped for production.
 */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuthCard, Button, FormError, FormNotice, TextField } from '../../components/ui'

export function SignUpPage() {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Handles form submit.
   * Supabase call: `auth.signUp({ email, password, options: { data } })`.
   *  - `data.display_name` becomes raw_user_meta_data, read by the DB trigger.
   *  - If a session comes back, AuthProvider picks it up and we navigate home.
   *  - If not (confirmation required), we show a notice to check email.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName.trim() } },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      navigate('/', { replace: true })
    } else {
      setNotice('Account created. Check your email to confirm, then log in.')
    }
  }

  return (
    <AuthCard
      title="Create account"
      footer={
        <div>
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <TextField
          label="Display name"
          type="text"
          autoComplete="nickname"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
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
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <FormNotice message={notice} />
        <Button type="submit" busy={busy}>
          Sign up
        </Button>
      </form>
    </AuthCard>
  )
}
