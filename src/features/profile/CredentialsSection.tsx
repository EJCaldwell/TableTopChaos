/**
 * CredentialsSection — change your password and change your email, from the
 * Profile page (Phase 7.3.1).
 *
 * WHY THIS EXISTS. Both flows were reachable only by accident before this: the
 * password could be changed solely by signing OUT and using the "forgot
 * password" email, and the email could not be changed at all — the field was
 * rendered read-only with a note saying so. "Where do I change my password?" is
 * the first thing anyone looks for on a profile screen, and "my email is wrong"
 * was a support ticket nobody could resolve, since a wrong address also means no
 * recovery link can ever reach you.
 *
 * BOTH ACTIONS REQUIRE THE CURRENT PASSWORD. supabase-js will happily change
 * either one from a live session alone, which means a borrowed or hijacked
 * session is enough to take an account over permanently — change the email,
 * change the password, and the real owner has no route back in. Re-verifying
 * costs the user one field and closes that. It is verified by calling
 * `signInWithPassword` with the caller's own email, which returns an error on a
 * wrong password and otherwise simply refreshes the session for the same user.
 *
 * EMAIL CHANGE IS NOT IMMEDIATE, and the UI has to say so. GoTrue sends a
 * confirmation link and the address does not change until it is clicked. A form
 * that says "Saved" and then shows the old address looks broken; worse, someone
 * who believes the change took effect may not notice their recovery route still
 * points at the old mailbox.
 *
 * The two forms are deliberately separate submissions rather than one "account
 * details" form. They have different failure modes and different outcomes — one
 * takes effect instantly, the other waits on an email — and a single Save button
 * cannot honestly report both.
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button, FormError, FormNotice, TextField } from '../../components/ui'
import { authErrorMessage } from '../auth/authErrors'

/** Matches the minLength on the signup and reset forms. */
const MIN_PASSWORD_LENGTH = 6

/**
 * Re-verifies the signed-in user by their current password.
 *
 * Supabase call: `auth.signInWithPassword({ email, password })`.
 *  - The email is the caller's OWN, so a success re-issues a session for the
 *    same user and changes nothing observable; a failure means the password was
 *    wrong. This is used as a proof-of-knowledge check, not to switch accounts.
 *  - Returns a message on failure rather than throwing, because every caller
 *    here wants to render it in a FormError.
 *
 * @param email - The signed-in user's email address.
 * @param password - The password to verify.
 * @returns null when the password is correct, otherwise an error message.
 */
async function verifyPassword(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return null
  // GoTrue returns "Invalid login credentials" here, which reads as though the
  // whole account is wrong. In this context only one thing can be wrong.
  if (/invalid login/i.test(error.message)) return 'That password is not correct.'
  return authErrorMessage(
    error,
    'Could not check your password just now. Nothing has been changed — please try again.',
  )
}

/** Props for {@link CredentialsSection}. */
interface CredentialsSectionProps {
  /** The signed-in user's current email address. */
  email: string
}

/**
 * Password and email change forms for the signed-in user.
 * @param props - See {@link CredentialsSectionProps}.
 */
export function CredentialsSection({ email }: CredentialsSectionProps) {
  // --- password form ---
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwNotice, setPwNotice] = useState<string | null>(null)

  // --- email form ---
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailNotice, setEmailNotice] = useState<string | null>(null)

  /**
   * Changes the password: verify the current one, then set the new one.
   *
   * Supabase call: `auth.updateUser({ password })` after {@link verifyPassword}.
   *  - The confirm field is checked client-side only; it exists to catch typos
   *    in a field whose contents nobody can see, not as a security control.
   *  - On success the session stays valid, so the user is NOT signed out. That
   *    is deliberate — being logged out by a successful password change reads as
   *    a failure.
   */
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwNotice(null)

    if (newPassword !== confirmPassword) {
      setPwError('The two new passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setPwError('The new password is the same as your current one.')
      return
    }

    setPwBusy(true)
    const verifyError = await verifyPassword(email, currentPassword)
    if (verifyError) {
      setPwBusy(false)
      setPwError(verifyError)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwBusy(false)
    if (error) {
      setPwError(
        authErrorMessage(
          error,
          'The server could not change your password. It has NOT been changed — ' +
            'your current password still works.',
        ),
      )
      return
    }
    // Clear all three fields: leaving a password sitting in a form after a
    // successful change is exactly the thing that ends up in a screenshot.
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwNotice('Password changed. You are still signed in on this device.')
  }

  /**
   * Starts an email change. Requires the current password.
   *
   * Supabase call: `auth.updateUser({ email })`.
   *  - GoTrue emails a confirmation link; **the address does not change until
   *    that link is clicked**, so this reports "check your email", never
   *    "saved".
   *  - Depending on the GoTrue `SECURE_EMAIL_CHANGE` setting the old address may
   *    also be asked to confirm. Either way the user's job is the same: open the
   *    mail.
   */
  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setEmailError(null)
    setEmailNotice(null)

    const target = newEmail.trim()
    if (target.toLowerCase() === email.toLowerCase()) {
      setEmailError('That is already your email address.')
      return
    }

    setEmailBusy(true)
    const verifyError = await verifyPassword(email, emailPassword)
    if (verifyError) {
      setEmailBusy(false)
      setEmailError(verifyError)
      return
    }

    const { error } = await supabase.auth.updateUser({ email: target })
    setEmailBusy(false)
    if (error) {
      // The overwhelmingly common cause of a 5xx here is that the confirmation
      // email could not be SENT — GoTrue returns 500 "Error sending email change
      // email", which auth-js reduces to "{}" before we ever see it. Say what
      // did not happen rather than showing an empty error box.
      setEmailError(
        authErrorMessage(
          error,
          'We could not send the confirmation email, so your address has NOT been ' +
            'changed. Check the address is right and try again — if it keeps ' +
            'failing, the mail service is the likely cause, not you.',
        ),
      )
      return
    }
    setEmailPassword('')
    setEmailNotice(
      `Confirmation sent to ${target}. Your email stays ${email} until you open ` +
        `that link — if it does not arrive, check spam before trying again.`,
    )
  }

  return (
    <>
      {/* ---- Change password ---- */}
      <form
        onSubmit={handlePasswordSubmit}
        style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}
      >
        <strong style={{ fontSize: '0.9rem' }}>Change password</strong>
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <FormError message={pwError} />
        <FormNotice message={pwNotice} />
        <Button type="submit" busy={pwBusy} style={{ width: 'auto' }}>
          Change password
        </Button>
        {/* The escape hatch for the one case this form cannot serve: you are
            signed in but do not know your current password. Without this the
            only route is to sign out first, which is unobvious. */}
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', margin: 0 }}>
          Don't remember it? <Link to="/reset-password">Email yourself a reset link</Link>.
        </p>
      </form>

      {/* ---- Change email ---- */}
      <form
        onSubmit={handleEmailSubmit}
        style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}
      >
        <strong style={{ fontSize: '0.9rem' }}>Change email</strong>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
          You'll get a confirmation link at the new address. Your email doesn't
          change until you open it.
        </p>
        <TextField
          label="New email"
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={emailPassword}
          onChange={(e) => setEmailPassword(e.target.value)}
        />
        <FormError message={emailError} />
        <FormNotice message={emailNotice} />
        <Button type="submit" busy={emailBusy} style={{ width: 'auto' }}>
          Send confirmation
        </Button>
      </form>
    </>
  )
}
