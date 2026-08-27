/**
 * LegalAcceptanceBanner — asks a signed-in user to accept the current policy
 * version when they have not (Phase 7.2.1, "re-prompt on material updates").
 *
 * Covers two cases with one control, because they need the same thing:
 *   * **Never accepted** — accounts created before 7.2, and accounts created
 *     while email confirmation is on (the signup tick-box cannot be recorded
 *     then, because there is no session yet for the RPC's auth.uid() to read).
 *   * **Accepted an older version** — POLICY_VERSION was bumped for a material
 *     change.
 *
 * A BANNER, NOT A BLOCKING MODAL. Locking someone out of data they already own
 * until they re-agree is coercive, and for the "never accepted" case it would
 * lock out every existing account at once. The banner is persistent and
 * unmissable, which is enough.
 *
 * Renders nothing while the policies are still drafts: asking for agreement to a
 * document that says "not in force, do not publish" would make the acceptance
 * record worthless.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../../components/ui'
import { POLICY_VERSION, isLegalConfigComplete } from './legalConfig'

export function LegalAcceptanceBanner() {
  const { user } = useAuth()
  const [needsAcceptance, setNeedsAcceptance] = useState(false)
  const [seenBefore, setSeenBefore] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || !isLegalConfigComplete()) return
    let active = true

    supabase
      .from('profiles')
      .select('legal_version_accepted')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!active || error || !data) return
        const accepted = data.legal_version_accepted
        setNeedsAcceptance(accepted !== POLICY_VERSION)
        // Distinguishes "these terms changed" from "you have never accepted
        // any" — the same prompt reads very differently depending on which.
        setSeenBefore(Boolean(accepted))
      })

    return () => {
      active = false
    }
  }, [user])

  /** Records acceptance of the current version; the timestamp is server-side. */
  async function accept() {
    setBusy(true)
    const { error } = await supabase.rpc('record_legal_acceptance', {
      p_version: POLICY_VERSION,
    })
    setBusy(false)
    if (error) {
      console.error('could not record acceptance', error)
      return
    }
    setNeedsAcceptance(false)
  }

  if (!needsAcceptance) return null

  return (
    <div
      style={{
        border: '1px solid var(--color-accent)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-4)',
        margin: 'var(--space-4)',
        display: 'flex',
        gap: 'var(--space-4)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 20rem', fontSize: '0.9rem' }}>
        <strong>
          {seenBefore ? 'Our terms have changed' : 'Please review our terms'}
        </strong>
        <div style={{ color: 'var(--color-text-muted)' }}>
          Please read the <Link to="/legal/terms">Terms of Service</Link> and{' '}
          <Link to="/legal/privacy">Privacy Policy</Link>
          {seenBefore ? ' — version ' : ' (version '}
          {POLICY_VERSION}
          {seenBefore ? '.' : ').'}
        </div>
      </div>
      <Button style={{ width: 'auto' }} busy={busy} onClick={accept}>
        I agree
      </Button>
    </div>
  )
}
