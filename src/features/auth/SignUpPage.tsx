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
import { POLICY_VERSION } from '../legal/legalConfig'
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
  // Explicit, unticked-by-default consent. A pre-ticked box is not consent in
  // any jurisdiction that has thought about it, and this one gates submission.
  const [acceptedTerms, setAcceptedTerms] = useState(false)

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
    // Record which policy version was accepted (7.2), server-timestamped.
    //
    // Only possible when signUp returns a SESSION — the RPC reads auth.uid(),
    // and with email confirmation on there is no session yet. In that case the
    // acceptance is recorded by LegalAcceptanceBanner once they sign in, so the
    // tick-box is never silently lost. Deliberately not fatal: an account that
    // exists without its acceptance row recorded is recoverable, whereas failing
    // the signup after the account was created is confusing and leaves the user
    // unable to retry with the same address.
    if (data.session) {
      const { error: acceptErr } = await supabase.rpc('record_legal_acceptance', {
        p_version: POLICY_VERSION,
      })
      if (acceptErr) console.error('signup: could not record acceptance', acceptErr)
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
        {/* Links open in a new tab so reading the terms does not discard a
            half-filled signup form. */}
        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontSize: '0.85rem' }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            style={{ marginTop: '0.2rem' }}
          />
          <span>
            I agree to the{' '}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>{' '}
            and{' '}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </span>
        </label>
        <Button type="submit" busy={busy} disabled={!acceptedTerms}>
          Sign up
        </Button>
      </form>
    </AuthCard>
  )
}
