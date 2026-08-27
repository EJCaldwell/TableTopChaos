/**
 * LegalLayout — shared chrome for the three policy documents (Phase 7.2.2).
 *
 * Owns: the readable column, the title/effective-date header, the back link,
 * and the DRAFT banner shown while legalConfig is incomplete.
 *
 * The banner is the important part. These pages are reachable before the LLC
 * and contact address exist, because a draft you can read and correct is more
 * useful than a 404 — but a policy that *looks* binding while naming no
 * contracting party and no contact address is actively misleading. So the pages
 * say so themselves, loudly, rather than relying on someone remembering.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CONTACT_DISPLAY,
  ENTITY_NAME,
  CONTACT_EMAIL,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSION,
  isLegalConfigComplete,
} from './legalConfig'

/**
 * @param title - Document title, e.g. "Privacy Policy".
 * @param children - The document body.
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const complete = isLegalConfigComplete()

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8)', lineHeight: 1.65 }}>
      <p style={{ marginTop: 0 }}>
        <Link to="/">← Back</Link>
      </p>

      {!complete && (
        <div
          style={{
            border: '2px solid var(--color-danger)',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <strong style={{ color: 'var(--color-danger)' }}>
            DRAFT — not in force, do not publish
          </strong>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.9rem' }}>
            This document is incomplete and is not a binding agreement. Still
            required before it can take effect:
          </p>
          <ul style={{ fontSize: '0.9rem', margin: 'var(--space-2) 0 0', paddingLeft: '1.2rem' }}>
            {!ENTITY_NAME && (
              <li>
                the <strong>registered legal entity</strong> that contracts with users
              </li>
            )}
            {!CONTACT_EMAIL && (
              <li>
                a <strong>monitored contact address</strong> for privacy and legal requests
              </li>
            )}
          </ul>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Set these in <code>src/features/legal/legalConfig.ts</code>; this banner
            disappears on its own.
          </p>
        </div>
      )}

      <h1 style={{ marginBottom: 'var(--space-1)' }}>{title}</h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
        Version {POLICY_VERSION} · Effective {POLICY_EFFECTIVE_DATE}
      </p>

      {children}

      <hr style={{ margin: 'var(--space-8) 0 var(--space-4)', border: 0, borderTop: '1px solid var(--color-border)' }} />
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        Questions about this document: {CONTACT_DISPLAY}
      </p>
      <p style={{ fontSize: '0.85rem' }}>
        <Link to="/legal/terms">Terms of Service</Link>
        {' · '}
        <Link to="/legal/privacy">Privacy Policy</Link>
        {' · '}
        <Link to="/legal/refunds">Refunds &amp; Cancellation</Link>
      </p>
    </main>
  )
}

/** Section heading, so the three documents stay visually consistent. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 'var(--space-6)' }}>
      <h2 style={{ fontSize: '1.05rem' }}>{heading}</h2>
      {children}
    </section>
  )
}
